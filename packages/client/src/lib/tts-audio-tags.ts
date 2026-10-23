import { hideTTSAudioCues, normalizeTTSAudioMarkup } from "@marinara-engine/shared";

export { hideTTSAudioCues, normalizeTTSAudioMarkup };
export type TTSAudioParticipant = { kind: "character" | "persona"; id: string; name: string };
export type TTSAudioLine = TTSAudioParticipant & { text: string; start: number; end: number };

/** Only known, unambiguous identities are recoverable; code and nested markup are never speech. */
export function parseTTSAudioLines(text: string, participants: readonly TTSAudioParticipant[]): TTSAudioLine[] {
  const masked = normalizeTTSAudioMarkup(text).replace(/(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\1|$)|`[^`\n]*`/g, (code) =>
    " ".repeat(code.length),
  );
  const lines: TTSAudioLine[] = [];
  const add = (kind: string | undefined, id: string, raw: string, start: number, length: number) => {
    const matches = participants.filter((p) => p.id === id && (!kind || p.kind === kind));
    if (matches.length !== 1 || /<[^>]*>/.test(raw)) return;
    const body = raw
      .trim()
      .replace(/^(?:\*\*|__)([\s\S]*)(?:\*\*|__)$/, "$1")
      .replace(/^["“]([\s\S]*)["”]$/, "$1")
      .trim();
    if (hideTTSAudioCues(body).trim()) lines.push({ ...matches[0]!, text: body, start, end: start + length });
  };
  const pattern =
    /<audio_(character|persona)\s+id\s*=\s*(?:\*\*|__)?(?:"([A-Za-z0-9_-]{1,200})"|'([A-Za-z0-9_-]{1,200})'|([A-Za-z0-9_-]{1,200}))(?:\*\*|__)?\s*>([\s\S]*?)<\/audio_\1\s*>/gi;
  for (const m of masked.matchAll(pattern))
    add(m[1]!.toLowerCase(), m[2] || m[3] || m[4]!, m[5]!, m.index, m[0].length);
  for (const m of masked.matchAll(/<([A-Za-z0-9_-]{1,200})\s*>([\s\S]*?)<\/\1\s*>/g)) {
    if (!lines.some((line) => m.index >= line.start && m.index < line.end))
      add(undefined, m[1]!, m[2]!, m.index, m[0].length);
  }
  return lines.sort((a, b) => a.start - b.start);
}
