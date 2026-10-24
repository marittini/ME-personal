import { normalizeChatWidgetFont } from "./font-family";

/** Page colors, which are also the whole app's theme: two light (화이트, 크림) and two dark (먹색, 블랙). */
export const READER_PAGES = ["white", "cream", "ink", "black"] as const;
export type ReaderPage = (typeof READER_PAGES)[number];
export type ReaderMode = "roleplay" | "conversation";
export type ReaderAppTheme = "dark" | "light";

/** Paragraph layout, saved separately for the novel reader (RP) and the messenger (Convo). */
export type ReaderLayoutPreferences = {
  letterSpacing: number;
  lineHeight: number;
  paragraphGap: number;
  width: number;
  align: "start" | "justify";
  /** Extra space on both sides of the messages, in px. */
  sideMargin: number;
  /** How many px smaller a translation shown under the original is than the message text. */
  translationSizeOffset: number;
};
/** How a message's time shows: date and time, the time only, or not at all. */
export type ReaderTimestampStyle = "datetime" | "time" | "hidden";
export const READER_TIMESTAMP_STYLES: ReaderTimestampStyle[] = ["datetime", "time", "hidden"];
/** What each mode showed before the choice existed: Convo the day and time, RP the time. */
export const DEFAULT_READER_TIMESTAMP: Record<ReaderMode, ReaderTimestampStyle> = {
  roleplay: "time",
  conversation: "datetime",
};
export function readerTimestampStyle(value: unknown, mode: ReaderMode): ReaderTimestampStyle {
  return READER_TIMESTAMP_STYLES.includes(value as ReaderTimestampStyle)
    ? (value as ReaderTimestampStyle)
    : DEFAULT_READER_TIMESTAMP[mode];
}
export type RoleplayReaderPreferences = ReaderLayoutPreferences & { indent: number; timestamp: ReaderTimestampStyle };
export type ConversationReaderPreferences = ReaderLayoutPreferences & {
  timestamp: ReaderTimestampStyle;
  /** "card" keeps each character's/persona's own look, "global" uses the colors below for all. */
  bubbleScope: "card" | "global";
  bubbleCharacterBg: string;
  bubbleCharacterText: string;
  bubblePersonaBg: string;
  bubblePersonaText: string;
};
export type ReaderPreferences = {
  /** 2 = split format. Older saves have no version and are read once into this format. */
  version: 2;
  /** Used by RP and Convo alike. The text size is the app's chat text size (`chatFontSize`). */
  shared: { page: ReaderPage; font: string };
  roleplay: RoleplayReaderPreferences;
  conversation: ConversationReaderPreferences;
};
/** What one reader mode applies: the shared values plus that mode's own layout. */
export type ReaderModePreferences = ReaderPreferences["shared"] &
  ReaderLayoutPreferences &
  Omit<ConversationReaderPreferences, keyof ReaderLayoutPreferences> & { indent: number };

const HEX = /^#[0-9a-f]{6}$/i;
const LEGACY_PAPERS: Record<string, ReaderPage> = {
  white: "white",
  sepia: "cream",
  yellow: "cream",
  green: "cream",
  gray: "ink",
  black: "black",
};

export const readerPageTheme = (page: ReaderPage): ReaderAppTheme =>
  page === "white" || page === "cream" ? "light" : "dark";

/** A theme changed elsewhere (engine settings) wins: a page of the other brightness falls back to 크림/먹색. */
export function effectiveReaderPage(page: ReaderPage, theme: ReaderAppTheme): ReaderPage {
  if (readerPageTheme(page) === theme) return page;
  return theme === "light" ? "cream" : "ink";
}

export function isCurrentReaderPreferences(value: unknown): boolean {
  return !!value && typeof value === "object" && (value as { version?: unknown }).version === 2;
}

function reader(source: Record<string, unknown>) {
  const number = (key: string, fallback: number, min: number, max: number) =>
    typeof source[key] === "number" && Number.isFinite(source[key])
      ? Math.max(min, Math.min(max, source[key] as number))
      : fallback;
  /** "" keeps the theme color. */
  const color = (key: string) => (typeof source[key] === "string" && HEX.test(source[key]) ? source[key] : "");
  const layout = (): ReaderLayoutPreferences => ({
    letterSpacing: number("letterSpacing", 0, -1, 5),
    lineHeight: number("lineHeight", 1.8, 1, 3),
    paragraphGap: number("paragraphGap", 1, 0, 2),
    width: number("width", 720, 440, 1000),
    align: source.align === "justify" ? "justify" : "start",
    sideMargin: number("sideMargin", 0, 0, 64),
    translationSizeOffset: number("translationSizeOffset", 0, 0, 8),
  });
  return {
    roleplay: (): RoleplayReaderPreferences => ({
      ...layout(),
      indent: number("indent", 0, 0, 4),
      timestamp: readerTimestampStyle(source.timestamp, "roleplay"),
    }),
    conversation: (): ConversationReaderPreferences => ({
      ...layout(),
      timestamp: readerTimestampStyle(source.timestamp, "conversation"),
      bubbleScope: source.bubbleScope === "global" ? "global" : "card",
      bubbleCharacterBg: color("bubbleCharacterBg"),
      bubbleCharacterText: color("bubbleCharacterText"),
      bubblePersonaBg: color("bubblePersonaBg"),
      bubblePersonaText: color("bubblePersonaText"),
    }),
    font: () => (source.font === "serif" ? "@serif" : normalizeChatWidgetFont(source.font) || "inherit"),
  };
}

const record = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/**
 * Reads saved reader preferences. The current format is only cleaned up. An older flat save is converted once:
 * its layout is copied to both modes and its page color comes from the old page color and app theme
 * (light → 크림, dark → 먹색; 흰색 → 화이트, 세피아·노랑·초록 → 크림, 회색 → 먹색, 검정 → 블랙).
 */
export function normalizeReaderPreferences(value: unknown, theme: ReaderAppTheme = "dark"): ReaderPreferences {
  const source = record(value);
  if (isCurrentReaderPreferences(value)) {
    const shared = record(source.shared);
    return {
      version: 2,
      shared: {
        page: READER_PAGES.includes(shared.page as ReaderPage) ? (shared.page as ReaderPage) : "ink",
        font: reader(shared).font(),
      },
      roleplay: reader(record(source.roleplay)).roleplay(),
      conversation: reader(record(source.conversation)).conversation(),
    };
  }
  const legacy = reader(source);
  return {
    version: 2,
    shared: {
      page:
        LEGACY_PAPERS[typeof source.paper === "string" ? source.paper : ""] ?? (theme === "light" ? "cream" : "ink"),
      font: legacy.font(),
    },
    roleplay: legacy.roleplay(),
    conversation: legacy.conversation(),
  };
}

export function readerModePreferences(preferences: ReaderPreferences, mode: ReaderMode): ReaderModePreferences {
  const { roleplay, conversation, shared } = preferences;
  const own = mode === "conversation" ? conversation : roleplay;
  return {
    ...shared,
    letterSpacing: own.letterSpacing,
    lineHeight: own.lineHeight,
    paragraphGap: own.paragraphGap,
    width: own.width,
    align: own.align,
    sideMargin: own.sideMargin,
    translationSizeOffset: own.translationSizeOffset,
    timestamp: own.timestamp,
    // Paragraph indent is a novel-page setting; Convo bubbles never indent.
    indent: mode === "roleplay" ? roleplay.indent : 0,
    bubbleScope: conversation.bubbleScope,
    bubbleCharacterBg: conversation.bubbleCharacterBg,
    bubbleCharacterText: conversation.bubbleCharacterText,
    bubblePersonaBg: conversation.bubblePersonaBg,
    bubblePersonaText: conversation.bubblePersonaText,
  };
}
