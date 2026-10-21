import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowLeft, BookOpen, ChevronDown, PencilLine, Settings2, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useChat } from "../../hooks/use-chats";
import { useBackDismiss } from "../../hooks/use-back-dismiss";
import { useReaderPosition } from "../../hooks/use-reader-position";
import { useChatStore } from "../../stores/chat.store";
import { useUIStore } from "../../stores/ui.store";
import { useDialogStore } from "../../stores/dialog.store";
import { requestChatScrollToBottom } from "../../lib/chat-scroll-events";
import { Modal } from "../ui/Modal";

export function ReaderWorkspace({ children, surfaceActive }: { children: ReactNode; surfaceActive: boolean }) {
  const { t } = useTranslation();
  const chatId = useChatStore((state) => state.activeChatId);
  const { data: chat } = useChat(chatId);
  const streaming = useChatStore((state) => state.isStreaming && state.streamingChatId === chatId);
  const preferences = useUIStore((state) => state.readerPreferences);
  const fontSize = useUIStore((state) => state.chatFontSize);
  const theme = useUIStore((state) => state.theme);
  const overlayOpen = useUIStore((state) => state.rightPanelOpen || !!state.modal || state.hasAnyDetailOpen());
  const dialogOpen = useDialogStore((state) => !!state.dialog);
  const [focus, setFocus] = useState(false);
  const [tools, setTools] = useState(false);
  const [settings, setSettings] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const enabled = !!chatId && chat?.mode !== "game";
  const back = () => {
    if (chat) {
      const workId = chat.connectedChatId ? [chat.id, chat.connectedChatId].sort().join(":") : chat.id;
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
  }, [chatId]);

  const patch = (value: Partial<typeof preferences>) =>
    useUIStore.setState((state) => ({ readerPreferences: { ...state.readerPreferences, ...value } }));
  const control =
    "min-h-11 min-w-11 inline-flex items-center justify-center rounded-md px-2 hover:bg-[var(--secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]";
  return (
    <div
      ref={root}
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      data-component="ReaderWorkspace"
      data-reader-enabled={enabled || undefined}
      data-reader-focus={(enabled && focus) || undefined}
      data-reader-streaming={streaming || undefined}
      data-reader-tools={tools || undefined}
      style={
        {
          "--reader-line-height": preferences.lineHeight,
          "--reader-gap": `${preferences.paragraphGap}em`,
          "--reader-width": `${preferences.width}px`,
          "--reader-font": preferences.font === "serif" ? "Georgia, 'Noto Serif KR', serif" : "inherit",
          "--reader-align": preferences.align,
        } as CSSProperties
      }
    >
      {enabled && (
        <header
          className="flex shrink-0 items-center gap-1 border-b border-[var(--border)] bg-[var(--background)] px-2 pt-[env(safe-area-inset-top)] text-[var(--foreground)]"
          aria-label={t("reader.navigation")}
        >
          <button className={control} onClick={back} aria-label={t("reader.back")}>
            <ArrowLeft size={20} />
          </button>
          <span className="min-w-0 flex-1 truncate px-1 text-sm font-medium">{chat?.name}</span>
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
      <Modal open={settings} onClose={() => setSettings(false)} title={t("reader.settings")}>
        <div className="space-y-6 p-5">
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
          <label className="block text-sm">
            {t("reader.lineHeight", { value: preferences.lineHeight })}
            <input
              className="mt-3 block w-full"
              type="range"
              min={1.3}
              max={2.5}
              step={0.1}
              value={preferences.lineHeight}
              onChange={(event) => patch({ lineHeight: Number(event.target.value) })}
            />
          </label>
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
            {t("reader.font")}
            <select
              className="min-h-11 bg-[var(--background)]"
              value={preferences.font}
              onChange={(event) => patch({ font: event.target.value as typeof preferences.font })}
            >
              <option value="inherit">{t("reader.fontDefault")}</option>
              <option value="serif">{t("reader.fontSerif")}</option>
            </select>
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
