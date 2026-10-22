import { BACKGROUND_THUMBNAIL_WIDTH } from "@marinara-engine/shared";

/** Only local image endpoints support bounded previews. Preserve cache-busting and external/data URLs. */
export function imagePreviewUrl(value: string): string {
  if (!value.startsWith("/api/avatars/file/") && !value.startsWith("/api/backgrounds/file/")) return value;
  const url = new URL(value, "http://localhost");
  url.searchParams.set("w", String(BACKGROUND_THUMBNAIL_WIDTH));
  return `${url.pathname}${url.search}${url.hash}`;
}
