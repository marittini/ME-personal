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
