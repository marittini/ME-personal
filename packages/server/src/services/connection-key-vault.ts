import {
  pbkdf2 as derive,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHmac,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import type { DB } from "../db/connection.js";
import { createAppSettingsStorage } from "./storage/app-settings.storage.js";
import { createConnectionsStorage } from "./storage/connections.storage.js";

const pbkdf2 = promisify(derive);
const KEY = "connection-key-vault";
const entriesSchema = z
  .array(
    z.object({
      id: z.string().max(200),
      name: z.string().min(1).max(200),
      group: z.string().max(500),
      key: z.string().min(1).max(64000),
    }),
  )
  .max(1000);
type Entries = z.infer<typeof entriesSchema>;
const boxSchema = z.object({
  v: z.union([z.literal(1), z.literal(2)]),
  salt: z.string().max(100),
  iv: z.string().max(100),
  data: z.string().max(4_000_000),
  tag: z.string().max(100),
  iter: z.number().int().min(10000).max(1_000_000).default(200000),
});
const inputSchema = z.object({
  action: z.enum(["list", "save", "remove", "apply", "select", "export", "import", "changePassword", "reset"]),
  password: z.string().min(4).max(1000),
  newPassword: z.string().min(4).max(1000).optional(),
  id: z.string().max(200).optional(),
  name: z.string().max(200).optional(),
  group: z.string().max(500).optional(),
  key: z.string().max(64000).optional(),
  connectionId: z.string().max(200).optional(),
  backup: z.unknown().optional(),
});
type Box = z.infer<typeof boxSchema>;
const locks = new WeakMap<DB, Promise<unknown>>();
async function decrypt(password: string, box: Box): Promise<Entries> {
  const salt = Buffer.from(box.salt, "base64"),
    iv = Buffer.from(box.iv, "base64"),
    data = Buffer.from(box.data, "base64"),
    tag = Buffer.from(box.tag, "base64");
  const master = await pbkdf2(password, salt, box.iter, 32, "sha256");
  try {
    let text: string;
    if (box.v === 2) {
      const decipher = createDecipheriv("aes-256-gcm", master, iv);
      decipher.setAuthTag(tag);
      text = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
      return entriesSchema.parse(JSON.parse(text));
    }
    // key_save v1.1.4 backup compatibility. New writes always use AES-GCM v2.
    const hmac = (key: Buffer, bytes: Buffer | string) => createHmac("sha256", key).update(bytes).digest();
    const expected = hmac(hmac(master, "akl-mac"), Buffer.concat([iv, data]));
    if (tag.length !== expected.length || !timingSafeEqual(tag, expected)) throw new Error("Invalid password");
    const encKey = hmac(master, "akl-enc");
    const plain = Buffer.alloc(data.length);
    for (let offset = 0, index = 0; offset < data.length; offset += 32, index++) {
      const counter = Buffer.alloc(4);
      counter.writeUInt32BE(index);
      const block = hmac(encKey, Buffer.concat([iv, counter]));
      for (let j = 0; j < 32 && offset + j < data.length; j++) plain[offset + j] = data[offset + j]! ^ block[j]!;
    }
    const old = z
      .object({ keys: z.record(z.array(z.object({ id: z.string(), name: z.string(), key: z.string() }))) })
      .parse(JSON.parse(plain.toString("utf8")));
    return entriesSchema.parse(
      Object.entries(old.keys).flatMap(([group, rows]) => rows.map((row) => ({ ...row, group }))),
    );
  } finally {
    master.fill(0);
  }
}
async function encrypt(password: string, entries: Entries): Promise<Box> {
  const salt = randomBytes(16),
    iv = randomBytes(12);
  const master = await pbkdf2(password, salt, 200000, 32, "sha256");
  try {
    const cipher = createCipheriv("aes-256-gcm", master, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(entries), "utf8"), cipher.final()]);
    return {
      v: 2,
      iter: 200000,
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      data: data.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
    };
  } finally {
    master.fill(0);
  }
}
export async function vaultExists(db: DB) {
  return { exists: !!(await createAppSettingsStorage(db).get(KEY)) };
}
export function operateKeyVault(db: DB, body: unknown) {
  const input = inputSchema.parse(body);
  const work = (locks.get(db) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const storage = createAppSettingsStorage(db);
      const raw = await storage.get(KEY);
      let entries: Entries = [];
      try {
        if (raw) entries = await decrypt(input.password, boxSchema.parse(JSON.parse(raw)));
      } catch {
        throw Object.assign(new Error("Could not unlock the key vault"), { statusCode: 403 });
      }
      switch (input.action) {
        case "export":
          return { backup: raw ? { vault: JSON.parse(raw) } : null };
        case "select": {
          const entry = entries.find((row) => row.id === input.id);
          if (!entry) throw Object.assign(new Error("Key not found"), { statusCode: 404 });
          return { selectedKey: entry.key };
        }
        case "apply": {
          const entry = entries.find((row) => row.id === input.id);
          const connections = createConnectionsStorage(db);
          if (!entry || !input.connectionId || !(await connections.getById(input.connectionId)))
            throw Object.assign(new Error("Key or connection not found"), { statusCode: 404 });
          await connections.update(input.connectionId, { apiKey: entry.key });
          break;
        }
        case "save": {
          const old = entries.find((row) => row.id === input.id);
          const next = entriesSchema.element.parse({
            id: old?.id ?? randomUUID(),
            name: input.name,
            group: input.group ?? "",
            key: input.key || old?.key,
          });
          entries = [...entries.filter((row) => row.id !== next.id), next];
          break;
        }
        case "remove":
          entries = entries.filter((row) => row.id !== input.id);
          break;
        case "reset":
          await storage.remove(KEY);
          return { entries: [], exists: false };
        case "import": {
          const backup = z.object({ vault: boxSchema }).parse(input.backup);
          const imported = await decrypt(input.newPassword ?? input.password, backup.vault);
          const byId = new Map(entries.map((row) => [row.id, row]));
          for (const row of imported) {
            const id = entries.some((old) => old.id === row.id && old.key !== row.key) ? randomUUID() : row.id;
            byId.set(id, { ...row, id });
          }
          entries = entriesSchema.parse([...byId.values()]);
          break;
        }
      }
      if (input.action !== "apply" && (input.action !== "list" || !raw)) {
        if (input.action === "changePassword" && !input.newPassword) throw new Error("New password required");
        await storage.set(
          KEY,
          JSON.stringify(
            await encrypt(
              input.action === "changePassword" ? input.newPassword! : input.password,
              entriesSchema.parse(entries),
            ),
          ),
        );
      }
      // Secrets and master keys are never returned by list/apply responses.
      return { entries: entries.map(({ key: _key, ...row }) => row), exists: true };
    });
  locks.set(db, work);
  return work;
}
