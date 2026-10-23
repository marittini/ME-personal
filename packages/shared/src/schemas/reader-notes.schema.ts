import { z } from "zod";
import { readerExcerptAnchorSchema } from "./reader-excerpt.schema.js";

/**
 * Reading notes kept on the chat like a novel reader app: colored sentence highlights with an optional
 * private memo, and reading-position bookmarks. Display-only; never added to prompts.
 */
export const readerHighlightSchema = z.object({
  id: z.string().min(1).max(100),
  color: z.enum(["y", "g", "p", "b"]),
  /** Private memo; empty for a plain highlight. */
  note: z.string().max(5000).default(""),
  text: z.string().min(1).max(20000),
  anchors: z.array(readerExcerptAnchorSchema).min(1).max(100),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const readerHighlightsSchema = z.array(readerHighlightSchema).max(2000);
export type ReaderHighlight = z.infer<typeof readerHighlightSchema>;

export const readerBookmarkSchema = z.object({
  id: z.string().min(1).max(100),
  label: z.string().max(200).default(""),
  messageId: z.string().min(1).max(200),
  messageNumber: z.number().int().positive(),
  /** Distance of the message top from the reading area top when the bookmark was placed. */
  offset: z.number().finite(),
  /** Opening text at the bookmarked spot, shown in the list. */
  snippet: z.string().max(300).default(""),
  createdAt: z.string().datetime(),
});
export const readerBookmarksSchema = z.array(readerBookmarkSchema).max(500);
export type ReaderBookmark = z.infer<typeof readerBookmarkSchema>;
