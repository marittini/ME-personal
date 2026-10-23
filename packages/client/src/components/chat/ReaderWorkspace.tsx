import { useEffect, useMemo, useRef, useState, lazy, Suspense, type CSSProperties, type ReactNode } from "react";
import { ArrowLeft, BookOpen, ChevronDown, PencilLine, Settings2, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useChat, useUpdateChatMetadata } from "../../hooks/use-chats";
import { useBackDismiss } from "../../hooks/use-back-dismiss";
import { useReaderPosition } from "../../hooks/use-reader-position";
import { useChatStore } from "../../stores/chat.store";
import { useUIStore } from "../../stores/ui.store";
import { useDialogStore } from "../../stores/dialog.store";
import { requestChatScrollToBottom } from "../../lib/chat-scroll-events";
import {
  readerExcerptsSchema,
  readerExcerptSchema,
  type ReaderExcerpt,
  type ReaderExcerptAnchor,
} from "@marinara-engine/shared";
import { captureExcerptAnchors } from "../../lib/reader-excerpt-anchors";
import { useReaderHighlights } from "../../hooks/use-reader-highlights";
import { showConfirmDialog } from "../../lib/app-dialogs";
import { Modal } from "../ui/Modal";
import { libraryChatGroupKey } from "../../lib/library-chat-group";
import { useSetTTSEnabled, useTTSConfig } from "../../hooks/use-tts";
import { useReaderFonts } from "../../hooks/use-reader-fonts";
import { getChatWidgetFontFamily } from "../../lib/font-family";
import { toast } from "sonner";
import { TTSRoomMenu } from "./TTSRoomMenu";
import { ReaderNumberSetting } from "./ReaderNumberSetting";
const ExcerptStudio = lazy(() => import("./ExcerptStudio").then((module) => ({ default: module.ExcerptStudio })));

export function ReaderWorkspace({ children, surfaceActive }: { children: ReactNode; surfaceActive: boolean }) {
  const { t } = useTranslation();
  const { data: ttsConfig } = useTTSConfig();
  const setTTSEnabled = useSetTTSEnabled();
  const updateMetadata = useUpdateChatMetadata({ serialize: true });
  const chatId = useChatStore((state) => state.activeChatId);
  const { data: chat } = useChat(chatId);
  const streaming = useChatStore((state) => state.isStreaming && state.streamingChatId === chatId);
  const preferences = useUIStore((state) => state.readerPreferences);
  const { data: customFonts } = useReaderFonts();
  const fontSize = useUIStore((state) => state.chatFontSize);
  const theme = useUIStore((state) => state.theme);
  const overlayOpen = useUIStore((state) => state.rightPanelOpen || !!state.modal || state.hasAnyDetailOpen());
  const dialogOpen = useDialogStore((state) => !!state.dialog);
  const [focus, setFocus] = useState(false);
  const [tools, setTools] = useState(false);
  const [settings, setSettings] = useState(false);
  const [excerptSelection, setExcerptSelection] = useState("");
  const [excerpt, setExcerpt] = useState<ReaderExcerpt | null>(null);
  const [excerptList, setExcerptList] = useState(false);
  const selectionAnchors = useRef<ReaderExcerptAnchor[]>([]);
  const excerpts = useMemo(() => {
    const parsed = readerExcerptsSchema.safeParse(chat?.metadata.readerExcerpts ?? []);
    return parsed.success ? parsed.data : [];
  }, [chat?.metadata.readerExcerpts]);
  const root = useRef<HTMLDivElement>(null);
  const enabled = !!chatId && chat?.mode !== "game";
  useReaderHighlights(root, excerpts, enabled && surfaceActive);
  const back = () => {
    if (chat) {
      const workId = libraryChatGroupKey(chat);
      useUIStore.setState((state) => ({ libraryNavigation: { ...state.libraryNavigation, selectedWorkId: workId } }));
    }
    useChatStore.getState().setActiveChatId(null);
  };
  useReaderPosition(enabled ? chatId : null, root);
  useBackDismiss(enabled && surfaceActive && !overlayOpen && !dialogOpen && !focus, back);
  useBackDismiss(enabled && surfaceActive && !overlayOpen && !dialogOpen && focus, () => setFocus(false));

  useEffect(() => {
    if (!enabled) return;
    document.documentElement.dataset.readerWorkspace = tools ? "tools" : "quiet";
    return () => {
      delete document.documentElement.dataset.readerWorkspace;
    };
  }, [enabled, tools]);
  useEffect(() => {
    setFocus(false);
    setTools(false);
    setSettings(false);
    setExcerpt(null);
    setExcerptSelection("");
    setExcerptList(false);
    selectionAnchors.current = [];
  }, [chatId]);
  useEffect(() => {
    if (!enabled || !surfaceActive) return;
    const selected = () => {
      const selection = window.getSelection();
      const node = selection?.anchorNode?.parentElement;
      const end = selection?.focusNode?.parentElement;
      if (selection && root.current && selection.toString().trim())
        selectionAnchors.current = captureExcerptAnchors(root.current, selection);
      setExcerptSelection(
        node?.closest(".mari-message-content") && root.current?.contains(node) && end && root.current.contains(end)
          ? (selection?.toString() ?? "")
          : "",
      );
    };
    document.addEventListener("selectionchange", selected);
    return () => document.removeEventListener("selectionchange", selected);
  }, [chatId, enabled, surfaceActive]);

  const patch = (value: Partial<typeof preferences>) =>
    useUIStore.setState((state) => ({ readerPreferences: { ...state.readerPreferences, ...value } }));
  const control =
    "min-h-11 min-w-11 inline-flex items-center justify-center rounded-md px-2 hover:bg-[var(--secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]";
  return (
    <div
      ref={root}
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
      data-component="ReaderWorkspace"
      data-reader-enabled={enabled || undefined}
      data-reader-mode={enabled ? chat?.mode : undefined}
      data-reader-focus={(enabled && focus) || undefined}
      data-reader-streaming={streaming || undefined}
      data-reader-tools={tools || undefined}
      style={
        {
          "--reader-line-height": preferences.lineHeight,
          "--reader-letter-spacing": `${preferences.letterSpacing}px`,
          "--reader-gap": `${preferences.paragraphGap}em`,
          "--reader-width": `${preferences.width}px`,
          "--reader-font":
            getChatWidgetFontFamily(preferences.font === "serif" ? "@serif" : preferences.font) ?? "inherit",
          "--reader-indent": `${Number.isFinite(preferences.indent) ? Math.max(0, Math.min(4, preferences.indent)) : 0}em`,
          "--reader-align": preferences.align,
        } as CSSProperties
      }
    >
      {enabled && (
        <header
          className="flex shrink-0 items-center gap-1 border-b border-[var(--border)] bg-[var(--background)] px-2 pt-[env(safe-area-inset-top)] text-[var(--foreground)]"
          data-chat-window-top-obstacle=""
          aria-label={t("reader.navigation")}
        >
          <button className={control} onClick={back} aria-label={t("reader.back")}>
            <ArrowLeft size={20} />
          </button>
          <span className="min-w-0 flex-1 truncate px-1 text-sm font-medium">{chat?.name}</span>
          <button
            className={control}
            onClick={() => setExcerptList(true)}
            aria-label={t("reader.excerpts")}
            title={t("reader.excerpts")}
          >
            <PencilLine size={18} />
          </button>
          <button
            className={control}
            onClick={() => setFocus(!focus)}
            aria-pressed={focus}
            aria-label={focus ? t("reader.write") : t("reader.focus")}
            title={focus ? t("reader.write") : t("reader.focus")}
          >
            {focus ? (
              <>
                <PencilLine size={18} />
                <span className="ml-1 text-xs">{t("reader.write")}</span>
              </>
            ) : (
              <BookOpen size={20} />
            )}
          </button>
          <button
            className={control}
            onClick={() => requestChatScrollToBottom({ chatId: chatId!, behavior: "auto" })}
            aria-label={t("reader.latest")}
            title={t("reader.latest")}
          >
            <ChevronDown size={20} />
          </button>
          <button
            className={control}
            onClick={() => setSettings(true)}
            aria-label={t("reader.settings")}
            title={t("reader.settings")}
          >
            <Settings2 size={20} />
          </button>
          <button
            className={control}
            onClick={() => setTools(!tools)}
            aria-pressed={tools}
            aria-label={t("reader.tools")}
            title={t("reader.tools")}
          >
            <Wrench size={18} />
          </button>
        </header>
      )}
      {children}
      {enabled && surfaceActive && chat?.mode === "roleplay" && <TTSRoomMenu key={chat.id} chat={chat} />}
      {excerptSelection.trim() && !excerpt && (
        <button
          type="button"
          className="absolute bottom-24 right-4 z-30 min-h-11 rounded-md border border-[var(--border)] bg-[var(--popover)] px-4 text-sm text-[var(--popover-foreground)] shadow-sm"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            if (excerptSelection.length > 20000) toast.error(t("integrations.excerptLimit"));
            else
              setExcerpt({
                id: crypto.randomUUID(),
                text: excerptSelection,
                marks: [],
                anchors: selectionAnchors.current,
                updatedAt: new Date().toISOString(),
              });
          }}
        >
          {t("integrations.excerpt")}
        </button>
      )}
      <Modal
        open={excerpt !== null}
        onClose={() => setExcerpt(null)}
        title={t("integrations.excerpt")}
        width="max-w-5xl"
      >
        {excerpt !== null && (
          <div className="p-4">
            <Suspense fallback={<p role="status">{t("integrations.loading")}</p>}>
              <ExcerptStudio
                key={excerpt.id}
                initialText={excerpt.text}
                initialMarks={excerpt.marks}
                initialAppearance={excerpt.appearance}
                chatTitle={chat?.name ?? ""}
                saving={updateMetadata.isPending}
                onSave={(text, marks, appearance) => {
                  if (!chatId) return;
                  // The card look is saved with the excerpt, so later default changes do not alter it.
                  const result = readerExcerptSchema.safeParse({
                    ...excerpt,
                    text,
                    marks,
                    appearance,
                    updatedAt: new Date().toISOString(),
                  });
                  if (!result.success || (excerpts.length >= 200 && !excerpts.some((row) => row.id === excerpt.id))) {
                    toast.error(t("reader.excerptLimit"));
                    return;
                  }
                  updateMetadata.mutate(
                    { id: chatId, readerExcerpts: [...excerpts.filter((row) => row.id !== excerpt.id), result.data] },
                    {
                      onSuccess: () => {
                        // A studio closed while saving stays closed; only the still-open excerpt is refreshed.
                        setExcerpt((current) => (current?.id === result.data.id ? result.data : current));
                        toast.success(t("integrations.saved"));
                      },
                      onError: () => toast.error(t("integrations.saveError")),
                    },
                  );
                }}
              />
            </Suspense>
          </div>
        )}
      </Modal>
      <Modal open={excerptList} onClose={() => setExcerptList(false)} title={t("reader.excerpts")}>
        <div className="space-y-3 p-4">
          {!excerpts.length && (
            <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">{t("reader.noExcerpts")}</p>
          )}
          {[...excerpts].reverse().map((entry) => (
            <article key={entry.id} className="space-y-3 rounded-lg border border-[var(--border)] p-3">
              <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm">{entry.text}</p>
              <div className="flex flex-wrap gap-2 text-sm">
                <button
                  className={control}
                  onClick={() => {
                    setExcerptList(false);
                    setExcerpt(entry);
                  }}
                >
                  {t("reader.editExcerpt")}
                </button>
                <button
                  className={control}
                  disabled={!entry.anchors.length}
                  onClick={() => {
                    const anchor = entry.anchors[0];
                    if (chatId && anchor) {
                      setExcerptList(false);
                      useChatStore
                        .getState()
                        .requestGotoMessage(chatId, anchor.messageNumber, undefined, anchor.messageId);
                    }
                  }}
                >
                  {t("reader.excerptSource")}
                </button>
                <button
                  className={control}
                  disabled={updateMetadata.isPending}
                  onClick={async () => {
                    if (
                      !chatId ||
                      !(await showConfirmDialog({
                        title: t("reader.deleteExcerpt"),
                        message: t("reader.deleteExcerptConfirm"),
                        confirmLabel: t("reader.deleteExcerpt"),
                        cancelLabel: t("reader.cancel"),
                      }))
                    )
                      return;
                    updateMetadata.mutate(
                      { id: chatId, readerExcerpts: excerpts.filter((row) => row.id !== entry.id) },
                      { onError: () => toast.error(t("integrations.saveError")) },
                    );
                  }}
                >
                  {t("reader.deleteExcerpt")}
                </button>
              </div>
            </article>
          ))}
        </div>
      </Modal>
      <Modal open={settings} onClose={() => setSettings(false)} title={t("reader.settings")}>
        <div className="space-y-6 p-5">
          {chat?.mode === "conversation" && (
            <label className="flex min-h-11 items-center justify-between gap-4 text-sm">
              {t("reader.conversationViewer")}
              <select
                className="min-h-11 rounded-md border border-[var(--border)] bg-[var(--background)] px-3"
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
          )}
          <label className="flex min-h-11 items-center justify-between gap-4 text-sm">
            {t("reader.speech")}
            <input
              type="checkbox"
              checked={ttsConfig?.enabled ?? false}
              disabled={!ttsConfig || setTTSEnabled.isPending}
              onChange={(event) =>
                setTTSEnabled.mutate(event.target.checked, {
                  onError: () => toast.error(t("reader.speechSaveFailed")),
                })
              }
            />
          </label>
          <label className="flex min-h-11 items-center justify-between gap-4 text-sm">
            {t("reader.speechInstructions")}
            <input
              type="checkbox"
              checked={chat?.metadata.ttsInstructionsEnabled === true}
              disabled={!chat || updateMetadata.isPending}
              onChange={(event) =>
                chat &&
                updateMetadata.mutate(
                  { id: chat.id, ttsInstructionsEnabled: event.target.checked },
                  {
                    onError: () => toast.error(t("reader.speechSaveFailed")),
                  },
                )
              }
            />
          </label>
          {chat?.mode === "roleplay" && (
            <label className="flex min-h-11 items-center justify-between gap-4 text-sm">
              {t("reader.speechTagged")}
              <input
                type="checkbox"
                checked={chat.metadata.ttsTaggedDialogue === true}
                disabled={updateMetadata.isPending}
                onChange={(event) =>
                  updateMetadata.mutate(
                    { id: chat.id, ttsTaggedDialogue: event.target.checked },
                    {
                      onError: () => toast.error(t("reader.speechSaveFailed")),
                    },
                  )
                }
              />
            </label>
          )}
          <label className="flex min-h-11 items-center justify-between gap-4 text-sm">
            {t("reader.dialogueButtons")}
            <input
              type="checkbox"
              checked={chat?.metadata.ttsDialogueButtonsEnabled !== false}
              disabled={!chat || updateMetadata.isPending}
              onChange={(event) =>
                chat &&
                updateMetadata.mutate(
                  { id: chat.id, ttsDialogueButtonsEnabled: event.target.checked },
                  { onError: () => toast.error(t("reader.speechSaveFailed")) },
                )
              }
            />
          </label>
          <label className="flex min-h-11 items-center justify-between gap-4 text-sm">
            {t("reader.theme")}
            <select
              className="min-h-11 bg-[var(--background)]"
              value={theme}
              onChange={(event) => useUIStore.getState().setTheme(event.target.value as "dark" | "light")}
            >
              <option value="light">{t("reader.light")}</option>
              <option value="dark">{t("reader.dark")}</option>
            </select>
          </label>
          <label className="block text-sm">
            {t("reader.fontSize", { value: fontSize })}
            <input
              className="mt-3 block w-full"
              type="range"
              min={12}
              max={32}
              value={fontSize}
              onChange={(event) => useUIStore.getState().setChatFontSize(Number(event.target.value))}
            />
          </label>
          <label className="flex min-h-11 items-center justify-between gap-4 text-sm">
            {t("reader.font")}
            <select
              aria-label={t("reader.font")}
              className="min-h-11 max-w-[65%] rounded-md border border-[var(--border)] bg-[var(--background)] px-3"
              value={preferences.font}
              onChange={(event) => patch({ font: event.target.value })}
            >
              <option value="inherit">{t("reader.fontDefault")}</option>
              <option value="@sans">{t("reader.fontSans")}</option>
              <option value="@serif">{t("reader.fontSerif")}</option>
              <option value="@mono">{t("reader.fontMono")}</option>
              {preferences.font === "serif" && <option value="serif">{t("reader.fontSerif")}</option>}
              {[...new Set((customFonts ?? []).map((font) => font.family))].map((family) => (
                <option key={family} value={`custom:${family}`}>
                  {family}
                </option>
              ))}
            </select>
          </label>
          <ReaderNumberSetting
            label={t("reader.indent")}
            unit="em"
            value={preferences.indent ?? 0}
            min={0}
            max={4}
            onChange={(indent) => patch({ indent })}
          />
          <ReaderNumberSetting
            label={t("reader.letterSpacingLabel")}
            unit="px"
            value={preferences.letterSpacing}
            min={-1}
            max={5}
            onChange={(letterSpacing) => patch({ letterSpacing })}
          />
          <ReaderNumberSetting
            label={t("reader.lineHeightLabel")}
            unit={t("reader.multiplier")}
            value={preferences.lineHeight}
            min={1}
            max={3}
            onChange={(lineHeight) => patch({ lineHeight })}
          />
          <p
            className="rounded-md border border-[var(--border)] p-3 text-sm"
            style={{ lineHeight: preferences.lineHeight, letterSpacing: `${preferences.letterSpacing}px` }}
          >
            {t("reader.typographyPreview")}
          </p>
          <label className="block text-sm">
            {t("reader.paragraphGap", { value: preferences.paragraphGap })}
            <input
              className="mt-3 block w-full"
              type="range"
              min={0}
              max={2}
              step={0.25}
              value={preferences.paragraphGap}
              onChange={(event) => patch({ paragraphGap: Number(event.target.value) })}
            />
          </label>
          <label className="block text-sm">
            {t("reader.width", { value: preferences.width })}
            <input
              className="mt-3 block w-full"
              type="range"
              min={440}
              max={1000}
              step={40}
              value={preferences.width}
              onChange={(event) => patch({ width: Number(event.target.value) })}
            />
          </label>
          <label className="flex min-h-11 items-center justify-between gap-4 text-sm">
            {t("reader.alignment")}
            <select
              className="min-h-11 bg-[var(--background)]"
              value={preferences.align}
              onChange={(event) => patch({ align: event.target.value as typeof preferences.align })}
            >
              <option value="start">{t("reader.alignStart")}</option>
              <option value="justify">{t("reader.alignJustify")}</option>
            </select>
          </label>
          <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">{t("reader.localSettings")}</p>
          <button
            className="min-h-11 w-full border-t border-[var(--border)] text-sm"
            onClick={() => {
              setSettings(false);
              useUIStore.getState().openRightPanel("settings");
            }}
          >
            {t("reader.advanced")}
          </button>
        </div>
      </Modal>
    </div>
  );
}
