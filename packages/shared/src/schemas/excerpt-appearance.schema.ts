import { z } from "zod";

/**
 * Excerpt card appearance, ported from the "발췌 스튜디오" extension 1.0.0
 * (https://github.com/boricha417/marinara-excerpt-studio). Colors, textures and defaults match the extension;
 * line height, letter spacing and padding are engine additions whose defaults reproduce the extension's look.
 */
export const EXCERPT_TEXTURES = {
  snow: { base: "#FBFBFA", text: "#2F3437", grainDark: 0.02, grainLight: 0 },
  dark: { base: "#26231F", text: "#EFE8DA", grainDark: 0, grainLight: 0.045 },
  cream: { base: "#F5EEDB", text: "#31291C", grainDark: 0.045, grainLight: 0.05 },
  kraft: { base: "#D5BC92", text: "#3A2D1A", grainDark: 0.06, grainLight: 0.06 },
} as const;
export type ExcerptTexture = keyof typeof EXCERPT_TEXTURES;
/** Highlighter fills; underlines use darker inks because a thin line needs more contrast. */
export const EXCERPT_HIGHLIGHT_COLORS = { y: "#FFDF7E", g: "#B9E6B0", p: "#F9C6D9", b: "#B4DAF7" } as const;
export const EXCERPT_UNDERLINE_COLORS = { y: "#E0A93E", g: "#5FA85A", p: "#D9648F", b: "#4A8FD4" } as const;
export type ExcerptMarkColor = keyof typeof EXCERPT_HIGHLIGHT_COLORS;
/** Text drawn over a highlighter keeps this ink so it stays readable on light fills. */
export const EXCERPT_HIGHLIGHT_INK = "#2F3437";

const hex = z.string().regex(/^#[a-fA-F0-9]{6}$/);
const imageUrl = z
  .string()
  .regex(/^\/api\/avatars\/file\/library-cover-[a-f0-9-]+\.(?:webp|png|gif)$/)
  .nullable();

export const excerptAppearanceSchema = z.object({
  fontSize: z.number().min(10).max(80).default(18),
  /** CSS font-family list; empty uses the page font. */
  fontFamily: z.string().max(300).default(""),
  /** Installed family behind `fontFamily`, used to load it before drawing. */
  fontFamilyName: z.string().max(200).default(""),
  align: z.enum(["left", "center", "right", "justify"]).default("left"),
  textColor: hex.default(EXCERPT_TEXTURES.cream.text),
  dialogueEnabled: z.boolean().default(false),
  dialogueColor: hex.default("#9F2F2D"),
  /** Multiple of the font size (extension: 1.75). */
  lineHeight: z.number().min(1).max(3).default(1.75),
  letterSpacing: z.number().min(-2).max(10).default(0),
  /** 0 = automatic (font size × 2.1, as in the extension). */
  padding: z.number().min(0).max(150).default(0),
  cornerRadius: z.number().min(0).max(100).default(16),
  cardWidth: z.number().int().min(320).max(2000).default(640),
  heightMode: z.enum(["auto", "fixed"]).default("auto"),
  cardHeight: z.number().int().min(200).max(5000).default(640),
  vAlign: z.enum(["top", "center"]).default("top"),
  showTitle: z.boolean().default(true),
  /** Empty shows the chat name. */
  titleText: z.string().max(300).default(""),
  showAuthor: z.boolean().default(true),
  authorText: z.string().max(200).default("MARINARA"),
  replaceRules: z
    .array(z.object({ find: z.string().max(200), replace: z.string().max(500) }))
    .max(20)
    .default([]),
  background: z
    .object({
      mode: z.enum(["texture", "solid", "image"]).default("texture"),
      color: hex.default("#FFFFFF"),
      texture: z.enum(["snow", "dark", "cream", "kraft"]).default("cream"),
      pattern: z.enum(["grain", "lines", "grid", "none"]).default("grain"),
      imageUrl: imageUrl.default(null),
      /** 0-0.7 black overlay over an image background. */
      dim: z.number().min(0).max(0.7).default(0),
      /** 0-0.7 white overlay over an image background. */
      bright: z.number().min(0).max(0.7).default(0),
    })
    .default({}),
});
export type ExcerptAppearance = z.infer<typeof excerptAppearanceSchema>;

/** The first engine port stored a different shape; untouched defaults become the extension defaults. */
const LEGACY_DEFAULTS = {
  width: 720,
  height: 0,
  padding: 48,
  fontSize: 24,
  lineHeight: 1.7,
  letterSpacing: 0,
  radius: 16,
  fontFamily: "",
  title: "",
  author: "",
  background: "paper",
  backgroundColor: "#fbf8f3",
  textColor: "#302a25",
  quoteColor: "#936b4b",
  backgroundImageUrl: null,
} as const;

export function migrateLegacyExcerptAppearance(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const old = value as Record<string, unknown>;
  if (!("width" in old) && typeof old.background !== "string") return value;
  const legacy = { ...LEGACY_DEFAULTS, ...old } as Record<string, unknown>;
  if (Object.entries(LEGACY_DEFAULTS).every(([key, fallback]) => legacy[key] === fallback)) return {};
  const pattern = { grain: "grain", ruled: "lines", grid: "grid" }[String(legacy.background)] ?? "none";
  const height = Number(legacy.height) || 0;
  return {
    fontSize: legacy.fontSize,
    fontFamily: legacy.fontFamily,
    lineHeight: legacy.lineHeight,
    letterSpacing: legacy.letterSpacing,
    padding: legacy.padding,
    cornerRadius: legacy.radius,
    cardWidth: legacy.width,
    heightMode: height > 0 ? "fixed" : "auto",
    cardHeight: height > 0 ? Math.max(200, height) : 640,
    textColor: legacy.textColor,
    // The first port colored every quote with quoteColor.
    dialogueEnabled: true,
    dialogueColor: legacy.quoteColor,
    showTitle: !!legacy.title,
    titleText: legacy.title,
    showAuthor: !!legacy.author,
    authorText: legacy.author || "MARINARA",
    background:
      legacy.background === "image"
        ? { mode: "image", imageUrl: legacy.backgroundImageUrl }
        : { mode: "solid", color: legacy.backgroundColor, pattern },
  };
}

/** Stored settings in either shape. */
export const storedExcerptAppearanceSchema = z.preprocess(migrateLegacyExcerptAppearance, excerptAppearanceSchema);
