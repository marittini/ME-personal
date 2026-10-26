// Numbered sentences for memory extraction: the model cites "2.3" (message 2 of the batch, sentence 3) and the
// server copies the words from the transcript, so kept lines and quotes are always exact and the model does not
// spend output tokens copying them. The splitting follows marinara-memory-module (MIT, tlsiddl): paragraph breaks
// always split, sentence ends split inside a paragraph, never inside quotes or parentheses.

const OPENERS: Record<string, string> = { "“": "”", "「": "」", "『": "』", "(": ")", "‘": "’" };
const ENDERS = new Set([".", "!", "?", "…", "。", "？", "！"]);
const FULL_WIDTH_ENDERS = new Set(["。", "？", "！"]);
const CLOSERS_AFTER_END = new Set(["”", '"', "’", "'", ")", "]", "」", "』"]);

function splitSentences(paragraph: string) {
  const parts: string[] = [];
  const stack: string[] = [];
  let straightOpen = false;
  let start = 0;
  for (let i = 0; i < paragraph.length; i++) {
    const ch = paragraph[i]!;
    if (ch === '"') straightOpen = !straightOpen;
    else if (OPENERS[ch]) stack.push(OPENERS[ch]!);
    else if (stack.length && ch === stack[stack.length - 1]) stack.pop();
    if (stack.length || straightOpen) continue;
    if (ENDERS.has(ch) || (CLOSERS_AFTER_END.has(ch) && ENDERS.has(paragraph[i - 1] ?? ""))) {
      let j = i + 1;
      while (j < paragraph.length && CLOSERS_AFTER_END.has(paragraph[j]!) && paragraph[j] !== '"') j++;
      // Japanese and Chinese sentence ends are not followed by a space; a full-width end mark splits there too.
      if (j < paragraph.length && (/\s/.test(paragraph[j]!) || FULL_WIDTH_ENDERS.has(ch))) {
        parts.push(paragraph.slice(start, j));
        start = j;
        // Resume at the next character itself: it may open a quote.
        i = j - 1;
      }
    }
  }
  const rest = paragraph.slice(start);
  // An unclosed quote would swallow the rest of the paragraph: split that rest plainly instead.
  if (straightOpen || stack.length) parts.push(...rest.split(/(?<=[.!?…。？！])\s+(?=\S)/u));
  else parts.push(rest);
  return parts;
}

/** One message split into sentences. */
export function memorySentences(text: string) {
  const out: string[] = [];
  for (const paragraph of String(text || "").split(/\n+/)) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;
    for (const part of splitSentences(trimmed)) {
      const sentence = part.trim();
      if (sentence) out.push(sentence);
    }
  }
  return out;
}

/** The message rendered with its sentence numbers: "[2.1] First sentence. [2.2] Second." (paragraphs kept). */
export function numberedMemoryText(text: string, message: number) {
  let index = 0;
  return String(text || "")
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) =>
      splitSentences(paragraph)
        .map((part) => part.trim())
        .filter(Boolean)
        .map((sentence) => `[${message}.${++index}] ${sentence}`)
        .join(" "),
    )
    .join("\n");
}

/** The sentence a reference like "2.3" names, among the batch's messages in order; undefined when there is none. */
export function sentenceAt(ref: unknown, messages: readonly string[][]) {
  const match = typeof ref === "string" || typeof ref === "number" ? /^(\d+)\.(\d+)$/.exec(String(ref).trim()) : null;
  if (!match) return undefined;
  const message = Number(match[1]);
  const sentence = Number(match[2]);
  const text = messages[message - 1]?.[sentence - 1];
  return text === undefined ? undefined : { message: message - 1, text };
}

/**
 * The spoken words inside a sentence: every quoted part, joined ("“Wait,” he says, “come back.”" → "Wait, come
 * back."), or the whole sentence when nothing is quoted. Each quote mark closes only its own pair, so an apostrophe
 * (don’t) or a single inner quote never cuts a line short.
 */
export function spokenPart(sentence: string) {
  const parts = [...sentence.matchAll(/“([^”]+)”|"([^"]+)"|「([^」]+)」|『([^』]+)』|«([^»]+)»/gu)]
    .map((match) => (match.slice(1).find((group) => group !== undefined) ?? "").trim())
    .filter(Boolean);
  return (parts.length ? parts.join(" ") : sentence).trim();
}
