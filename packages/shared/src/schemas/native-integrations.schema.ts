import { z } from "zod";

const id = z.string().min(1).max(200);
export const weatherLocationSchema = z.object({
  name: z.string().max(100),
  label: z.string().max(200),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  timezone: z.string().max(100).optional(),
  source: z.string().max(30).optional(),
});
export const glossaryEntrySchema = z.object({
  source: z.string().min(1).max(200),
  target: z.string().min(1).max(500),
  notes: z.string().max(1000).default(""),
});
export const translationRoomSchema = z.object({
  presetId: id.nullable().default(null),
  outgoingPresetId: id.nullable().default(null),
  glossary: z.array(glossaryEntrySchema).max(500).default([]),
  style: z.string().max(10000).default(""),
  freeContext: z.string().max(30000).default(""),
  loreEntries: z
    .array(z.object({ book: id, id }))
    .max(200)
    .default([]),
  contextMessages: z.number().int().min(0).max(50).default(0),
  contextIncludeOriginal: z.boolean().default(true),
  contextIncludeTranslation: z.boolean().default(false),
  contextIncludeUserInput: z.boolean().default(true),
});
export const nativeIntegrationsSchema = z.object({
  revision: z.number().int().nonnegative().default(0),
  weather: z
    .object({
      enabled: z.boolean().default(false),
      userLocation: weatherLocationSchema.nullable().default(null),
      rooms: z
        .record(z.object({ enabled: z.boolean(), characterLocation: weatherLocationSchema.nullable().default(null) }))
        .default({}),
    })
    .default({}),
  translation: z
    .object({
      presets: z
        .array(
          z.object({
            id,
            name: z.string().min(1).max(200),
            prompt: z.string().max(5000),
            /** false keeps the chat's own translation prompt; custom presets replace it like the extension did. */
            replace: z.boolean().default(true),
            /** Empty follows the chat's translation language. */
            targetLanguage: z.string().max(100).optional(),
            connectionId: id.optional(),
          }),
        )
        .max(200)
        .default([]),
      defaults: translationRoomSchema.default({}),
      rooms: z.record(translationRoomSchema).default({}),
    })
    .default({}),
  globalPreset: z
    .object({
      enabled: z.boolean().default(false),
      presetId: id.nullable().default(null),
      presetName: z.string().max(300).default(""),
      modes: z.array(z.enum(["roleplay", "conversation"])).default(["roleplay"]),
      rooms: z
        .record(
          z.object({
            mode: z.enum(["follow", "fixed", "none"]),
            presetId: id.nullable().default(null),
            presetName: z.string().max(300).default(""),
          }),
        )
        .default({}),
      history: z
        .array(
          z.object({
            time: z.string(),
            chatId: z.string(),
            from: z.string().nullable(),
            to: z.string().nullable(),
            reason: z.string(),
          }),
        )
        .max(300)
        .default([]),
    })
    .default({}),
  excerpt: z
    .object({
      width: z.number().int().min(320).max(2000).default(720),
      height: z.number().int().min(0).max(5000).default(0),
      padding: z.number().min(10).max(150).default(48),
      fontSize: z.number().min(10).max(80).default(24),
      lineHeight: z.number().min(1).max(3).default(1.7),
      letterSpacing: z.number().min(-2).max(10).default(0),
      radius: z.number().min(0).max(100).default(16),
      fontFamily: z.string().max(200).default(""),
      title: z.string().max(300).default(""),
      author: z.string().max(200).default(""),
      background: z.enum(["paper", "grain", "ruled", "grid", "image"]).default("paper"),
      backgroundColor: z
        .string()
        .regex(/^#[a-fA-F0-9]{6}$/)
        .default("#fbf8f3"),
      textColor: z
        .string()
        .regex(/^#[a-fA-F0-9]{6}$/)
        .default("#302a25"),
      quoteColor: z
        .string()
        .regex(/^#[a-fA-F0-9]{6}$/)
        .default("#936b4b"),
      backgroundImageUrl: z
        .string()
        .regex(/^\/api\/avatars\/file\/library-cover-[a-f0-9-]+\.(?:webp|png|gif)$/)
        .nullable()
        .default(null),
    })
    .default({}),
});
export type NativeIntegrations = z.infer<typeof nativeIntegrationsSchema>;
export type WeatherLocation = z.infer<typeof weatherLocationSchema>;
