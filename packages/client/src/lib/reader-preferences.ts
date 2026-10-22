import { normalizeChatWidgetFont } from "./font-family";
export type ReaderPreferences = {
  letterSpacing: number;
  lineHeight: number;
  paragraphGap: number;
  width: number;
  font: string;
  indent: number;
  align: "start" | "justify";
};
export function normalizeReaderPreferences(value: unknown): ReaderPreferences {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const number = (key: string, fallback: number, min: number, max: number) =>
    typeof source[key] === "number" && Number.isFinite(source[key])
      ? Math.max(min, Math.min(max, source[key] as number))
      : fallback;
  return {
    letterSpacing: number("letterSpacing", 0, -1, 5),
    lineHeight: number("lineHeight", 1.8, 1, 3),
    paragraphGap: number("paragraphGap", 1, 0, 2),
    width: number("width", 720, 440, 1000),
    indent: number("indent", 0, 0, 4),
    font: source.font === "serif" ? "@serif" : normalizeChatWidgetFont(source.font) || "inherit",
    align: source.align === "justify" ? "justify" : "start",
  };
}
