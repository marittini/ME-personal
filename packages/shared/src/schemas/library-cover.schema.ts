import { z } from "zod";
import { avatarCropSchema } from "./avatar-crop.schema.js";

export const libraryCoverSchema = z.object({
  url: z.string().regex(/^\/api\/avatars\/file\/library-cover-[a-f0-9-]+\.(?:webp|png|gif)$/),
  crop: avatarCropSchema.nullable(),
});
export type LibraryCover = z.infer<typeof libraryCoverSchema>;

/** Validate local and synced settings before passing URLs/crops into the renderer. */
export function normalizeLibraryCovers(value: unknown): Record<string, LibraryCover> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      const parsed = libraryCoverSchema.safeParse(entry);
      return parsed.success && key.length <= 4096 ? [[key, parsed.data]] : [];
    }),
  );
}

export const libraryCustomizationSchema = z.object({
  title: z.string().max(300).default(""),
  displayName: z.string().max(200).default(""),
  description: z.string().max(8000).default(""),
});
export type LibraryCustomization = z.infer<typeof libraryCustomizationSchema>;
export function normalizeLibraryCustomizations(value: unknown): Record<string, LibraryCustomization> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      const parsed = libraryCustomizationSchema.safeParse(entry);
      return parsed.success && key.length <= 4096 ? [[key, parsed.data]] : [];
    }),
  );
}
