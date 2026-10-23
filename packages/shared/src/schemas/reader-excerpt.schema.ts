import { z } from "zod";
import { excerptAppearanceSchema } from "./excerpt-appearance.schema.js";
export const excerptMarkSchema = z
  .object({
    start: z.number().int().min(0),
    end: z.number().int().min(1).max(20000),
    type: z.enum(["highlight", "underline", "hide", "replace"]),
    /** Highlighter/underline color key; absent on marks saved before colors existed (shown as yellow). */
    color: z.enum(["y", "g", "p", "b"]).optional(),
    value: z.string().max(20000).optional(),
  })
  .refine((mark) => mark.end > mark.start);
export const readerExcerptAnchorSchema = z
  .object({
    messageId: z.string().min(1).max(200),
    messageNumber: z.number().int().positive(),
    start: z.number().int().min(0),
    end: z.number().int().positive(),
    fingerprint: z.string().max(32),
    exact: z.string().max(20000),
  })
  .refine((anchor) => anchor.end > anchor.start);
export const readerExcerptSchema = z.object({
  id: z.string().min(1).max(100),
  text: z.string().min(1).max(20000),
  marks: z.array(excerptMarkSchema).max(500),
  anchors: z.array(readerExcerptAnchorSchema).max(100),
  /** Card appearance saved with the excerpt; older excerpts use the current default appearance. */
  appearance: excerptAppearanceSchema.optional(),
  updatedAt: z.string().datetime(),
});
export const readerExcerptsSchema = z.array(readerExcerptSchema).max(200);
export type ReaderExcerpt = z.infer<typeof readerExcerptSchema>;
export type ReaderExcerptAnchor = z.infer<typeof readerExcerptAnchorSchema>;
