export type TTSAudioParticipant = { kind: "character" | "persona"; id: string; name: string };
export type TTSAudioLine = TTSAudioParticipant & { text: string; start: number; end: number };

/** Decode only audio wrappers, outside code, leaving arbitrary HTML and source data alone. */
export function normalizeTTSAudioMarkup(text: string): string {
  const protectedOrTag =
    /(`{3,}|~{3,})[^\n]*\n[\s\S]*?\1|`[^`\n]*`|(?:&(?:amp;)?lt;|&#0*60;|&#x0*3c;|〈|＜)(\/?audio_(?:character|persona)\b[^<>\r\n]{0,1000}?)(?:&(?:amp;)?gt;|&#0*62;|&#x0*3e;|〉|＞)/gi;
  return text.replace(protectedOrTag, (whole, _fence, tag: string | undefined) =>
    tag
      ? `<${tag.replace(/&(?:amp;)?(?:quot|#34|#x22);/gi, '"').replace(/&(?:amp;)?(?:apos|#39|#x27);/gi, "'")}>`
      : whole,
  );
}

/** Only known, unambiguous identities are recoverable; code and nested markup are never speech. */
export function parseTTSAudioLines(text: string, participants: readonly TTSAudioParticipant[]): TTSAudioLine[] {
  const masked = normalizeTTSAudioMarkup(text).replace(/(`{3,}|~{3,})[^\n]*\n[\s\S]*?\1|`[^`\n]*`/g, (code) =>
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

/** Display only. A cue in spoken quotes/wrappers is open vocabulary; ordinary notes, links and code survive. */
export function hideTTSAudioCues(text: string): string {
  let audio = false;
  let quoted = false;
  return normalizeTTSAudioMarkup(text).replace(
    /(`{3,}|~{3,})[^\n]*\n[\s\S]*?\1|`[^`\n]*`|<\/?audio_(?:character|persona)\b[^>]*>|["“”「」『』]|\[([^\]\r\n]{1,160})\](?!\s*(?:\(|:))[ \t]*/gi,
    (match, _fence, cue: string | undefined) => {
      if (match.startsWith("<")) {
        audio = !match.startsWith("</");
        return "";
      }
      if (/^["“”「」『』]$/.test(match)) {
        quoted = !quoted;
        return match;
      }
      if (!cue) return match;
      return audio ||
        quoted ||
        /^(?:(?:voice|delivery)\s*:[^\r\n]+|(?:(?:short|long|brief) pause|(?:soft|quiet|nervous) (?:chuckles?|laughs?)|whispering|whisper|laughs?|laughing|sighs?|pause|breathy|inhale|exhales?|chuckles?|shouts?|shouting|crying|angry|sad|annoyed|happy|sarcastic|excited|thoughtful|surprised|curious|mischievously|clears throat|sniffs?|sniffles?|sobbing|gasping|gasps?|giggles?|coughs?|yawns?|softly|nervously|calmly|속삭임|속삭이며|한숨|웃음|울음|흐느낌|화남|슬픔|기쁨|놀람)(?:[\s,;/+-]+(?:and|very|slightly|softly|quietly|loudly|slowly|whispering|laughing|crying|angry|sad|happy|sarcastic|excited|nervously|calmly|breathy|sighs?))*)$/i.test(
          cue.trim(),
        )
        ? ""
        : match;
    },
  );
}
