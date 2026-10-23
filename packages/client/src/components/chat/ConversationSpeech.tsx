import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Square, Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useTTSConfig } from "../../hooks/use-tts";
import { useChat } from "../../hooks/use-chats";
import { useUIStore } from "../../stores/ui.store";
import { ttsService } from "../../lib/tts-service";
import { getCachedTTSAudioBlob } from "../../lib/tts-audio-cache";
import { resolveTTSVoiceForSpeaker, splitTTSChunks, withTTSVoiceRequestCacheKeys } from "../../lib/tts-dialogue";
import { normalizeTTSAudioMarkup } from "../../lib/tts-audio-tags";
import { showConfirmDialog } from "../../lib/app-dialogs";
import { i18n } from "../../localization/i18n";
import { MESSAGE_ACTION_ICON_SIZE } from "./MessageActionButton";
import { MsgAction } from "./ConversationMessageShared";

type Speech = ReturnType<typeof useConversationSpeech>;

/**
 * Conversation mode speaks a whole message with one voice, as the TTS extension (v4.3.2) did:
 * "음성 생성" in the message actions, and "다시 듣기" in the message header once the voice is saved.
 */
export function useConversationSpeech({
  chatId,
  messageId,
  swipeIndex,
  text,
  speaker,
  characterId,
  personaId,
  isUser,
}: {
  chatId: string;
  messageId: string;
  swipeIndex: number;
  text: string;
  speaker: string;
  characterId?: string | null;
  personaId?: string | null;
  isUser: boolean;
}) {
  const { data: config } = useTTSConfig();
  const { data: chat } = useChat(chatId);
  const volume = useUIStore((s) => s.ttsLineVolume);
  const id = `${chatId}:${messageId}:${swipeIndex}:message`;
  // As in the TTS extension (v4.3.7), the Convo button is always in the message actions: TTS being off is
  // explained when it is pressed, and the per-line button switch belongs to RP only.
  const enabled = !!config && chat?.mode === "conversation";
  const plan = useMemo(() => {
    if (!enabled || !config) return null;
    // Same voice choice as the engine's own speech: a persona without its own voice uses the default voice.
    const voice = isUser
      ? (config.voiceMode === "per-character"
          ? config.personaVoiceAssignments?.find((row) => row.personaId === personaId)?.voice
          : "") ||
        config.voice ||
        ""
      : resolveTTSVoiceForSpeaker(config, speaker, characterId);
    // Audio wrappers are markup; the cues inside them stay, as the voice model reads them.
    const spoken = normalizeTTSAudioMarkup(text).replace(/<\/?audio_(?:character|persona)\b[^>]*>/gi, "");
    const requests = withTTSVoiceRequestCacheKeys(
      splitTTSChunks(spoken, config).map((chunk) => ({
        text: chunk,
        voice,
        speaker,
        ...(characterId && !isUser ? { characterId } : {}),
      })),
      config,
      id,
    ).map((request) => ({ ...request, cacheAliases: [] }));
    return { voice, requests };
  }, [enabled, config, isUser, personaId, speaker, characterId, text, id]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [playback, setPlayback] = useState(() => ({ state: ttsService.getState(), id: ttsService.getActiveId() }));
  const epoch = useRef(0);
  useEffect(
    () =>
      ttsService.subscribe((state, active) =>
        setPlayback((old) => (old.id === id || active === id ? { state, id: active } : old)),
      ),
    [id],
  );
  const check = async (version: number) => {
    const hits = plan?.requests.length
      ? await Promise.all(plan.requests.map((request) => getCachedTTSAudioBlob(request.cacheKey)))
      : [];
    if (epoch.current === version) setSaved(hits.length > 0 && hits.every(Boolean));
  };
  useEffect(() => {
    const version = ++epoch.current;
    setBusy(false);
    void check(version);
    return () => {
      epoch.current++;
      if (ttsService.getActiveId() === id) ttsService.stop();
    };
    // `check` reads the current plan; the plan and id are the dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, id]);
  const active = playback.id === id && !["idle", "error"].includes(playback.state);
  // A voice is saved once it starts playing, so 다시 듣기 shows during the first playback too.
  useEffect(() => {
    if (playback.id === id && playback.state === "playing") void check(epoch.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playback.id, playback.state, id]);
  const speak = async (regenerate: boolean) => {
    if (!plan?.requests.length || !config || busy) return;
    if (!config.enabled) {
      toast.error(i18n.t("reader.speechOff"));
      return;
    }
    // The button stays visible without a voice so the missing setting is explained instead of hidden.
    if (!plan.voice.trim()) {
      toast.error(i18n.t("reader.voiceMissing"));
      return;
    }
    const version = epoch.current;
    setBusy(true);
    try {
      ttsService.stop();
      if (regenerate) await ttsService.clearCachedAudio(plan.requests);
      if (version !== epoch.current) return;
      await ttsService.speakSequence(
        plan.requests.map((request) => ({ ...request, audioConnectionId: config.connectionId })),
        id,
        { chatId, volume: volume / 100, throwOnError: true },
      );
    } catch {
      if (version === epoch.current) toast.error(i18n.t("reader.dialogueSpeechError"));
    } finally {
      if (version === epoch.current) {
        setBusy(false);
        void check(version);
      }
    }
  };
  return {
    available: !!plan?.requests.length,
    saved,
    busy,
    active,
    loading: active ? playback.state === "loading" : busy,
    /** Saved voices ask before spending another generation. */
    generate: async (confirmTitle: string, confirmMessage: string, cancelLabel: string) => {
      if (active) {
        ttsService.stop();
        return;
      }
      if (
        saved &&
        !(await showConfirmDialog({
          title: confirmTitle,
          message: confirmMessage,
          confirmLabel: confirmTitle,
          cancelLabel,
        }))
      )
        return;
      await speak(saved);
    },
    replay: () => {
      if (active) ttsService.stop();
      else void speak(false);
    },
  };
}

export function ConversationSpeechAction({ speech }: { speech: Speech }) {
  const { t } = useTranslation();
  if (!speech.available) return null;
  return (
    <MsgAction
      icon={
        speech.loading ? (
          <Loader2 size={MESSAGE_ACTION_ICON_SIZE} className="animate-spin" />
        ) : speech.active ? (
          <Square size={MESSAGE_ACTION_ICON_SIZE} />
        ) : (
          <Volume2 size={MESSAGE_ACTION_ICON_SIZE} />
        )
      }
      onClick={() =>
        void speech.generate(t("reader.voiceRegenerate"), t("reader.voiceRegenerateConfirm"), t("reader.cancel"))
      }
      title={t(speech.active ? "reader.voiceStop" : speech.saved ? "reader.voiceRegenerate" : "reader.voiceGenerate")}
    />
  );
}

export function ConversationSpeechReplay({ speech }: { speech: Speech }) {
  const { t } = useTranslation();
  if (!speech.available || !speech.saved) return null;
  return (
    <button
      type="button"
      data-conversation-speech-replay=""
      className="inline-flex min-h-8 min-w-8 items-center justify-center self-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
      aria-label={t(speech.active ? "reader.voiceStop" : "reader.voiceReplay")}
      title={t(speech.active ? "reader.voiceStop" : "reader.voiceReplay")}
      onClick={(event) => {
        event.stopPropagation();
        speech.replay();
      }}
    >
      {speech.loading ? (
        <Loader2 size={14} className="animate-spin" />
      ) : speech.active ? (
        <Square size={14} />
      ) : (
        <Volume2 size={14} />
      )}
    </button>
  );
}
