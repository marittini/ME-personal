import type { TTSConfig } from "@marinara-engine/shared";
import {
  buildTTSVoiceRequests,
  extractDialogueUtterances,
  resolveTTSVoiceForSpeaker,
  splitTTSChunks,
  withTTSVoiceRequestCacheKeys,
  type CachedTTSVoiceRequest,
} from "./tts-dialogue";
import { parseTTSAudioLines, type TTSAudioParticipant } from "./tts-audio-tags";
export type DialogueSpeechGroup = { requests: CachedTTSVoiceRequest[]; persona?: TTSAudioParticipant };
/** One control per original utterance, even if synthesis needs several chunks. No text aliases across rooms/swipes. */
export function buildDialogueSpeechGroups(
  text: string,
  config: TTSConfig,
  identity: {
    chatId: string;
    messageId: string;
    swipeIndex: number;
    characterId?: string | null;
    speaker?: string;
    tagged: boolean;
    conversation: boolean;
    participants: TTSAudioParticipant[];
  },
): DialogueSpeechGroup[] {
  const { participants, characterId, speaker } = identity;
  let groups: Array<{ requests: ReturnType<typeof buildTTSVoiceRequests>; persona?: TTSAudioParticipant }>;
  if (identity.tagged && /<audio_(?:character|persona)\b|<[A-Za-z0-9_-]{1,200}>/i.test(text)) {
    const lines = parseTTSAudioLines(text, participants);
    const wrapperCount = [
      ...text.replace(/(`{3,}|~{3,})[^\n]*\n[\s\S]*?\1|`[^`\n]*`/g, "").matchAll(/<audio_(?:character|persona)\b/gi),
    ].length;
    if (wrapperCount > lines.length) throw new Error("unknownSpeaker");
    groups = lines.map((line) => {
      const voice =
        line.kind === "persona"
          ? config.personaVoiceAssignments?.find((row) => row.personaId === line.id)?.voice
          : config.voiceAssignments.find((row) => row.characterId === line.id)?.voice;
      if (!voice?.trim()) throw new Error("missingVoice");
      return {
        requests: splitTTSChunks(line.text, config).map((chunk) => ({
          text: chunk,
          voice,
          speaker: line.name,
          ...(line.kind === "character" ? { characterId: line.id } : {}),
        })),
        ...(line.kind === "persona" ? { persona: line } : {}),
      };
    });
  } else {
    const native = text.replace(/<\/?audio_(?:character|persona)\b[^>]*>/gi, "");
    const utterances = extractDialogueUtterances(native, speaker, config, true);
    const lines = utterances.length ? utterances.map((line) => line.text) : identity.conversation ? [native] : [];
    const voice = resolveTTSVoiceForSpeaker(config, speaker, characterId);
    groups = lines.map((line) => ({
      requests: splitTTSChunks(line, config).map((chunk) => ({
        text: chunk,
        voice,
        speaker,
        ...(characterId ? { characterId } : {}),
      })),
    }));
  }
  return groups
    .filter((g) => g.requests.length)
    .map((group, index) => ({
      ...group,
      requests: withTTSVoiceRequestCacheKeys(
        group.requests,
        config,
        `${identity.chatId}:${identity.messageId}:${identity.swipeIndex}:dialogue:${index}`,
      ).map((request) => ({ ...request, cacheAliases: [] })),
    }));
}
