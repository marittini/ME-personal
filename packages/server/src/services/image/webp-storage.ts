import { readFile, readdir, lstat, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getSharp } from "./sharp-runtime.js";
import { isAllowedImageBuffer } from "../../utils/security.js";
import { logger } from "../../lib/logger.js";

export const DEFAULT_STORED_WEBP_QUALITY = 95;

/** Original PNG text/card/provenance chunks, without a duplicate of the pixels. */
function pngTextChunks(input: Buffer) {
  const chunks: Buffer[] = [];
  if (isAllowedImageBuffer(input)?.ext !== "png") return Buffer.alloc(0);
  for (let offset = 8; offset + 12 <= input.length;) {
    const end = offset + 12 + input.readUInt32BE(offset);
    if (end > input.length) throw new Error("Truncated PNG chunk");
    if (["tEXt", "zTXt", "iTXt"].includes(input.toString("ascii", offset + 4, offset + 8)))
      chunks.push(input.subarray(offset, end));
    offset = end;
  }
  return Buffer.concat(chunks);
}
export function webpPngTextChunks(input: Buffer) {
  if (isAllowedImageBuffer(input)?.ext !== "webp") return Buffer.alloc(0);
  for (let offset = 12; offset + 8 <= input.length;) {
    const length = input.readUInt32LE(offset + 4);
    const end = offset + 8 + length;
    if (end > input.length) break;
    if (input.toString("ascii", offset, offset + 4) === "MARI") return input.subarray(offset + 8, end);
    offset = end + (length % 2);
  }
  return Buffer.alloc(0);
}
export async function toStoredWebp(input: Buffer): Promise<{ buffer: Buffer; ext: string; mimeType: string }> {
  const info = isAllowedImageBuffer(input);
  if (!info) throw new Error("Unsupported image");
  if (info.ext === "webp") return { buffer: input, ...info };
  // The current PNG decoder cannot reliably retain APNG frames. Keep the original.
  if (info.ext === "png")
    for (let offset = 8; offset + 12 <= input.length;) {
      if (input.toString("ascii", offset + 4, offset + 8) === "acTL") return { buffer: input, ...info };
      offset += input.readUInt32BE(offset) + 12;
    }
  const sharp = await getSharp();
  const output = await sharp(input, { animated: true })
    .keepMetadata()
    .webp({ quality: DEFAULT_STORED_WEBP_QUALITY, alphaQuality: 100, effort: 3 })
    .toBuffer();
  const text = pngTextChunks(input);
  let buffer: Buffer = output;
  if (text.length) {
    const header = Buffer.alloc(8);
    header.write("MARI");
    header.writeUInt32LE(text.length, 4);
    buffer = Buffer.concat([output, header, text, Buffer.alloc(text.length % 2)]);
    buffer.writeUInt32LE(buffer.length - 8, 4);
  }
  const before = await sharp(input, { animated: true }).metadata();
  const after = await sharp(buffer, { animated: true }).metadata();
  if (before.width !== after.width || before.height !== after.height || (before.pages ?? 1) !== (after.pages ?? 1))
    throw new Error("WebP conversion changed dimensions or animation frames");
  return { buffer, ext: "webp", mimeType: "image/webp" };
}
/** Preserve legacy filenames/URLs; served MIME comes from the actual converted bytes. */
export async function migrateStoredPngs(dataDir: string) {
  const result = { converted: 0, failed: 0, savedBytes: 0 };
  async function walk(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      if (!entry.isFile() || !/\.png$/i.test(entry.name)) continue;
      const temporary = `${path}.${randomUUID()}.webp-tmp`;
      try {
        const before = await lstat(path);
        const input = await readFile(path);
        if (isAllowedImageBuffer(input)?.ext !== "png") continue;
        const converted = await toStoredWebp(input);
        if (converted.ext !== "webp") {
          result.failed++;
          continue;
        }
        await writeFile(temporary, converted.buffer, { flag: "wx", mode: before.mode });
        const current = await lstat(path);
        if (current.mtimeMs !== before.mtimeMs || current.size !== before.size) {
          result.failed++;
          continue;
        }
        await rename(temporary, path);
        result.converted++;
        result.savedBytes += input.length - converted.buffer.length;
      } catch (error) {
        result.failed++;
        logger.warn(error, "[webp] Original image retained after conversion failure");
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
    }
  }
  for (const root of [
    "avatars",
    "gallery",
    "backgrounds",
    "sprites",
    "lorebooks/images",
    "prompts/images",
    "agents/images",
    "connections/images",
    "custom-emojis",
    "custom-stickers",
  ])
    await walk(join(dataDir, root));
  return result;
}
