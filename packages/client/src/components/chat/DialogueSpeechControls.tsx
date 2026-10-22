import { useEffect, useMemo, useState } from "react";
import { Loader2, Play, RefreshCw, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useTTSConfig } from "../../hooks/use-tts";
import { useUIStore } from "../../stores/ui.store";
import { ttsService } from "../../lib/tts-service";
import {
  buildTTSVoiceRequests,
  findTTSCharacterIdBySpeakerName,
  withTTSVoiceRequestCacheKeys,
} from "../../lib/tts-dialogue";
import { hideTTSAudioCues, type TTSAudioParticipant } from "../../lib/tts-audio-tags";
import { showConfirmDialog } from "../../lib/app-dialogs";
import type { CharacterMap, PersonaInfo } from "./chat-area.types";

export function DialogueSpeechControls({
  messageId,
  chatId,
  text,
  characterId,
  characterMap,
  personaInfo,
  chatCharacterIds,
}: {
  messageId: string;
  chatId: string;
  text: string;
  characterId?: string | null;
  characterMap?: CharacterMap;
  personaInfo?: PersonaInfo | null;
  chatCharacterIds?: string[];
}) {
  const { t } = useTranslation();
  const { data: config } = useTTSConfig();
  const volume = useUIStore((s) => s.ttsLineVolume);
  const [playback, setPlayback] = useState(() => ({ state: ttsService.getState(), id: ttsService.getActiveId() }));
  const [regenerating, setRegenerating] = useState<number | null>(null);
  useEffect(() => ttsService.subscribe((state, id) => setPlayback({ state, id })), []);
  const requests = useMemo(() => {
    if (!config?.enabled) return [];
    const characters = [...(characterMap ?? [])].filter(([id]) => !chatCharacterIds || chatCharacterIds.includes(id));
    const participants: TTSAudioParticipant[] = characters.map(([id, character]) => ({
      kind: "character",
      id,
      name: character.name,
    }));
    if (personaInfo?.id) participants.push({ kind: "persona", id: personaInfo.id, name: personaInfo.name });
    const speaker = characterId ? characterMap?.get(characterId)?.name : undefined;
    const resolve = (name?: string | null) => findTTSCharacterIdBySpeakerName(name, characters);
    const dialogue = buildTTSVoiceRequests(
      text,
      { ...config, dialogueOnly: true },
      speaker,
      characterId,
      resolve,
      participants,
    );
    // Conversation messages often have no quotation marks: retain their original speech as one entry.
    const lines = dialogue.length
      ? dialogue
      : buildTTSVoiceRequests(text, config, speaker, characterId, resolve, participants);
    return withTTSVoiceRequestCacheKeys(lines, config, messageId);
  }, [config, text, characterId, characterMap, chatCharacterIds, personaInfo, messageId]);
  if (!requests.length) return null;
  const play = async (index: number, regenerate = false) => {
    const request = requests[index];
    const id = `${messageId}:dialogue:${index}`;
    if (!request) return;
    if (!regenerate && ttsService.getActiveId() === id && ttsService.getState() !== "idle") {
      ttsService.stop();
      return;
    }
    if (regenerate) {
      if (
        !(await showConfirmDialog({
          title: t("reader.dialogueRegenerate"),
          message: t("reader.dialogueRegenerateConfirm"),
          confirmLabel: t("reader.dialogueRegenerate"),
          cancelLabel: t("reader.cancel"),
        }))
      )
        return;
      setRegenerating(index);
    }
    try {
      ttsService.stop();
      if (regenerate) await ttsService.clearCachedAudio([request]);
      await ttsService.speakSequence([request], id, { chatId, volume: volume / 100, throwOnError: true });
    } catch {
      toast.error(t("reader.dialogueSpeechError"));
    } finally {
      if (regenerate) setRegenerating(null);
    }
  };
  return (
    <details
      className="my-2 min-w-0 max-w-full border-t border-[var(--border)] text-[var(--foreground)]"
      data-component="DialogueSpeechControls"
      onClick={(event) => event.stopPropagation()}
    >
      <summary className="min-h-11 cursor-pointer py-3 text-xs text-[var(--muted-foreground)]">
        {t("reader.dialogueSpeech", { count: requests.length })}
      </summary>
      <ol className="divide-y divide-[var(--border)]">
        {requests.map((request, index) => {
          const active =
            playback.id === `${messageId}:dialogue:${index}` && !["idle", "error"].includes(playback.state);
          const busy = regenerating !== null;
          const excerpt = hideTTSAudioCues(request.text);
          return (
            <li key={request.cacheKey} className="flex min-w-0 items-center gap-1 py-1">
              <span className="min-w-0 flex-1 truncate text-xs" title={excerpt}>
                {index + 1}. {excerpt}
              </span>
              <button
                type="button"
                disabled={busy && regenerating !== index}
                onClick={() => void play(index)}
                aria-label={t(active ? "reader.dialogueStop" : "reader.dialoguePlay", { number: index + 1 })}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md hover:bg-[var(--secondary)] disabled:opacity-40"
              >
                {active ? <Square size={16} /> : <Play size={16} />}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void play(index, true)}
                aria-label={t("reader.dialogueRegenerateNumber", { number: index + 1 })}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md hover:bg-[var(--secondary)] disabled:opacity-40"
              >
                {regenerating === index ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              </button>
            </li>
          );
        })}
      </ol>
    </details>
  );
}
