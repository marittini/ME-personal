import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
const directory = mkdtempSync(join(os.tmpdir(), "me-nai-api-"));
process.env.DATA_DIR = directory;
process.env.FILE_STORAGE_DIR = join(directory, "storage");
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
const originalInterfaces = os.networkInterfaces;
os.networkInterfaces = () => ({});
syncBuiltinESMExports();
const { default: Fastify } = await import("../../packages/server/node_modules/fastify/fastify.js");
const { characterDataSchema } = await import("../../packages/shared/src/index.js");
const { getDB, closeDB } = await import("../../packages/server/src/db/connection.js");
const { createCharactersStorage } = await import("../../packages/server/src/services/storage/characters.storage.js");
const { createConnectionsStorage } = await import("../../packages/server/src/services/storage/connections.storage.js");
const { getNaiRequestGuard, naiAccountGroup } =
  await import("../../packages/server/src/services/image/nai-request-guard.js");
const { charactersRoutes } = await import("../../packages/server/src/routes/characters.routes.js");
const { avatarsRoutes } = await import("../../packages/server/src/routes/avatars.routes.js");
const { naiRequestGuardRoutes } = await import("../../packages/server/src/routes/nai-request-guard.routes.js");
const { getSharp } = await import("../../packages/server/src/services/image/sharp-runtime.js");
const { migrateStoredPngs } = await import("../../packages/server/src/services/image/webp-storage.js");
const { safeFetch } = await import("../../packages/server/src/utils/security.js");
const db = await getDB();
const app = Fastify();
app.decorate("db", db);
await app.register(charactersRoutes, { prefix: "/api/characters" });
await app.register(avatarsRoutes, { prefix: "/api/avatars" });
await app.register(naiRequestGuardRoutes, { prefix: "/api/nai-request-guard" });
try {
  const sharp = await getSharp();
  const png = await sharp({ create: { width: 12, height: 10, channels: 4, background: "#a23456" } })
    .png()
    .toBuffer();
  const avatar = `data:image/png;base64,${png.toString("base64")}`;
  const storage = createCharactersStorage(db);
  const character = await storage.create(characterDataSchema.parse({ name: "WebP proof" }));
  const persona = await storage.createPersona("WebP persona", "Proof");
  assert.ok(character && persona);
  for (const path of [`/api/characters/${character.id}/avatar`, `/api/characters/personas/${persona.id}/avatar`]) {
    const response = await app.inject({ method: "POST", url: path, payload: { avatar } });
    assert.equal(response.statusCode, 200, response.body);
    const avatarPath = response.json().avatarPath;
    assert.ok(avatarPath.endsWith(".webp"), avatarPath);
    const file = await app.inject({ method: "GET", url: avatarPath });
    assert.equal(file.statusCode, 200);
    assert.match(String(file.headers["content-type"]), /image\/webp/);
    assert.equal(file.rawPayload.toString("ascii", 8, 12), "WEBP");
  }
  writeFileSync(join(directory, "avatars", "legacy.png"), png);
  await migrateStoredPngs(directory);
  const legacy = await app.inject({ method: "GET", url: "/api/avatars/file/legacy.png" });
  assert.equal(legacy.statusCode, 200);
  assert.match(String(legacy.headers["content-type"]), /image\/webp/);
  assert.equal((await readFile(join(directory, "avatars", "legacy.png"))).toString("ascii", 8, 12), "WEBP");
  const queue = await app.inject({ method: "GET", url: "/api/nai-request-guard/" });
  assert.equal(queue.statusCode, 200);
  assert.equal(queue.json().storageFailed, false);
  const stale = await app.inject({
    method: "POST",
    url: "/api/nai-request-guard/run",
    payload: { items: [{ id: "00000000-0000-4000-8000-000000000000", revision: 1 }] },
  });
  assert.equal(stale.statusCode, 409);
  // Exercise the real avatar-generation route: held requests must capture the
  // server's saved profile, never an arbitrary/current UI destination.
  const connection = await createConnectionsStorage(db).create({
    name: "Held NAI fixture",
    provider: "image_generation",
    baseUrl: "https://image.novelai.net",
    model: "nai-diffusion-4-5-full",
    imageGenerationSource: "novelai",
    imageService: "novelai",
    apiKey: "fixture",
  });
  assert.ok(connection);
  const guard = getNaiRequestGuard()!;
  guard.hold(naiAccountGroup("fixture"));
  for (const [entity, id] of [
    ["character", character.id],
    ["persona", persona.id],
  ] as const) {
    const response = await app.inject({
      method: "POST",
      url: "/api/characters/avatar-generation",
      payload: {
        connectionId: connection.id,
        name: "Fixture",
        appearance: "Blue eyes",
        resumeTarget: { entity, id },
      },
    });
    assert.equal(response.statusCode, 500, response.body);
    assert.match(response.body, /NAI_HELD/);
    const saved = guard
      .list()
      .jobs.find(
        (job) =>
          guard.detail(job.id)?.request.naiDestination?.kind === "profile" &&
          (guard.detail(job.id)?.request.naiDestination as { id: string }).id === id,
      )!;
    assert.ok(saved);
    const target = guard.detail(saved.id)!.request.naiDestination!;
    assert.equal(target.kind, "profile");
    if (target.kind === "profile") {
      assert.equal(target.id, id);
      assert.equal(target.entity, entity);
      assert.match(target.expectedAvatarPath!, /\.webp$/);
    }
  }
  const staleApply = await app.inject({
    method: "POST",
    url: "/api/nai-request-guard/retry-application",
    payload: {
      items: [{ id: "00000000-0000-4000-8000-000000000000", revision: 1 }],
    },
  });
  assert.equal(staleApply.statusCode, 409);
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("broken body"));
          },
        }),
        { status: 429 },
      );
    let observed = false;
    await assert.rejects(
      safeFetch("https://example.org/fixture", {
        policy: { allowLocal: true },
        onResponseHeaders(response) {
          assert.equal(response.status, 429);
          observed = true;
          throw new Error("stopped at headers");
        },
      }),
      /stopped at headers/,
    );
    assert.equal(observed, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log("NAI/WebP API regression passed: avatar uploads, old URLs, queue endpoints and early 429 observation");
} finally {
  await app.close();
  await closeDB();
  os.networkInterfaces = originalInterfaces;
  syncBuiltinESMExports();
  rmSync(directory, { recursive: true, force: true });
}
