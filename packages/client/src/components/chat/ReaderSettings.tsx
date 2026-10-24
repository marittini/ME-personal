import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { Chat } from "@marinara-engine/shared";
import { useUpdateChatMetadata } from "../../hooks/use-chats";
import { useSetTTSEnabled, useTTSConfig, useUpdateTTSPersonaVoice } from "../../hooks/use-tts";
import { usePersonas } from "../../hooks/use-characters";
import { useReaderFonts } from "../../hooks/use-reader-fonts";
import { useUIStore } from "../../stores/ui.store";
import {
  readerModePreferences,
  type ConversationReaderPreferences,
  type ReaderPreferences,
  type RoleplayReaderPreferences,
} from "../../lib/reader-preferences";
import { ReaderNumberSetting } from "./ReaderNumberSetting";
import { ReaderPagePicker } from "../ui/ReaderPagePicker";

const select = "min-h-11 max-w-[65%] rounded-md border border-[var(--border)] bg-[var(--background)] px-3";
const row = "flex min-h-11 items-center justify-between gap-4 text-sm";

/** A collapsible group; its open state is per viewer, not saved. */
function Group({
  title,
  name,
  defaultOpen,
  children,
}: {
  title: string;
  name: string;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  return (
    <details
      className="group border-b border-[var(--border)] py-1"
      open={defaultOpen}
      data-reader-settings-group={name}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-semibold [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown size={18} className="transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="space-y-4 pb-4 pt-1">{children}</div>
    </details>
  );
}

function Range({
  label,
  ariaLabel,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  ariaLabel?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block text-sm">
      {label}
      <input
        className="mt-3 block w-full"
        type="range"
        aria-label={ariaLabel}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

/**
 * Reading settings. Page color, font and text size are shared by RP and Convo; paragraph layout and bubbles are
 * saved per mode; the room's speech settings live in the collapsed 음성 group.
 */
export function ReaderSettings({ chat, onAdvanced }: { chat: Chat | undefined; onAdvanced: () => void }) {
  const { t } = useTranslation();
  const mode = chat?.mode === "conversation" ? "conversation" : "roleplay";
  const conversation = mode === "conversation";
  const preferences = useUIStore((state) => state.readerPreferences);
  const fontSize = useUIStore((state) => state.chatFontSize);
  const volume = useUIStore((state) => state.ttsLineVolume);
  const view = readerModePreferences(preferences, mode);
  const { data: customFonts } = useReaderFonts();
  const { data: ttsConfig } = useTTSConfig();
  const setTTSEnabled = useSetTTSEnabled();
  const assignPersona = useUpdateTTSPersonaVoice();
  const { data: personas } = usePersonas();
  const updateMetadata = useUpdateChatMetadata({ serialize: true });
  const persona = (personas as Array<{ id: string; name: string }> | undefined)?.find(
    (row) => row.id === chat?.personaId,
  );
  const savedPersonaVoice =
    ttsConfig?.personaVoiceAssignments?.find((row) => row.personaId === persona?.id)?.voice ?? "";
  const [personaVoice, setPersonaVoice] = useState(savedPersonaVoice);
  useEffect(() => setPersonaVoice(savedPersonaVoice), [savedPersonaVoice]);

  const update = (next: (current: ReaderPreferences) => ReaderPreferences) =>
    useUIStore.setState((state) => ({ readerPreferences: next(state.readerPreferences) }));
  const patchShared = (value: Partial<ReaderPreferences["shared"]>) =>
    update((current) => ({ ...current, shared: { ...current.shared, ...value } }));
  const patchMode = (value: Partial<RoleplayReaderPreferences & ConversationReaderPreferences>) =>
    update((current) => ({ ...current, [mode]: { ...current[mode], ...value } }));
  const saveMetadata = (value: Record<string, unknown>) =>
    chat &&
    updateMetadata.mutate({ id: chat.id, ...value }, { onError: () => toast.error(t("reader.speechSaveFailed")) });

  return (
    <div className="px-5 pb-5 pt-1" data-reader-settings={mode}>
      <Group title={t("reader.groupScreen")} name="screen" defaultOpen>
        {/* The page color is the whole app's theme. */}
        <div className="space-y-2 text-sm">
          <span>{t("reader.paper")}</span>
          <ReaderPagePicker label={t("reader.paper")} />
        </div>
        <label className={row}>
          {t("reader.font")}
          <select
            aria-label={t("reader.font")}
            className={select}
            value={view.font}
            onChange={(event) => patchShared({ font: event.target.value })}
          >
            <option value="inherit">{t("reader.fontDefault")}</option>
            <option value="@sans">{t("reader.fontSans")}</option>
            <option value="@serif">{t("reader.fontSerif")}</option>
            <option value="@mono">{t("reader.fontMono")}</option>
            {[...new Set((customFonts ?? []).map((font) => font.family))].map((family) => (
              <option key={family} value={`custom:${family}`}>
                {family}
              </option>
            ))}
          </select>
        </label>
        <ReaderNumberSetting
          label={t("reader.fontSizeLabel")}
          unit="px"
          value={fontSize}
          min={12}
          max={32}
          step={1}
          onChange={(size) => useUIStore.getState().setChatFontSize(size)}
        />
      </Group>

      <Group
        title={t(conversation ? "reader.groupParagraphConversation" : "reader.groupParagraphRoleplay")}
        name="paragraph"
        defaultOpen
      >
        <ReaderNumberSetting
          label={t("reader.lineHeightLabel")}
          unit={t("reader.multiplier")}
          value={view.lineHeight}
          min={1}
          max={3}
          onChange={(lineHeight) => patchMode({ lineHeight })}
        />
        <ReaderNumberSetting
          label={t("reader.letterSpacingLabel")}
          unit="px"
          value={view.letterSpacing}
          min={-1}
          max={5}
          onChange={(letterSpacing) => patchMode({ letterSpacing })}
        />
        <p
          className="rounded-md border border-[var(--border)] p-3 text-sm"
          style={{ lineHeight: view.lineHeight, letterSpacing: `${view.letterSpacing}px` }}
        >
          {t("reader.typographyPreview")}
        </p>
        <Range
          label={t("reader.paragraphGap", { value: view.paragraphGap })}
          ariaLabel={t("reader.paragraphGapLabel")}
          value={view.paragraphGap}
          min={0}
          max={2}
          step={0.25}
          onChange={(paragraphGap) => patchMode({ paragraphGap })}
        />
        <label className={row}>
          {t("reader.alignment")}
          <select
            aria-label={t("reader.alignment")}
            className={select}
            value={view.align}
            onChange={(event) => patchMode({ align: event.target.value as "start" | "justify" })}
          >
            <option value="start">{t("reader.alignStart")}</option>
            <option value="justify">{t("reader.alignJustify")}</option>
          </select>
        </label>
        <Range
          label={t("reader.width", { value: view.width })}
          ariaLabel={t("reader.widthLabel")}
          value={view.width}
          min={440}
          max={1000}
          step={40}
          onChange={(width) => patchMode({ width })}
        />
        <Range
          label={t("reader.sideMargin", { value: view.sideMargin })}
          ariaLabel={t("reader.sideMarginLabel")}
          value={view.sideMargin}
          min={0}
          max={64}
          step={4}
          onChange={(sideMargin) => patchMode({ sideMargin })}
        />
        {!conversation && (
          <>
            <Range
              label={t("reader.indentValue", { value: view.indent })}
              ariaLabel={t("reader.indent")}
              value={view.indent}
              min={0}
              max={4}
              step={0.5}
              onChange={(indent) => patchMode({ indent })}
            />
            <ReaderNumberSetting
              label={t("reader.translationSizeOffset")}
              unit="px"
              value={view.translationSizeOffset}
              min={0}
              max={8}
              step={1}
              onChange={(translationSizeOffset) => patchMode({ translationSizeOffset })}
            />
          </>
        )}
      </Group>

      {conversation && chat && (
        <Group title={t("reader.groupConversation")} name="conversation" defaultOpen>
          <label className={row}>
            {t("reader.conversationViewer")}
            <select
              aria-label={t("reader.conversationViewer")}
              className={select}
              value={chat.metadata.conversationViewerStyle ?? "bubble"}
              disabled={updateMetadata.isPending}
              onChange={(event) =>
                updateMetadata.mutate(
                  { id: chat.id, conversationViewerStyle: event.target.value as "bubble" | "classic" | "legacy" },
                  { onError: () => toast.error(t("reader.viewerSaveFailed")) },
                )
              }
            >
              <option value="bubble">{t("reader.viewerBubble")}</option>
              <option value="classic">{t("reader.viewerClassic")}</option>
              <option value="legacy">{t("reader.viewerLegacy")}</option>
            </select>
          </label>
          <fieldset className="space-y-2" data-reader-bubble-colors="">
            <label className={row}>
              {t("reader.bubbleColors")}
              <select
                aria-label={t("reader.bubbleColors")}
                className={select}
                value={view.bubbleScope}
                onChange={(event) => patchMode({ bubbleScope: event.target.value as "card" | "global" })}
              >
                <option value="card">{t("reader.bubbleColorsCard")}</option>
                <option value="global">{t("reader.bubbleColorsGlobal")}</option>
              </select>
            </label>
            {view.bubbleScope === "global" && (
              <div className="grid grid-cols-2 gap-2 text-xs">
                {(
                  [
                    ["bubbleCharacterBg", "reader.bubbleCharacterBg", "var(--secondary)"],
                    ["bubbleCharacterText", "reader.bubbleCharacterText", "var(--secondary-foreground)"],
                    ["bubblePersonaBg", "reader.bubblePersonaBg", "var(--primary)"],
                    ["bubblePersonaText", "reader.bubblePersonaText", "var(--primary-foreground)"],
                  ] as const
                ).map(([key, label, fallback]) => (
                  <label
                    key={key}
                    className="flex min-h-11 items-center justify-between gap-2 rounded-md border border-[var(--border)] px-2"
                  >
                    <span>{t(label)}</span>
                    <span className="flex items-center gap-1">
                      <input
                        type="color"
                        aria-label={t(label)}
                        className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent"
                        value={view[key] || "#888888"}
                        style={view[key] ? undefined : { outline: `2px dashed ${fallback}` }}
                        onChange={(event) => patchMode({ [key]: event.target.value })}
                      />
                      {view[key] && (
                        <button
                          type="button"
                          className="min-h-8 rounded px-1.5 text-[0.6875rem] underline"
                          onClick={() => patchMode({ [key]: "" })}
                        >
                          {t("reader.bubbleColorReset")}
                        </button>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            )}
            <p className="text-xs text-[var(--muted-foreground)]">{t("reader.bubbleColorsHelp")}</p>
          </fieldset>
          <ReaderNumberSetting
            label={t("reader.translationSizeOffset")}
            unit="px"
            value={view.translationSizeOffset}
            min={0}
            max={8}
            step={1}
            onChange={(translationSizeOffset) => patchMode({ translationSizeOffset })}
          />
        </Group>
      )}

      {/* The room's speech settings, formerly a floating menu over the page. */}
      <Group title={t("reader.groupVoice")} name="voice" defaultOpen={false}>
        <label className={row}>
          {t("reader.speech")}
          <input
            type="checkbox"
            checked={ttsConfig?.enabled ?? false}
            disabled={!ttsConfig || setTTSEnabled.isPending}
            onChange={(event) =>
              setTTSEnabled.mutate(event.target.checked, { onError: () => toast.error(t("reader.speechSaveFailed")) })
            }
          />
        </label>
        <label className={row}>
          {t("reader.speechInstructions")}
          <input
            type="checkbox"
            checked={chat?.metadata.ttsInstructionsEnabled === true}
            disabled={!chat || updateMetadata.isPending}
            onChange={(event) => saveMetadata({ ttsInstructionsEnabled: event.target.checked })}
          />
        </label>
        {/* Per-line buttons are an RP setting; Convo always speaks a whole message from its actions. */}
        {!conversation && (
          <label className={row}>
            {t("reader.dialogueButtons")}
            <input
              type="checkbox"
              checked={chat?.metadata.ttsDialogueButtonsEnabled !== false}
              disabled={!chat || updateMetadata.isPending}
              onChange={(event) => saveMetadata({ ttsDialogueButtonsEnabled: event.target.checked })}
            />
          </label>
        )}
        {!conversation && (
          <label className={row}>
            {t("reader.speakerMode")}
            <select
              aria-label={t("reader.speakerMode")}
              className={select}
              value={chat?.metadata.ttsTaggedDialogue === true ? "tagged" : "native"}
              disabled={!chat || updateMetadata.isPending}
              onChange={(event) => saveMetadata({ ttsTaggedDialogue: event.target.value === "tagged" })}
            >
              <option value="native">{t("reader.nativeSpeaker")}</option>
              <option value="tagged">{t("reader.taggedSpeaker")}</option>
            </select>
          </label>
        )}
        <Range
          label={t("reader.lineVolume", { value: volume })}
          ariaLabel={t("reader.lineVolumeLabel")}
          value={volume}
          min={0}
          max={100}
          step={1}
          onChange={(ttsLineVolume) => useUIStore.setState({ ttsLineVolume })}
        />
        {persona && (
          <form
            className="space-y-2 text-sm"
            onSubmit={(event) => {
              event.preventDefault();
              assignPersona.mutate(
                { personaId: persona.id, personaName: persona.name, voice: personaVoice.trim() },
                {
                  onSuccess: () => toast.success(t("integrations.saved")),
                  onError: () => toast.error(t("reader.speechSaveFailed")),
                },
              );
            }}
          >
            <label className="block">
              {t("reader.personaVoiceFor", { name: persona.name })}
              <input
                className="mt-2 block min-h-11 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3"
                value={personaVoice}
                placeholder={t("reader.personaVoiceDefault")}
                onChange={(event) => setPersonaVoice(event.target.value)}
              />
            </label>
            <button
              type="submit"
              className="min-h-11 rounded-md border border-[var(--border)] px-3 disabled:opacity-50"
              disabled={assignPersona.isPending || personaVoice.trim() === savedPersonaVoice}
            >
              {t("reader.save")}
            </button>
          </form>
        )}
        <p className="text-xs text-[var(--muted-foreground)]">{t("reader.roomSpeechHelp")}</p>
      </Group>

      <p className="pt-3 text-xs leading-relaxed text-[var(--muted-foreground)]">{t("reader.localSettings")}</p>
      <button className="mt-2 min-h-11 w-full border-t border-[var(--border)] text-sm" onClick={onAdvanced}>
        {t("reader.advanced")}
      </button>
    </div>
  );
}
