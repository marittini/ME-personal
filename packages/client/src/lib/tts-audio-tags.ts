export type TTSAudioParticipant = { kind: "character" | "persona"; id: string; name: string };
export type TTSAudioLine = TTSAudioParticipant & { text: string; start: number };

/** Read only known speakers. Code samples and nested markup never become paid speech. */
export function parseTTSAudioLines(text: string, participants: readonly TTSAudioParticipant[]): TTSAudioLine[] {
  const masked = text.replace(/(`{3,}|~{3,})[^\n]*\n[\s\S]*?\1/g, (code) => " ".repeat(code.length));
  const pattern =
    /<audio_(character|persona)\s+id\s*=\s*(?:"([A-Za-z0-9_-]{1,200})"|'([A-Za-z0-9_-]{1,200})')\s*>([\s\S]*?)<\/audio_\1\s*>/gi;
  const lines: TTSAudioLine[] = [];
  for (const match of masked.matchAll(pattern)) {
    const kind = match[1]?.toLowerCase();
    const raw = match[4];
    if (!kind || raw === undefined) continue;
    const matches = participants.filter(
      (participant) => participant.kind === kind && participant.id === (match[2] || match[3]),
    );
    const participant = matches[0];
    if (matches.length !== 1 || !participant || /<[^>]*>/.test(raw)) continue;
    const body = raw
      .trim()
      .replace(/^["“]([\s\S]*)["”]$/, "$1")
      .trim();
    if (body) lines.push({ ...participant, text: body, start: match.index });
  }
  return lines;
}

/** Display transformation only: raw text remains available to editing, translation and synthesis. */
export function hideTTSAudioCues(text: string): string {
  return text.replace(
    /(`{3,}|~{3,})[^\n]*\n[\s\S]*?\1|`[^`\n]*`|<\/?audio_(?:character|persona)\b[^>]*>|\[([^\]\r\n]{1,80})\](?!\s*(?:\(|:))[ \t]*/gi,
    (match, _fence, cue: string | undefined) => {
      if (match.startsWith("<")) return "";
      if (!cue) return match;
      // Match whole cue expressions, so a note such as [happy ending] remains visible.
      return /^(?:(?:voice|delivery)\s*:[^\r\n]+|(?:whispering|whisper|laughs?|laughing|sighs?|pause|breathy|inhale|exhales?|chuckles?|shouts?|shouting|crying|angry|sad|annoyed|happy|sarcastic|excited|thoughtful|surprised|curious|mischievously|clears throat|sniffs?|sniffles?|sobbing|gasping|gasps?|giggles?|coughs?|yawns?|softly|nervously|calmly|속삭임|속삭이며|한숨|웃음|울음|흐느낌|화남|슬픔|기쁨|놀람)(?:[\s,;/+-]+(?:and|very|slightly|softly|quietly|loudly|slowly|whispering|laughing|crying|angry|sad|happy|sarcastic|excited|nervously|calmly|breathy|sighs?))*)$/i.test(
        cue.trim(),
      )
        ? ""
        : match;
    },
  );
}
