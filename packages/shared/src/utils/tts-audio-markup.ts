// Display/translation helpers for ElevenLabs-style audio markup (<audio_character|persona> wrappers and
// [cue] tags). Shared by the reader (display) and the server (translation input), so both strip the same way.

/** Decode only audio wrappers, outside code, leaving arbitrary HTML and source data alone. */
export function normalizeTTSAudioMarkup(text: string): string {
  const protectedOrTag =
    /(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\1|$)|`[^`\n]*`|(?:&(?:amp;)?lt;|&#0*60;|&#x0*3c;|〈|＜)(\/?audio_(?:character|persona)\b[^<>\r\n]{0,1000}?)(?:&(?:amp;)?gt;|&#0*62;|&#x0*3e;|〉|＞)/gi;
  return text.replace(protectedOrTag, (whole, _fence, tag: string | undefined) =>
    tag
      ? `<${tag.replace(/&(?:amp;)?(?:quot|#34|#x22);/gi, '"').replace(/&(?:amp;)?(?:apos|#39|#x27);/gi, "'")}>`
      : whole,
  );
}

/**
 * Display only. Inside audio wrappers or spoken quotes, an open-vocabulary cue such as `[calm, flat]` is
 * hidden when it is made of words only. In plain quotes it must also stand apart from the next word, so
 * quoted references such as `“[문서 3쪽]을 펼쳐.”` or `“[참조]를 봐”` stay visible. Notes, links and code survive.
 */
export function hideTTSAudioCues(text: string): string {
  let audio = false;
  let quoted = false;
  return normalizeTTSAudioMarkup(text).replace(
    /(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\1|$)|`[^`\n]*`|<\/?audio_(?:character|persona)\b[^>]*>|["“”「」『』]|\[([^\]\r\n]{1,160})\](?!\s*(?:\(|:))[ \t]*/gi,
    (match: string, _fence, cue: string | undefined, offset: number, source: string) => {
      if (match.startsWith("<")) {
        audio = !match.startsWith("</");
        return "";
      }
      if (/^["“”「」『』]$/.test(match)) {
        quoted = !quoted;
        return match;
      }
      if (!cue) return match;
      const wordsOnly = /^[\p{L}\p{M}\s,;/+'’-]+$/u.test(cue.trim());
      const standsApart = /[ \t]$/.test(match) || !/[\p{L}\p{N}]/u.test(source[offset + match.length] ?? "");
      return (wordsOnly && (audio || (quoted && standsApart))) ||
        /^(?:(?:voice|delivery)\s*:[^\r\n]+|(?:(?:short|long|brief) pause|(?:soft|quiet|nervous) (?:chuckles?|laughs?)|whispering|whisper|laughs?|laughing|sighs?|pause|breathy|inhale|exhales?|chuckles?|shouts?|shouting|crying|angry|sad|annoyed|happy|sarcastic|excited|thoughtful|surprised|curious|mischievously|clears throat|sniffs?|sniffles?|sobbing|gasping|gasps?|giggles?|coughs?|yawns?|softly|nervously|calmly|속삭임|속삭이며|한숨|웃음|울음|흐느낌|화남|슬픔|기쁨|놀람)(?:[\s,;/+-]+(?:and|very|slightly|softly|quietly|loudly|slowly|whispering|laughing|crying|angry|sad|happy|sarcastic|excited|nervously|calmly|breathy|sighs?))*)$/i.test(
          cue.trim(),
        )
        ? ""
        : match;
    },
  );
}
