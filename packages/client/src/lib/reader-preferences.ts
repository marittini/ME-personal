import { normalizeChatWidgetFont } from "./font-family";
export type ReaderPreferences = {
  letterSpacing: number;
  lineHeight: number;
  paragraphGap: number;
  width: number;
  font: string;
  indent: number;
  align: "start" | "justify";
  /** How many px smaller a translation shown under the original is than the message text. */
  translationSizeOffset: number;
  /** Convo bubbles: "card" keeps each character's/persona's own look, "global" uses the colors below for all. */
  bubbleScope: "card" | "global";
  /** Page color like an e-book app; "theme" keeps the app's light/dark colors. */
  paper: ReaderPaper;
  /** Extra space on both sides of the messages, in px. */
  sideMargin: number;
  bubbleCharacterBg: string;
  bubbleCharacterText: string;
  bubblePersonaBg: string;
  bubblePersonaText: string;
};

const HEX = /^#[0-9a-f]{6}$/i;
export const READER_PAPERS = ["theme", "white", "sepia", "yellow", "green", "gray", "black"] as const;
export type ReaderPaper = (typeof READER_PAPERS)[number];
export function normalizeReaderPreferences(value: unknown): ReaderPreferences {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const number = (key: string, fallback: number, min: number, max: number) =>
    typeof source[key] === "number" && Number.isFinite(source[key])
      ? Math.max(min, Math.min(max, source[key] as number))
      : fallback;
  /** "" keeps the theme color. */
  const color = (key: string) => (typeof source[key] === "string" && HEX.test(source[key]) ? source[key] : "");
  return {
    letterSpacing: number("letterSpacing", 0, -1, 5),
    lineHeight: number("lineHeight", 1.8, 1, 3),
    paragraphGap: number("paragraphGap", 1, 0, 2),
    width: number("width", 720, 440, 1000),
    indent: number("indent", 0, 0, 4),
    font: source.font === "serif" ? "@serif" : normalizeChatWidgetFont(source.font) || "inherit",
    align: source.align === "justify" ? "justify" : "start",
    translationSizeOffset: number("translationSizeOffset", 0, 0, 8),
    bubbleScope: source.bubbleScope === "global" ? "global" : "card",
    paper: READER_PAPERS.includes(source.paper as ReaderPaper) ? (source.paper as ReaderPaper) : "theme",
    sideMargin: number("sideMargin", 0, 0, 64),
    bubbleCharacterBg: color("bubbleCharacterBg"),
    bubbleCharacterText: color("bubbleCharacterText"),
    bubblePersonaBg: color("bubblePersonaBg"),
    bubblePersonaText: color("bubblePersonaText"),
  };
}
