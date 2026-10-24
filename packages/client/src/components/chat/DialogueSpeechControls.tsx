import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ttsTaggedDialogueEnabled } from "@marinara-engine/shared";
import { createPortal } from "react-dom";
import { Loader2, MoreVertical, Play, Plus, RefreshCw, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useTTSConfig, useUpdateTTSPersonaVoice } from "../../hooks/use-tts";
import { useChat } from "../../hooks/use-chats";
import { useUIStore } from "../../stores/ui.store";
import { ttsService } from "../../lib/tts-service";
import { getCachedTTSAudioBlob } from "../../lib/tts-audio-cache";
import { buildDialogueSpeechGroups } from "../../lib/tts-dialogue-groups";
import { alignTranslatedQuotes } from "../../lib/tts-translation-anchors";
import type { TTSAudioParticipant } from "../../lib/tts-audio-tags";
import { showConfirmDialog, showPromptDialog } from "../../lib/app-dialogs";
import type { CharacterMap, PersonaInfo } from "./chat-area.types";

export function DialogueSpeechControls({
  messageId,
  chatId,
  text,
  characterId,
  characterMap,
  personaInfo,
  chatCharacterIds,
  swipeIndex = 0,
  translation,
}: {
  messageId: string;
  chatId: string;
  text: string;
  characterId?: string | null;
  characterMap?: CharacterMap;
  personaInfo?: PersonaInfo | null;
  chatCharacterIds?: string[];
  swipeIndex?: number;
  translation?: string;
}) {
  const { t } = useTranslation();
  const { data: config } = useTTSConfig();
  const { data: chat } = useChat(chatId);
  const assignPersona = useUpdateTTSPersonaVoice();
  const volume = useUIStore((s) => s.ttsLineVolume);
  const sentinel = useRef<HTMLSpanElement>(null);
  const operation = useRef(false);
  const epoch = useRef(0);
  const [renderRevision, setRenderRevision] = useState(0);
  useEffect(() => {
    const rendered = (event: Event) => {
      if (event.target instanceof Element && event.target.closest(`[data-message-id="${CSS.escape(messageId)}"]`))
        setRenderRevision((value) => value + 1);
    };
    document.addEventListener("reader-content-rendered", rendered);
    return () => document.removeEventListener("reader-content-rendered", rendered);
  }, [messageId]);
  const [targets, setTargets] = useState<HTMLElement[]>([]);
  // Lines are quiet until tapped: a tap on a spoken line opens its small play / regenerate popover.
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [cached, setCached] = useState<boolean[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [playback, setPlayback] = useState(() => ({ state: ttsService.getState(), id: ttsService.getActiveId() }));
  const prefix = `${chatId}:${messageId}:${swipeIndex}:dialogue:`;
  // Conversation mode speaks whole messages from the message actions instead (ConversationSpeech).
  const enabled =
    !!config?.enabled && chat?.mode !== "conversation" && chat?.metadata.ttsDialogueButtonsEnabled !== false;
  const result = useMemo(() => {
    if (!enabled || !config) return { groups: [] };
    const participants: TTSAudioParticipant[] = [...(characterMap ?? [])]
      .filter(([id]) => !chatCharacterIds || chatCharacterIds.includes(id))
      .map(([id, c]) => ({ kind: "character", id, name: c.name }));
    if (personaInfo?.id) participants.push({ kind: "persona", id: personaInfo.id, name: personaInfo.name });
    try {
      return {
        groups: buildDialogueSpeechGroups(text, config, {
          chatId,
          messageId,
          swipeIndex,
          characterId,
          speaker: characterId ? characterMap?.get(characterId)?.name : undefined,
          tagged: ttsTaggedDialogueEnabled(chat?.metadata.ttsTaggedDialogue),
          conversation: chat?.mode === "conversation",
          participants,
        }),
      };
    } catch (error) {
      return { groups: [], error: error instanceof Error ? error.message : "unknownSpeaker" };
    }
  }, [
    enabled,
    config,
    text,
    chatId,
    messageId,
    swipeIndex,
    characterId,
    characterMap,
    chatCharacterIds,
    personaInfo,
    chat?.metadata.ttsTaggedDialogue,
    chat?.mode,
  ]);
  const groups = result.groups;
  useEffect(
    () =>
      ttsService.subscribe((state, id) =>
        setPlayback((old) => (old.id?.startsWith(prefix) || id?.startsWith(prefix) ? { state, id } : old)),
      ),
    [prefix],
  );
  useEffect(() => {
    const version = ++epoch.current;
    operation.current = false;
    setBusy(null);
    void Promise.all(
      groups.map(async (group) =>
        (await Promise.all(group.requests.map((request) => getCachedTTSAudioBlob(request.cacheKey)))).every(Boolean),
      ),
    ).then((values) => {
      if (epoch.current === version) setCached(values);
    });
    return () => {
      epoch.current++;
      if (ttsService.getActiveId()?.startsWith(prefix)) ttsService.stop();
    };
  }, [groups, prefix]);
  useEffect(() => {
    if (playback.id?.startsWith(prefix)) ttsService.setCurrentPlaybackVolume(volume / 100);
  }, [prefix, playback.id, volume]);
  useLayoutEffect(() => {
    if (!enabled || !groups.length) {
      setTargets([]);
      return;
    }
    const owner = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
    const visible = (selector: string) =>
      owner ? [...owner.querySelectorAll<HTMLElement>(selector)].filter((node) => !!node.getClientRects().length) : [];
    const quotes = visible("[data-tts-dialogue]");
    // Original lines first; a shown translation is only used when it alone lines up (translation-only view).
    const originalQuotes = quotes.filter((node) => !node.closest(".translation-text"));
    const translatedQuotes = quotes.filter((node) => node.closest(".translation-text"));
    const bubbles = visible("[data-tts-conversation-content]");
    const conversation = chat?.mode === "conversation";
    // Count/order must agree. A compact control row is safer than guessing a translated speaker.
    const anchors =
      originalQuotes.length === groups.length
        ? originalQuotes
        : translatedQuotes.length === groups.length
          ? translatedQuotes
          : // The translation quotes more than the original speaks: keep the quotes of the tagged paragraphs.
            // Tagged lines with more quotes on the page than lines (narration quoting 『…』, 「…」 or a
            // translation of them): keep the quotes of the tagged paragraphs.
            ttsTaggedDialogueEnabled(chat?.metadata.ttsTaggedDialogue)
            ? alignTranslatedQuotes(
                text,
                // A shown translation below the original wins; translation-only renders in place of the original.
                translatedQuotes.length ? translatedQuotes : originalQuotes,
                groups.length,
              )
            : conversation && bubbles.length === groups.length
              ? bubbles
              : // A conversation reply without quotes is one spoken line; its control follows the last bubble.
                conversation && groups.length === 1 && !quotes.length && bubbles.length
                ? [bubbles[bubbles.length - 1]!]
                : [];
    const cleanups: Array<() => void> = [];
    const hosts = anchors.map((node, index) => {
      const host = document.createElement("span");
      host.dataset.ttsControlHost = "";
      host.className = "not-italic font-normal";
      node.append(host);
      node.dataset.ttsDialogueTappable = "";
      // A short tap opens this line's popover; selecting text (a drag or a long press) never does.
      const tap = (event: MouseEvent) => {
        if (host.contains(event.target as Node)) return;
        if (window.getSelection()?.toString().trim()) return;
        event.stopPropagation();
        setOpenIndex((open) => (open === index ? null : index));
      };
      node.addEventListener("click", tap);
      cleanups.push(() => {
        node.removeEventListener("click", tap);
        delete node.dataset.ttsDialogueTappable;
      });
      return host;
    });
    setTargets(hosts);
    setOpenIndex(null);
    return () => {
      cleanups.forEach((cleanup) => cleanup());
      hosts.forEach((host) => host.remove());
    };
  }, [enabled, groups, messageId, translation, chat?.mode, chat?.metadata.ttsTaggedDialogue, text, renderRevision]);
  useEffect(() => {
    if (openIndex === null) return;
    const anchor = targets[openIndex]?.parentElement;
    const outside = (event: PointerEvent) => {
      if (!anchor?.contains(event.target as Node)) setOpenIndex(null);
    };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpenIndex(null);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
    };
  }, [openIndex, targets]);
  // Keep the open popover inside the message and on screen.
  const popover = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const node = popover.current;
    const host = node?.parentElement;
    if (!node || !host) return;
    const owner = host.closest<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`) ?? document.body;
    const bounds = owner.getBoundingClientRect();
    const at = host.getBoundingClientRect();
    const width = node.offsetWidth;
    const left = Math.min(bounds.right - at.left - width - 4, Math.max(bounds.left - at.left + 4, -width + 12));
    node.style.left = `${left}px`;
    // Below the line (above it, the message's own header could cover it); above it near the bottom edge.
    node.dataset.above = at.bottom + node.offsetHeight + 8 > window.innerHeight - 72 ? "true" : "false";
  });
  const personaSettings = async () => {
    if (!personaInfo?.id) return;
    const value = await showPromptDialog({
      title: t("reader.personaVoice"),
      message: personaInfo.name,
      defaultValue: config?.personaVoiceAssignments?.find((row) => row.personaId === personaInfo.id)?.voice ?? "",
    });
    if (value === null) return;
    assignPersona.mutate(
      { personaId: personaInfo.id, personaName: personaInfo.name, voice: value },
      { onError: () => toast.error(t("reader.speechSaveFailed")) },
    );
  };
  const play = async (index: number, regenerate = false) => {
    const group = groups[index];
    if (!group || !config || operation.current) return;
    const id = `${prefix}${index}`;
    if (!regenerate && ttsService.getActiveId() === id && !["idle", "error"].includes(ttsService.getState())) {
      ttsService.stop();
      return;
    }
    operation.current = true;
    const version = epoch.current;
    try {
      if (
        regenerate &&
        !(await showConfirmDialog({
          title: t("reader.dialogueRegenerate"),
          message: t("reader.dialogueRegenerateConfirm"),
          confirmLabel: t("reader.dialogueRegenerate"),
          cancelLabel: t("reader.cancel"),
        }))
      )
        return;
      if (version !== epoch.current) return;
      setBusy(index);
      ttsService.stop();
      if (regenerate) await ttsService.clearCachedAudio(group.requests);
      if (version !== epoch.current) return;
      await ttsService.speakSequence(
        group.requests.map((request) => ({ ...request, audioConnectionId: config.connectionId })),
        id,
        { chatId, volume: volume / 100, throwOnError: true },
      );
    } catch {
      if (version === epoch.current) toast.error(t("reader.dialogueSpeechError"));
    } finally {
      if (version === epoch.current) {
        operation.current = false;
        setBusy(null);
        const hits = await Promise.all(group.requests.map((request) => getCachedTTSAudioBlob(request.cacheKey)));
        if (version === epoch.current)
          setCached((values) => values.map((value, i) => (i === index ? hits.every(Boolean) : value)));
      }
    }
  };
  const controls = (index: number, inLine = true) => {
    const active = playback.id === `${prefix}${index}` && !["idle", "error"].includes(playback.state);
    const loading = active && playback.state === "loading";
    // In a line the buttons show in a popover while it is open or that line is playing; the fallback row shows them.
    const shown = !inLine || openIndex === index || active;
    const style =
      "inline-flex h-7 min-h-7 w-7 min-w-7 items-center justify-center rounded-md align-middle text-current hover:bg-[var(--secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:opacity-40";
    return (
      <span
        className={inLine ? "mari-dialogue-host" : "inline-flex align-middle"}
        data-dialogue-controls={index}
        onClick={(e) => e.stopPropagation()}
      >
        {shown && (
          <span
            ref={inLine && openIndex === index ? popover : undefined}
            className={inLine ? "mari-dialogue-popover" : "inline-flex"}
            data-dialogue-popover={inLine ? index : undefined}
            role={inLine ? "group" : undefined}
            aria-label={inLine ? t("reader.dialogueLine", { number: index + 1 }) : undefined}
          >
            <button
              type="button"
              className={style}
              disabled={busy !== null && busy !== index}
              aria-label={t(
                active ? "reader.dialogueStop" : cached[index] ? "reader.dialoguePlay" : "reader.dialogueGenerate",
                { number: index + 1 },
              )}
              onClick={() => {
                if (active) ttsService.stop();
                else void play(index);
              }}
            >
              {loading ? (
                <Loader2 size={12} className="animate-spin" />
              ) : active ? (
                <Square size={12} />
              ) : cached[index] ? (
                <Play size={12} />
              ) : (
                <Plus size={12} />
              )}
            </button>
            {cached[index] && (
              <button
                type="button"
                className={style}
                disabled={busy !== null}
                aria-label={t("reader.dialogueRegenerateNumber", { number: index + 1 })}
                onClick={() => void play(index, true)}
              >
                <RefreshCw size={12} />
              </button>
            )}
            {groups[index]?.persona && (
              <button
                type="button"
                className={style}
                aria-label={t("reader.personaVoice")}
                onClick={() => void personaSettings()}
              >
                <MoreVertical size={12} />
              </button>
            )}
          </span>
        )}
      </span>
    );
  };
  return (
    <span ref={sentinel} data-component="DialogueSpeechControls" onClick={(e) => e.stopPropagation()}>
      {result.error && (
        <span role="alert" className="block text-xs text-[var(--muted-foreground)]">
          {t(`reader.${result.error}`)}
          {personaInfo?.id && (
            <button type="button" className="min-h-11 px-2 underline" onClick={() => void personaSettings()}>
              {t("reader.personaVoice")}
            </button>
          )}
        </span>
      )}
      {targets.length === groups.length
        ? targets.map((target, index) => createPortal(controls(index), target, `${prefix}${index}`))
        : groups.map((_group, index) => (
            <span key={index} className="inline-flex items-center text-xs">
              <span className="sr-only">{index + 1}</span>
              {controls(index, false)}
            </span>
          ))}
    </span>
  );
}
