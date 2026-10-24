import { DIALOGUE_QUOTE_PATTERN_SOURCE } from "./dialogue-quotes";
/**
 * Translation-only view: which translated quotes carry the tagged lines. A translation can quote more than the
 * original speaks (narration quoting 『…』 or 「…」 comes back as "…"), so counting every translated quote no longer
 * matches the speech groups. Paragraphs do line up (the translation keeps the original's paragraph breaks), so each
 * tagged paragraph keeps as many leading quotes of its translated paragraph as it has tagged lines.
 */
const PARAGRAPH_BREAK = /\n[ \t]*\n/;
const TAG = /<audio_(?:character|persona)\b/g;

function paragraphs(text: string) {
  return text.split(PARAGRAPH_BREAK).filter((part) => part.trim().length > 0);
}

/** Tagged lines per original paragraph (blank paragraphs dropped). */
export function taggedLinesPerParagraph(text: string) {
  return paragraphs(text).map((part) => part.match(TAG)?.length ?? 0);
}

/** The paragraph (blank paragraphs dropped) each node starts in, from the text before it in `container`. */
function paragraphIndex(container: Element, node: Element) {
  const range = document.createRange();
  range.setStart(container, 0);
  range.setEndBefore(node);
  const before = range.toString();
  // Count only breaks between non-blank paragraphs, as `paragraphs` does.
  return Math.max(0, paragraphs(`${before}\u0000`).length - 1);
}

export function alignTranslatedQuotes(text: string, quotes: HTMLElement[], groups: number): HTMLElement[] {
  const perParagraph = taggedLinesPerParagraph(text);
  if (perParagraph.reduce((sum, count) => sum + count, 0) !== groups) return [];
  const byParagraph = new Map<number, HTMLElement[]>();
  for (const quote of quotes) {
    const container = quote.closest(".translation-text, .mari-message-content");
    if (!container) return [];
    if (paragraphs(container.textContent ?? "").length !== perParagraph.length) return [];
    const index = paragraphIndex(container, quote);
    byParagraph.set(index, [...(byParagraph.get(index) ?? []), quote]);
  }
  const picked: HTMLElement[] = [];
  for (const [index, count] of perParagraph.entries()) {
    if (!count) continue;
    const inParagraph = byParagraph.get(index) ?? [];
    if (inParagraph.length < count) return [];
    picked.push(...inParagraph.slice(0, count));
  }
  return picked.length === groups ? picked : [];
}

// ── Text matching (narration that quotes words) ────────────────────────────────────────────────────────────────
// Counting quotes fails whenever narration quotes something (『…』, 「…」, a "word"): there are more quotes on the
// page than spoken lines, and every control used to fall into a row under the message. Matching by text keeps each
// control in its own line; a line that cannot be placed is the only one left for the row.

/** A spoken line or a quote reduced to its words: no delivery cues, markup, quote marks, punctuation or spaces. */
export function spokenKey(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/[\p{P}\p{S}\s]/gu, "")
    .toLowerCase();
}

function sameLine(line: string, quote: string) {
  if (!line || !quote) return false;
  if (line === quote) return true;
  // A long line split into several chunks, or a quote that holds a little more than the spoken words.
  const [short, long] = line.length < quote.length ? [line, quote] : [quote, line];
  return short.length >= 2 && long.includes(short) && short.length >= long.length * 0.5;
}

/** For each spoken line, in order, the index of the quote that carries it (quotes in page order), or null. */
export function matchLinesToQuotes(lines: string[], quotes: string[]): Array<number | null> {
  const keys = quotes.map(spokenKey);
  const result: Array<number | null> = [];
  let from = 0;
  for (const line of lines) {
    const key = spokenKey(line);
    let found: number | null = null;
    for (let index = from; index < keys.length; index++) {
      if (sameLine(key, keys[index]!)) {
        found = index;
        break;
      }
    }
    result.push(found);
    if (found !== null) from = found + 1;
  }
  return result;
}

const QUOTE = new RegExp(`(?:${DIALOGUE_QUOTE_PATTERN_SOURCE})`, "gu");

/** The quotes of each original paragraph (wrappers and HTML removed), in order. */
export function originalQuotesPerParagraph(text: string): string[][] {
  return paragraphs(text.replace(/<[^>]+>/g, "")).map((part) => [...part.matchAll(QUOTE)].map((match) => match[0]));
}

/**
 * Translated quotes, given as the paragraph each starts in, for each spoken line: the translated quote that carries
 * it, or null. A translated paragraph with as many quotes as its original maps quote for quote; one with exactly as
 * many quotes as the paragraph has spoken lines maps line for line; anything else is left unplaced.
 */
export function matchLinesToTranslatedQuotes(
  original: string,
  lines: string[],
  translatedParagraphs: number[],
): Array<number | null> {
  const perParagraph = originalQuotesPerParagraph(original);
  const flat = perParagraph.flatMap((quotes, paragraph) =>
    quotes.map((quote, ordinal) => ({ quote, paragraph, ordinal })),
  );
  const spoken = matchLinesToQuotes(
    lines,
    flat.map((entry) => entry.quote),
  ).map((index) => (index === null ? null : flat[index]!));
  const translatedByParagraph = new Map<number, number[]>();
  translatedParagraphs.forEach((paragraph, index) =>
    translatedByParagraph.set(paragraph, [...(translatedByParagraph.get(paragraph) ?? []), index]),
  );
  return spoken.map((entry) => {
    if (!entry) return null;
    const translated = translatedByParagraph.get(entry.paragraph) ?? [];
    if (translated.length === perParagraph[entry.paragraph]!.length) return translated[entry.ordinal] ?? null;
    const spokenHere = spoken.filter((other) => other?.paragraph === entry.paragraph);
    if (translated.length === spokenHere.length) return translated[spokenHere.indexOf(entry)] ?? null;
    // Paragraphs merged or split in translation, but every quote is still there: map quote for quote overall.
    if (translatedParagraphs.length === flat.length) return flat.indexOf(entry);
    return null;
  });
}

/** The paragraph (as `paragraphs` counts them) each quote node starts in, within its message or translation. */
export function quoteParagraphs(quotes: HTMLElement[]): number[] | null {
  const result: number[] = [];
  for (const quote of quotes) {
    const container = quote.closest(".translation-text, .mari-message-content");
    if (!container) return null;
    result.push(paragraphIndex(container, quote));
  }
  return result;
}

/**
 * A translation that kept the speech wrappers (`<audio_character …>"…"</audio_character>`) says exactly which of its
 * quotes are spoken, whatever the narration quotes (『…』 and 「…」 often come back as "…"). For each spoken line, the
 * index of its translated quote among all quotes of the translation; null when the wrappers do not fit the lines.
 */
export function matchLinesToWrappedTranslation(translation: string, lines: number): Array<number | null> | null {
  if (!/<audio_(?:character|persona)\b/i.test(translation)) return null;
  // Wrappers become markers and other markup goes, so quotes inside attributes never count.
  const marked = translation
    .replace(/<audio_(?:character|persona)\b[^>]*>/gi, "\u0001")
    .replace(/<\/audio_(?:character|persona)>/gi, "\u0002")
    .replace(/<[^>]+>/g, "");
  const spoken: number[] = [];
  let index = 0;
  for (const match of marked.matchAll(QUOTE)) {
    // A wrapper normally holds one quote; only its first quote is the line's anchor.
    if (spokenStart(marked.slice(0, match.index))) spoken.push(index);
    index++;
  }
  return spoken.length === lines ? spoken : null;
}

/** True when no quote has been seen since the last wrapper opened (`before` ends inside a wrapper). */
function spokenStart(before: string) {
  const start = before.lastIndexOf("\u0001");
  if (start < 0 || before.lastIndexOf("\u0002") > start) return false;
  return !new RegExp(`(?:${DIALOGUE_QUOTE_PATTERN_SOURCE})`, "u").test(before.slice(start + 1));
}

/** How many quotes the translation's own text holds (markup removed), to check the page shows all of them. */
export function translationQuoteCount(translation: string): number {
  return [...translation.replace(/<[^>]+>/g, "").matchAll(QUOTE)].length;
}
