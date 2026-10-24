// ──────────────────────────────────────────────
// App name and icon (favicon, home-screen web app icon, manifest)
//
// The client links its manifest here, so an installed web app picks up the custom name and
// icon. Nothing is stored until the owner sets something; without settings the manifest and
// icons are the stock ones in the client's public folder.
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { DATA_DIR } from "../utils/data-dir.js";
import { assertInsideDir } from "../utils/security.js";
import { logger } from "../lib/logger.js";
import { getSharp } from "../services/image/sharp-runtime.js";

const BRANDING_DIR = join(DATA_DIR, "branding");
const SETTINGS_PATH = join(BRANDING_DIR, "branding.json");
const MAX_ICON_BYTES = 5 * 1024 * 1024;
const ICON_SIZES = [64, 192, 512] as const;
type IconSize = (typeof ICON_SIZES)[number];

const DEFAULT_NAME = "Marinara Engine";
const DEFAULT_SHORT_NAME = "Marinara";

type BrandingSettings = { name: string; shortName: string };

function iconPath(size: IconSize) {
  return assertInsideDir(BRANDING_DIR, join(BRANDING_DIR, `icon-${size}.png`));
}

async function readSettings(): Promise<BrandingSettings> {
  try {
    const parsed = JSON.parse(await readFile(SETTINGS_PATH, "utf8")) as Partial<BrandingSettings>;
    return {
      name: typeof parsed.name === "string" ? parsed.name : "",
      shortName: typeof parsed.shortName === "string" ? parsed.shortName : "",
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") logger.warn(error, "[branding] settings unreadable");
    return { name: "", shortName: "" };
  }
}

async function iconUpdatedAt(): Promise<string | null> {
  try {
    return (await stat(iconPath(512))).mtime.toISOString();
  } catch {
    return null;
  }
}

async function status() {
  const settings = await readSettings();
  const updatedAt = await iconUpdatedAt();
  const version = updatedAt ? encodeURIComponent(updatedAt) : null;
  return {
    name: settings.name,
    shortName: settings.shortName,
    /** What the app shows: the custom value or the stock one. */
    effectiveName: settings.name || DEFAULT_NAME,
    effectiveShortName: settings.shortName || settings.name || DEFAULT_SHORT_NAME,
    icon: version
      ? {
          updatedAt,
          favicon: `/api/branding/icon/64?v=${version}`,
          touch: `/api/branding/icon/192?v=${version}`,
          large: `/api/branding/icon/512?v=${version}`,
        }
      : null,
  };
}

/** Cleans a name: single line, no control characters, at most `max` characters. */
export function cleanBrandingName(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return Array.from(cleaned).slice(0, max).join("");
}

// Uploads and resets rename/unlink the same files, so they run one at a time.
let queue: Promise<unknown> = Promise.resolve();
function locked<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

async function writeAtomically(path: string, data: Buffer | string) {
  const temp = assertInsideDir(BRANDING_DIR, join(BRANDING_DIR, `.tmp-${randomUUID()}`));
  await writeFile(temp, data, { flag: "wx" });
  await rename(temp, path);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export async function brandingRoutes(app: FastifyInstance) {
  app.get("/", async () => status());

  app.put<{ Body: { name?: unknown; shortName?: unknown } }>("/", async (req, reply) => {
    const name = cleanBrandingName(req.body?.name ?? "", 60);
    const shortName = cleanBrandingName(req.body?.shortName ?? "", 30);
    if (name === null || shortName === null) return reply.status(400).send({ error: "Names must be text." });
    await locked(async () => {
      await mkdir(BRANDING_DIR, { recursive: true });
      await writeAtomically(SETTINGS_PATH, JSON.stringify({ name, shortName }));
    });
    return status();
  });

  app.post("/icon", async (req, reply) => {
    let upload;
    try {
      upload = await req.file({ limits: { fileSize: MAX_ICON_BYTES + 1 } });
    } catch (error) {
      logger.warn(error, "[branding] icon upload failed");
      return reply.status(413).send({ error: "The icon must be 5 MB or smaller." });
    }
    if (!upload) return reply.status(400).send({ error: "No icon was uploaded." });
    const buffer = await upload.toBuffer().catch(() => null);
    if (!buffer || upload.file.truncated || buffer.byteLength > MAX_ICON_BYTES) {
      return reply.status(413).send({ error: "The icon must be 5 MB or smaller." });
    }

    let images: Map<IconSize, Buffer>;
    try {
      const sharp = await getSharp();
      // Square crop from the centre, then one PNG per size the browser and home screen ask for.
      images = new Map(
        await Promise.all(
          ICON_SIZES.map(
            async (size) =>
              [size, await sharp(buffer).rotate().resize(size, size, { fit: "cover" }).png().toBuffer()] as const,
          ),
        ),
      );
    } catch (error) {
      // Without sharp a PNG still works; the browser scales the one image for every size.
      if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
        logger.warn(error, "[branding] icon could not be processed");
        return reply.status(400).send({ error: "Use a PNG, JPEG or WebP image." });
      }
      images = new Map(ICON_SIZES.map((size) => [size, buffer]));
    }

    await locked(async () => {
      await mkdir(BRANDING_DIR, { recursive: true });
      // The largest size is written last: its time is the icon's version.
      for (const size of ICON_SIZES) await writeAtomically(iconPath(size), images.get(size)!);
    });
    return status();
  });

  app.delete("/icon", async () => {
    await locked(async () => {
      await Promise.all(
        ICON_SIZES.map((size) =>
          unlink(iconPath(size)).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
          }),
        ),
      );
    });
    return status();
  });

  app.get<{ Params: { size: string } }>("/icon/:size", async (req, reply) => {
    const size = Number(req.params.size) as IconSize;
    if (!ICON_SIZES.includes(size)) return reply.status(404).send({ error: "Not Found" });
    try {
      const data = await readFile(iconPath(size));
      reply.header("Cache-Control", "public, max-age=31536000, immutable");
      return reply.type("image/png").send(data);
    } catch {
      return reply.status(404).send({ error: "Not Found" });
    }
  });

  // The web app manifest, with the custom name and icon when they are set.
  app.get("/manifest.json", async (_req, reply) => {
    const current = await status();
    const icons = current.icon
      ? [
          { src: current.icon.favicon, sizes: "64x64", type: "image/png" },
          { src: current.icon.touch, sizes: "192x192", type: "image/png", purpose: "any maskable" },
          { src: current.icon.large, sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ]
      : [
          { src: "/favicon.png", sizes: "64x64", type: "image/png" },
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ];
    reply.header("Cache-Control", "no-store");
    return reply.type("application/manifest+json").send(
      JSON.stringify({
        name: current.effectiveName,
        short_name: current.effectiveShortName,
        description: "AI Chat & Roleplay Frontend — Conversation, Roleplay, Game",
        start_url: "/",
        display: "standalone",
        background_color: "#0f0f13",
        theme_color: "#0f0f13",
        icons,
      }),
    );
  });
}
