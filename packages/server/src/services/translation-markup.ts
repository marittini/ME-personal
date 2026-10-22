import { randomUUID } from "node:crypto";

/** Opaque markers protect original TTS identity/cues and code across providers. */
export function protectTranslationMarkup(text: string) {
  let prefix = `MARI_${randomUUID().slice(0, 8)}_`;
  while (text.includes(prefix)) prefix = `MARI_${randomUUID().slice(0, 8)}_`;
  const values: string[] = [];
  let inAudio = false;
  const protectedText = text.replace(
    /(`{3,}|~{3,})[^\n]*\n[\s\S]*?\1|`[^`\n]*`|(?:&(?:amp;)?lt;|&#0*60;|&#x0*3c;|〈|＜)\/?audio_(?:character|persona)\b[^\r\n]{0,1000}?(?:&(?:amp;)?gt;|&#0*62;|&#x0*3e;|〉|＞)|<\/?audio_(?:character|persona)\b[^>]*>|\[[^\]\r\n]{1,160}\](?!\s*[(:])/gi,
    (value) => {
      const wrapper = value.match(/^(?:<|&(?:amp;)?lt;|&#0*60;|&#x0*3c;|〈|＜)(\/?)audio_/i);
      if (wrapper) inAudio = wrapper[1] !== "/";
      if (
        value.startsWith("[") &&
        !inAudio &&
        !/^\[(?:(?:short|long) pause|(?:soft|quiet|nervous) (?:chuckles?|laughs?)|whispers?|whispering|sighs?|chuckles?|laughs?|angry|annoyed|sad|happy|excited|thoughtful|surprised|curious|crying|shouts?|shouting|sarcastic|breathy|sniffs?|gasps?)\]$/i.test(
          value,
        )
      )
        return value;
      values.push(value);
      return `${prefix}${values.length - 1}_END`;
    },
  );
  return {
    text: protectedText,
    restore(translated: string) {
      if (!values.length) return translated;
      const tokens = new RegExp(`${prefix}(\\d+)_END`, "g");
      const found = [...translated.matchAll(tokens)].map((match) => Number(match[1]));
      if (found.length !== values.length || found.some((index, position) => index !== position))
        throw new Error("Translation changed protected markup; original text retained");
      return translated.replace(tokens, (_token, index: string) => values[Number(index)]!);
    },
  };
}
