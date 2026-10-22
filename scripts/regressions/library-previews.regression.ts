import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { imagePreviewUrl } from "../../packages/client/src/lib/image-preview-url.js";
import { libraryChatGroupKey } from "../../packages/client/src/lib/library-chat-group.js";
import { chatBackgroundMetadataToUrl } from "../../packages/client/src/lib/backgrounds.js";
import { normalizeLibraryCovers } from "../../packages/shared/src/schemas/library-cover.schema.js";

const cover = { url: "/api/avatars/file/library-cover-00000000-0000-4000-8000-000000000001.webp", crop: null };
assert.deepEqual(normalizeLibraryCovers({ work: cover }), { work: cover });
assert.deepEqual(normalizeLibraryCovers({ work: { ...cover, url: "https://example.com/track.webp" } }), {});
assert.deepEqual(
  normalizeLibraryCovers({ work: { ...cover, crop: { srcX: 0.9, srcY: 0, srcWidth: 1, srcHeight: 1 } } }),
  {},
);
assert.deepEqual(normalizeLibraryCovers(null), {});

assert.equal(
  imagePreviewUrl("/api/avatars/file/profile.webp?v=2#crop"),
  "/api/avatars/file/profile.webp?v=2&w=320#crop",
);
assert.equal(imagePreviewUrl("https://example.com/profile.webp"), "https://example.com/profile.webp");
assert.equal(imagePreviewUrl("data:image/webp;base64,test"), "data:image/webp;base64,test");
assert.equal(
  chatBackgroundMetadataToUrl("/api/backgrounds/file/book.webp?v=3", 320),
  "/api/backgrounds/file/book.webp?v=3&w=320",
);
assert.equal(
  libraryChatGroupKey({ id: "1", characterIds: ["a"] }),
  libraryChatGroupKey({ id: "2", characterIds: ["a"] }),
);
assert.equal(
  libraryChatGroupKey({ id: "1", characterIds: ["b", "a"] }),
  libraryChatGroupKey({ id: "2", characterIds: ["a", "b"] }),
);
assert.notEqual(
  libraryChatGroupKey({ id: "1", characterIds: ["a"] }),
  libraryChatGroupKey({ id: "2", characterIds: ["a", "b"] }),
);
assert.notEqual(libraryChatGroupKey({ id: "1", characterIds: [] }), libraryChatGroupKey({ id: "2", characterIds: [] }));

const dataDir = mkdtempSync(join(tmpdir(), "library-preview-"));
process.env.DATA_DIR = dataDir;
process.env.FILE_STORAGE_DIR = join(dataDir, "storage");
process.env.MARINARA_ENV_FILE = join(dataDir, ".env");
process.env.LOG_LEVEL = "silent";
const requireServer = createRequire(new URL("../../packages/server/package.json", import.meta.url));
const Fastify = requireServer("fastify") as typeof import("fastify").default;
const { getDB } = await import("../../packages/server/src/db/connection.js");
const { getSharp } = await import("../../packages/server/src/services/image/sharp-runtime.js");
const { avatarsRoutes } = await import("../../packages/server/src/routes/avatars.routes.js");
const sharp = await getSharp();
const app = Fastify();
app.decorate("db", await getDB());
await app.register(avatarsRoutes, { prefix: "/api/avatars" });
try {
  mkdirSync(join(dataDir, "avatars"), { recursive: true });
  const original = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#bbaabb" } })
    .webp()
    .toBuffer();
  for (const filename of ["profile.webp", "legacy.png", "UPPER.WEBP"]) {
    writeFileSync(join(dataDir, "avatars", filename), original);
    const response = await app.inject({ url: `/api/avatars/file/${filename}?v=2&w=320` });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"] ?? "", /image\/webp/);
    assert.equal((await sharp(response.rawPayload).metadata()).width, 320);
    assert.ok(response.rawPayload.length < original.length);
    const unsized = await app.inject({ url: `/api/avatars/file/${filename}?w=420` });
    assert.deepEqual(unsized.rawPayload, original, "unsupported widths preserve the original");
  }
  writeFileSync(join(dataDir, "avatars", "broken.webp"), "not an image");
  assert.equal((await app.inject({ url: "/api/avatars/file/broken.webp?w=320" })).statusCode, 404);
  assert.equal((await app.inject({ url: "/api/avatars/file/missing.webp?w=320" })).statusCode, 404);
} finally {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
}
