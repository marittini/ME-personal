import { MODEL_LISTS } from "@marinara-engine/shared";
import { inflateSync, gunzipSync } from "node:zlib";
import { crc32Buffer } from "../../utils/crc32.js";
import { getSharp } from "./sharp-runtime.js";
import { webpPngTextChunks } from "./webp-storage.js";

const MAX_TEXT = 1024 * 1024;
const keys = new Set(["Comment", "Description", "Software", "Source", "Model", "marinara_novelai_request"]);
type Metadata = Record<string, unknown>;
function record(value: unknown): Metadata {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Metadata) : {};
}
function put(meta: Metadata, key: string, value: unknown) {
  if (key in meta && JSON.stringify(meta[key]) !== JSON.stringify(value)) throw new Error("Conflicting image metadata");
  meta[key] = value;
}
function pngChunks(bytes: Buffer, offset = 0): Metadata {
  const meta: Metadata = {};
  let total = 0;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset),
      end = offset + 12 + length;
    if (end > bytes.length || crc32Buffer(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4))
      throw new Error("Damaged PNG metadata");
    const kind = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, end - 4);
    if (["tEXt", "zTXt", "iTXt"].includes(kind)) {
      const zero = data.indexOf(0),
        key = data.toString("latin1", 0, zero);
      if (zero < 1 || zero > 79) throw new Error("Invalid PNG keyword");
      if (keys.has(key)) {
        let value = data.subarray(zero + 1);
        if (kind === "zTXt") {
          if (value[0] !== 0) throw new Error("Unsupported PNG compression");
          value = inflateSync(value.subarray(1), { maxOutputLength: MAX_TEXT });
        } else if (kind === "iTXt") {
          const compressed = value[0];
          if ((compressed !== 0 && compressed !== 1) || value[1] !== 0) throw new Error("Invalid iTXt compression");
          value = value.subarray(2);
          for (let i = 0; i < 2; i++) {
            const end = value.indexOf(0);
            if (end < 0) throw new Error("Invalid iTXt fields");
            value = value.subarray(end + 1);
          }
          if (compressed) value = inflateSync(value, { maxOutputLength: MAX_TEXT });
        }
        total += value.length;
        if (total > MAX_TEXT) throw new Error("Image metadata too large");
        put(meta, key, value.toString("utf8"));
      }
    }
    offset = end;
  }
  if (offset !== bytes.length) throw new Error("Truncated PNG metadata");
  return meta;
}
function exifMetadata(input: Buffer): Metadata {
  const b = input.subarray(input.subarray(0, 6).toString("ascii") === "Exif\0\0" ? 6 : 0);
  if (b.length < 8 || b.length > MAX_TEXT) throw new Error("Invalid EXIF metadata");
  const le = b.toString("ascii", 0, 2) === "II";
  if (!le && b.toString("ascii", 0, 2) !== "MM") throw new Error("Invalid EXIF byte order");
  const u16 = (n: number) => (le ? b.readUInt16LE(n) : b.readUInt16BE(n));
  const u32 = (n: number) => (le ? b.readUInt32LE(n) : b.readUInt32BE(n));
  if (u16(2) !== 42) throw new Error("Invalid TIFF header");
  const meta: Metadata = {},
    visited = new Set<number>();
  const directory = (offset: number) => {
    if (offset < 8 || offset + 2 > b.length || visited.has(offset) || visited.size > 2)
      throw new Error("Invalid EXIF directory");
    visited.add(offset);
    const count = u16(offset);
    if (count > 256 || offset + 6 + count * 12 > b.length) throw new Error("Invalid EXIF entries");
    let child: number | null = null;
    for (let i = 0; i < count; i++) {
      const pos = offset + 2 + i * 12,
        tag = u16(pos),
        type = u16(pos + 2),
        length = u32(pos + 4);
      if (tag === 0x8769 && type === 4 && length === 1) {
        child = u32(pos + 8);
        continue;
      }
      if (![0x010e, 0x0131, 0x9286].includes(tag)) continue;
      if (![1, 2, 7].includes(type) || length > MAX_TEXT) throw new Error("Unsupported EXIF value");
      const start = length <= 4 ? pos + 8 : u32(pos + 8);
      if (start < 8 || start + length > b.length) throw new Error("Truncated EXIF value");
      let value = b.subarray(start, start + length),
        text: string;
      if (tag === 0x9286 && value.toString("ascii", 0, 8) === "UNICODE\0") {
        value = value.subarray(8);
        const bomLE = value[0] === 255 && value[1] === 254,
          bomBE = value[0] === 254 && value[1] === 255;
        if (bomLE || bomBE) value = value.subarray(2);
        text = new TextDecoder(bomLE || (!bomBE && le) ? "utf-16le" : "utf-16be", { fatal: true }).decode(value);
      } else {
        if (tag === 0x9286 && ["ASCII\0\0\0", "\0".repeat(8)].includes(value.toString("ascii", 0, 8)))
          value = value.subarray(8);
        text = value.toString("utf8");
      }
      text = text.replace(/\0+$/, "");
      if (tag === 0x9286) {
        const parsed = record(JSON.parse(text));
        if ("Comment" in parsed)
          for (const key of keys) {
            if (key in parsed) put(meta, key, parsed[key]);
          }
        else put(meta, "Comment", parsed);
      } else put(meta, tag === 0x010e ? "Description" : "Source", text);
    }
    if (child !== null) directory(child);
  };
  directory(u32(4));
  return meta;
}
export function normalizeNovelAiMetadata(metadata: Metadata) {
  const stored =
    typeof metadata.marinara_novelai_request === "string" ? record(JSON.parse(metadata.marinara_novelai_request)) : {};
  const embedded = record(stored.request);
  const comment =
    typeof metadata.Comment === "string" ? record(JSON.parse(metadata.Comment)) : record(metadata.Comment);
  const c = Object.keys(embedded).length ? record(embedded.parameters) : comment;
  const exactModels = MODEL_LISTS.image_generation
    .filter((model) => model.id.startsWith("nai-diffusion-"))
    .map((model) => model.id);
  const modelText = [embedded.model, c.model, c.model_name, metadata.Model, metadata.Source, metadata.Software].filter(
    (x): x is string => typeof x === "string",
  );
  const exact = [...new Set(modelText.filter((x) => exactModels.includes(x)))];
  if (exact.length > 1) throw new Error("Conflicting model metadata");
  const prompt = record(record(c.v4_prompt).caption).base_caption ?? embedded.input ?? c.prompt ?? metadata.Description;
  const negative = record(record(c.v4_negative_prompt).caption).base_caption ?? c.uc ?? c.negative_prompt;
  if (!modelText.some((x) => /novelai|nai.diffusion/i.test(x)) && !c.v4_prompt)
    throw new Error("No NovelAI metadata found");
  const values: Record<string, string | number> = {};
  const omitted: string[] = [];
  for (const [target, value] of [
    ["promptPrefix", prompt],
    ["negativePromptPrefix", negative],
    ["sampler", c.sampler],
    ["noiseSchedule", c.noise_schedule],
  ] as const) {
    if (value === undefined) continue;
    if (typeof value === "string" && value.length <= (target.endsWith("Prefix") ? 131072 : 200)) values[target] = value;
    else omitted.push(target);
  }
  for (const [target, key, min, max, integer] of [
    ["steps", "steps", 1, 150, true],
    ["promptGuidance", "scale", 0, 30, false],
    ["promptGuidanceRescale", "cfg_rescale", 0, 1, false],
  ] as const) {
    const v = c[key];
    if (v === undefined) continue;
    if (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max && (!integer || Number.isInteger(v)))
      values[target] = v;
    else omitted.push(target);
  }
  if (exact[0]) values.model = exact[0];
  return {
    values,
    omitted,
    modelOptions: exact.length
      ? exact
      : exactModels.filter((id) =>
          modelText.some((text) => {
            const family = text.match(/(?:v|diffusion[- ]?)(4[.-]5|[345])(?:\b|[- ])/i)?.[1]?.replace(".", "-");
            return family && id.startsWith(`nai-diffusion-${family}`);
          }),
        ),
    source: modelText.join(" / ").slice(0, 300),
  };
}
export async function readNovelAiMetadata(bytes: Buffer) {
  if (bytes.length > 32 * 1024 * 1024) throw new Error("Image too large");
  const sharp = await getSharp();
  const info = await sharp(bytes, { limitInputPixels: 16 * 1024 * 1024, failOn: "warning" }).metadata();
  let meta: Metadata = {};
  if (info.format === "png") meta = pngChunks(bytes, 8);
  else if (info.format === "webp") {
    const preserved = webpPngTextChunks(bytes);
    if (preserved.length) meta = pngChunks(preserved);
    if (info.exif) for (const [key, value] of Object.entries(exifMetadata(info.exif))) put(meta, key, value);
  } else throw new Error("Select a PNG or WebP image");
  if (
    !meta.Comment &&
    !meta.marinara_novelai_request &&
    info.format === "png" &&
    info.hasAlpha &&
    (info.width ?? 0) * (info.height ?? 0) >= 152
  ) {
    const { data, info: decoded } = await sharp(bytes, { limitInputPixels: 16 * 1024 * 1024 })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let bit = 0;
    const take = (count: number) => {
      if (count * 8 + bit > decoded.width * decoded.height) throw new Error("Truncated alpha metadata");
      const out = Buffer.alloc(count);
      for (let n = 0; n < count; n++)
        for (let k = 0; k < 8; k++, bit++)
          out[n] =
            (out[n]! << 1) |
            (data[((bit % decoded.height) * decoded.width + Math.floor(bit / decoded.height)) * 4 + 3]! & 1);
      return out;
    };
    if (take(15).toString("ascii") !== "stealth_pngcomp") return normalizeNovelAiMetadata(meta);
    const bits = take(4).readUInt32BE();
    if (bits % 8 || bits / 8 > MAX_TEXT) throw new Error("Alpha metadata too large");
    meta = record(JSON.parse(gunzipSync(take(bits / 8), { maxOutputLength: MAX_TEXT }).toString("utf8")));
  }
  return normalizeNovelAiMetadata(meta);
}
