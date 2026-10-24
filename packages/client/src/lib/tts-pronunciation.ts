// ──────────────────────────────────────────────
// Name pronunciation for read-aloud
//
// A character's or persona's "phonetic name" (editor → Voice) replaces that name wherever it appears in text sent to
// TTS, e.g. IV → フォー so a Japanese voice does not read the Roman numeral as 4 (욘). The open chat registers its
// names (ChatArea); every TTS path cleans its text through cleanTTSInputText, which applies them, so the cache key of
// a line follows its spoken text and a new pronunciation is generated anew.
// ──────────────────────────────────────────────

export type TTSPronunciation = { name: string; spoken: string };

let pronunciations: TTSPronunciation[] = [];
let pattern: RegExp | null = null;

const ASCII_WORD = /[A-Za-z0-9]/;
function escape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The names the open chat wants pronounced differently. Longer names win where one contains another. */
export function setTTSPronunciations(entries: TTSPronunciation[]) {
  const seen = new Set<string>();
  pronunciations = entries
    .map((entry) => ({ name: entry.name.trim(), spoken: entry.spoken.trim() }))
    .filter((entry) => entry.name && entry.spoken && entry.name !== entry.spoken)
    .filter((entry) => !seen.has(entry.name) && !!seen.add(entry.name))
    .sort((a, b) => b.name.length - a.name.length);
  pattern = pronunciations.length
    ? new RegExp(
        pronunciations
          .map(({ name }) => {
            // A Latin name keeps word edges against Latin letters and digits only, so "IV는" still matches
            // and "IVY" does not; other scripts match where they appear.
            const start = ASCII_WORD.test(name[0]!) ? "(?<![A-Za-z0-9])" : "";
            const end = ASCII_WORD.test(name[name.length - 1]!) ? "(?![A-Za-z0-9])" : "";
            return `${start}${escape(name)}${end}`;
          })
          .join("|"),
        "gu",
      )
    : null;
}

export function applyTTSPronunciations(text: string): string {
  if (!pattern) return text;
  return text.replace(pattern, (name) => pronunciations.find((entry) => entry.name === name)?.spoken ?? name);
}
