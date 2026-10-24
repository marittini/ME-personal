import { useEffect, useMemo, useRef, useState, lazy, Suspense, type CSSProperties, type ReactNode } from "react";
import { ArrowLeft, BookOpen, ChevronLeft, NotebookPen, PencilLine, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useChat, useUpdateChatMetadata } from "../../hooks/use-chats";
import { useBackDismiss } from "../../hooks/use-back-dismiss";
import { useReaderPosition } from "../../hooks/use-reader-position";
import { useChatStore } from "../../stores/chat.store";
import { useUIStore } from "../../stores/ui.store";
import { useDialogStore } from "../../stores/dialog.store";
import {
  readerExcerptsSchema,
  readerExcerptSchema,
  readerHighlightsSchema,
  type ExcerptMarkColor,
  type ReaderExcerpt,
  type ReaderExcerptAnchor,
  type ReaderHighlight,
} from "@marinara-engine/shared";
import { highlightAtPoint, sameAnchors } from "../../lib/reader-notes";
import { ColorSwatches, HighlightEditor, ReaderNotesPanel } from "./ReaderNotes";
import { captureExcerptAnchors } from "../../lib/reader-excerpt-anchors";
import { useReaderHighlights } from "../../hooks/use-reader-highlights";
import { showConfirmDialog } from "../../lib/app-dialogs";
import { Modal } from "../ui/Modal";
import { libraryChatGroupKey } from "../../lib/library-chat-group";
import { getChatWidgetFontFamily } from "../../lib/font-family";
import { toast } from "sonner";
import { ReaderSettings } from "./ReaderSettings";
import { readerModePreferences } from "../../lib/reader-preferences";
const ExcerptStudio = lazy(() => import("./ExcerptStudio").then((module) => ({ default: module.ExcerptStudio })));

export function ReaderWorkspace({ children, surfaceActive }: { children: ReactNode; surfaceActive: boolean }) {
  const { t } = useTranslation();
  const updateMetadata = useUpdateChatMetadata({ serialize: true });
  const chatId = useChatStore((state) => state.activeChatId);
  const { data: chat } = useChat(chatId);
  const streaming = useChatStore((state) => state.isStreaming && state.streamingChatId === chatId);
  const storedPreferences = useUIStore((state) => state.readerPreferences);
  const fontSize = useUIStore((state) => state.chatFontSize);
  const overlayOpen = useUIStore((state) => state.rightPanelOpen || !!state.modal || state.hasAnyDetailOpen());
  const dialogOpen = useDialogStore((state) => !!state.dialog);
  // Focus mode is never saved: leaving the room or reloading always ends it, so nobody is stuck in it.
  const [focus, setFocus] = useState(false);
  /** In focus mode the top bar hides; hovering (PC) or tapping (phone) the top edge brings it back for a while. */
  const [revealed, setRevealed] = useState(false);
  const headerHovered = useRef(false);
  /** When focus mode began: the tap that turned it on must not land on the top edge as a ghost click. */
  const focusSince = useRef(0);
  const [settings, setSettings] = useState(false);
  const [excerptSelection, setExcerptSelection] = useState("");
  const [excerpt, setExcerpt] = useState<ReaderExcerpt | null>(null);
  const [excerptList, setExcerptList] = useState(false);
  const [editingHighlight, setEditingHighlight] = useState<ReaderHighlight | null>(null);
  const selectionAnchors = useRef<ReaderExcerptAnchor[]>([]);
  const excerpts = useMemo(() => {
    const parsed = readerExcerptsSchema.safeParse(chat?.metadata.readerExcerpts ?? []);
    return parsed.success ? parsed.data : [];
  }, [chat?.metadata.readerExcerpts]);
  const highlights = useMemo(() => {
    const parsed = readerHighlightsSchema.safeParse(chat?.metadata.readerHighlights ?? []);
    return parsed.success ? parsed.data : [];
  }, [chat?.metadata.readerHighlights]);
  const root = useRef<HTMLDivElement>(null);
  const enabled = !!chatId && chat?.mode !== "game";
  const conversation = chat?.mode === "conversation";
  // Shared page/font plus this mode's own layout; RP and Convo save their layouts separately.
  const preferences = readerModePreferences(storedPreferences, conversation ? "conversation" : "roleplay");
  // Reading notes and the highlighter belong to the novel reader (roleplay); Convo keeps only excerpts.
  const notesActive = enabled && surfaceActive && !conversation;
  const selectionActive = enabled && surfaceActive;
  useReaderHighlights(root, excerpts, selectionActive, conversation ? [] : highlights);
  const saveHighlights = (next: ReaderHighlight[], onSuccess?: () => void) => {
    if (!chatId) return;
    updateMetadata.mutate(
      { id: chatId, readerHighlights: next },
      { onSuccess, onError: () => toast.error(t("integrations.saveError")) },
    );
  };
  /** Highlight the current selection; the same sentence again only changes its color. */
  const highlightSelection = (color: ExcerptMarkColor, openMemo = false) => {
    const anchors = selectionAnchors.current;
    if (!anchors.length || !excerptSelection.trim()) return;
    if (excerptSelection.length > 20000) {
      toast.error(t("integrations.excerptLimit"));
      return;
    }
    const now = new Date().toISOString();
    const existing = highlights.find((row) => sameAnchors(row.anchors, anchors));
    const highlight: ReaderHighlight = existing
      ? { ...existing, color: openMemo ? existing.color : color, updatedAt: now }
      : { id: crypto.randomUUID(), color, note: "", text: excerptSelection, anchors, createdAt: now, updatedAt: now };
    if (!existing && highlights.length >= 2000) {
      toast.error(t("readerNotes.limit"));
      return;
    }
    saveHighlights([...highlights.filter((row) => row.id !== highlight.id), highlight], () => {
      window.getSelection()?.removeAllRanges();
      setExcerptSelection("");
      if (openMemo) setEditingHighlight(highlight);
    });
  };
  const gotoAnchor = (anchor: ReaderExcerptAnchor | undefined) => {
    if (!chatId || !anchor) return;
    setExcerptList(false);
    setEditingHighlight(null);
    useChatStore.getState().requestGotoMessage(chatId, anchor.messageNumber, undefined, anchor.messageId);
  };
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
    if (conversation) setFocus(false);
  }, [conversation]);
  useEffect(() => {
    if (!focus) setRevealed(false);
    else focusSince.current = Date.now();
  }, [focus]);
  const edgeHovered = useRef(false);
  const reveal = () => {
    if (Date.now() - focusSince.current > 500) setRevealed(true);
  };
  // On the document too, so floating windows and tips rendered outside the reader hide as well.
  const focused = enabled && focus;
  useEffect(() => {
    if (!focused) return;
    document.documentElement.dataset.readerFocus = "true";
    return () => {
      delete document.documentElement.dataset.readerFocus;
    };
  }, [focused]);
  // The revealed top bar hides again after a moment unless the pointer rests on it.
  useEffect(() => {
    if (!focus || !revealed) return;
    const timer = window.setInterval(() => {
      if (!headerHovered.current) setRevealed(false);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [focus, revealed]);
  // Esc ends focus mode on PC (an open dialog closes first, as usual).
  useEffect(() => {
    if (!focus) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Only a dialog on screen closes first; windows hidden by focus mode itself do not count.
      const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]');
      if (Array.from(dialogs).some((dialog) => dialog.getClientRects().length > 0)) return;
      setFocus(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [focus]);

  useEffect(() => {
    if (!enabled) return;
    document.documentElement.dataset.readerWorkspace = "quiet";
    return () => {
      delete document.documentElement.dataset.readerWorkspace;
    };
  }, [enabled]);
  useEffect(() => {
    setFocus(false);
    setSettings(false);
    setExcerpt(null);
    setExcerptSelection("");
    setExcerptList(false);
    setEditingHighlight(null);
    selectionAnchors.current = [];
  }, [chatId]);
  // Tapping a highlighted sentence opens its memo, like a novel reader.
  useEffect(() => {
    const host = root.current;
    if (!notesActive || !host || !highlights.length) return;
    const tap = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".mari-message-content")) return;
      if (event.target.closest("button, a, input, textarea, select, [data-dialogue-controls]")) return;
      if (!window.getSelection()?.isCollapsed) return;
      const hit = highlightAtPoint(host, highlights, event.clientX, event.clientY);
      if (!hit) return;
      event.stopPropagation();
      setEditingHighlight(hit);
    };
    host.addEventListener("click", tap);
    return () => host.removeEventListener("click", tap);
  }, [notesActive, highlights]);
  useEffect(() => {
    if (!selectionActive) return;
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
  }, [chatId, selectionActive]);

  const control =
    "min-h-11 min-w-11 inline-flex items-center justify-center rounded-md px-2 hover:bg-[var(--secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]";
  // Convo keeps only the reading settings: no reading notes, focus mode or highlighter there.
  const actions = (
    <>
      {!conversation && (
        <>
          <button
            className={control}
            onClick={() => setExcerptList(true)}
            aria-label={t("readerNotes.title")}
            title={t("readerNotes.title")}
          >
            <NotebookPen size={18} />
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
        </>
      )}
      <button
        className={control}
        onClick={() => setSettings(true)}
        aria-label={t("reader.settings")}
        title={t("reader.settings")}
      >
        <Settings2 size={20} />
      </button>
    </>
  );
  return (
    <div
      ref={root}
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
      data-component="ReaderWorkspace"
      data-reader-enabled={enabled || undefined}
      data-reader-mode={enabled ? chat?.mode : undefined}
      data-reader-focus={(enabled && focus) || undefined}
      data-reader-revealed={(enabled && focus && revealed) || undefined}
      data-reader-streaming={streaming || undefined}
      data-reader-bubble-scope={conversation ? preferences.bubbleScope : undefined}
      style={
        {
          "--reader-line-height": preferences.lineHeight,
          "--reader-letter-spacing": `${preferences.letterSpacing}px`,
          "--reader-gap": `${preferences.paragraphGap}em`,
          "--reader-width": `${preferences.width}px`,
          "--reader-font":
            getChatWidgetFontFamily(preferences.font === "serif" ? "@serif" : preferences.font) ?? "inherit",
          "--reader-indent": `${Math.max(0, Math.min(4, preferences.indent))}em`,
          "--reader-align": preferences.align,
          "--reader-body-size": `${fontSize}px`,
          "--reader-side-margin": `${preferences.sideMargin ?? 0}px`,
          "--reader-translation-offset": `${preferences.translationSizeOffset ?? 0}px`,
          ...(preferences.bubbleCharacterBg ? { "--reader-bubble-character-bg": preferences.bubbleCharacterBg } : {}),
          ...(preferences.bubbleCharacterText
            ? { "--reader-bubble-character-text": preferences.bubbleCharacterText }
            : {}),
          ...(preferences.bubblePersonaBg ? { "--reader-bubble-persona-bg": preferences.bubblePersonaBg } : {}),
          ...(preferences.bubblePersonaText ? { "--reader-bubble-persona-text": preferences.bubblePersonaText } : {}),
        } as CSSProperties
      }
    >
      {enabled && (
        <header
          className={
            conversation
              ? "grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-1 border-b border-[var(--border)] bg-[var(--background)]/90 px-2 pb-1.5 pt-[calc(env(safe-area-inset-top)+0.375rem)] text-[var(--foreground)] backdrop-blur"
              : "flex shrink-0 items-center gap-1 border-b border-[var(--border)] bg-[var(--background)] px-2 pt-[env(safe-area-inset-top)] text-[var(--foreground)]"
          }
          data-chat-window-top-obstacle=""
          data-reader-header={conversation ? "messenger" : "book"}
          aria-label={t("reader.navigation")}
          aria-hidden={(focus && !revealed) || undefined}
          inert={focus && !revealed}
          onPointerEnter={() => (headerHovered.current = true)}
          onPointerLeave={() => (headerHovered.current = false)}
        >
          {conversation ? (
            <>
              <div className="flex min-w-0 items-center">
                <button className={control} onClick={back} aria-label={t("reader.back")}>
                  <ChevronLeft size={26} className="text-[var(--primary)]" />
                </button>
              </div>
              {/* iMessage-style contact, centered: Convo moves its own presence card (avatar, name, status menu)
                  into this slot; the chat name shows until it arrives. */}
              <div className="flex min-w-0 max-w-[50vw] flex-col items-center" data-reader-contact="">
                <div data-reader-contact-slot="" className="flex min-w-0 max-w-full justify-center" />
                <span data-reader-contact-fallback="" className="max-w-full truncate text-xs font-medium">
                  {chat?.name}
                </span>
              </div>
              <div className="flex min-w-0 items-center justify-end">{actions}</div>
            </>
          ) : (
            <>
              <button className={control} onClick={back} aria-label={t("reader.back")}>
                <ArrowLeft size={20} />
              </button>
              <span className="min-w-0 flex-1 truncate px-1 text-sm font-medium">{chat?.name}</span>
              {actions}
            </>
          )}
        </header>
      )}
      {children}
      {enabled && focus && !revealed && !settings && !excerpt && !excerptList && !editingHighlight && (
        // The way out of focus mode: the top edge, above the page and its floating windows.
        <button
          type="button"
          data-reader-focus-edge=""
          aria-label={t("reader.focusReveal")}
          className="fixed inset-x-0 top-0 z-[2147483000] h-12 cursor-default bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary)]"
          onPointerEnter={(event) => {
            // Only a real hovering mouse; phones (no hover) bring the bar back with a tap.
            if (event.pointerType !== "mouse" || !window.matchMedia("(hover: hover)").matches) return;
            // A mouse already resting here when focus starts waits out the guard, then still brings the bar back.
            edgeHovered.current = true;
            const wait = 500 - (Date.now() - focusSince.current);
            if (wait <= 0) reveal();
            else window.setTimeout(() => edgeHovered.current && reveal(), wait + 20);
          }}
          onPointerLeave={() => (edgeHovered.current = false)}
          onClick={reveal}
        />
      )}
      {excerptSelection.trim() && !excerpt && !editingHighlight && (
        // Bottom bar instead of a popup at the selection, so it never fights the mobile selection menu.
        <div
          role="toolbar"
          aria-label={t("readerNotes.selectionTools")}
          className="absolute bottom-24 left-1/2 z-30 flex max-w-[calc(100%-1rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--popover)] p-1.5 text-sm text-[var(--popover-foreground)] shadow-sm"
          onPointerDown={(event) => event.preventDefault()}
        >
          {!conversation && (
            <>
              <ColorSwatches onPick={(color) => highlightSelection(color)} labelKey="readerNotes.highlightWith" />
              <button
                type="button"
                className="min-h-11 rounded-md px-3 hover:bg-[var(--secondary)]"
                disabled={updateMetadata.isPending}
                onClick={() => highlightSelection("y", true)}
              >
                {t("readerNotes.memo")}
              </button>
            </>
          )}
          <button
            type="button"
            className="min-h-11 rounded-md px-3 hover:bg-[var(--secondary)]"
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
        </div>
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
      <Modal open={excerptList} onClose={() => setExcerptList(false)} title={t("readerNotes.title")}>
        {chatId && (
          <ReaderNotesPanel
            chatId={chatId}
            highlights={highlights}
            excerpts={excerpts}
            busy={updateMetadata.isPending}
            onOpenHighlight={(highlight) => {
              setExcerptList(false);
              setEditingHighlight(highlight);
            }}
            onGotoHighlight={(highlight) => gotoAnchor(highlight.anchors[0])}
            onExcerptHighlight={(highlight) => {
              // The memo stays in the notes; the card carries only the sentence.
              setExcerptList(false);
              setExcerpt({
                id: crypto.randomUUID(),
                text: highlight.text,
                marks: [],
                anchors: highlight.anchors,
                updatedAt: new Date().toISOString(),
              });
            }}
            onDeleteHighlight={async (highlight) => {
              if (
                await showConfirmDialog({
                  title: t("readerNotes.deleteHighlight"),
                  message: highlight.text.slice(0, 200),
                  confirmLabel: t("readerNotes.deleteHighlight"),
                  cancelLabel: t("reader.cancel"),
                })
              )
                saveHighlights(highlights.filter((row) => row.id !== highlight.id));
            }}
            onEditExcerpt={(entry) => {
              setExcerptList(false);
              setExcerpt(entry);
            }}
            onGotoExcerpt={(entry) => gotoAnchor(entry.anchors[0])}
            onDeleteExcerpt={async (entry) => {
              if (
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
            onGotoMessage={(messageNumber) => {
              setExcerptList(false);
              useChatStore.getState().requestGotoMessage(chatId, messageNumber);
            }}
          />
        )}
      </Modal>
      <Modal
        open={editingHighlight !== null}
        onClose={() => setEditingHighlight(null)}
        title={t("readerNotes.highlightTitle")}
      >
        {editingHighlight && (
          <div className="p-4">
            <HighlightEditor
              key={editingHighlight.id}
              highlight={editingHighlight}
              busy={updateMetadata.isPending}
              onSave={(value) => {
                const next = { ...editingHighlight, ...value, updatedAt: new Date().toISOString() };
                saveHighlights(
                  highlights.map((row) => (row.id === next.id ? next : row)),
                  () => {
                    setEditingHighlight((current) => (current?.id === next.id ? null : current));
                    toast.success(t("integrations.saved"));
                  },
                );
              }}
              onDelete={async () => {
                if (
                  await showConfirmDialog({
                    title: t("readerNotes.deleteHighlight"),
                    message: editingHighlight.text.slice(0, 200),
                    confirmLabel: t("readerNotes.deleteHighlight"),
                    cancelLabel: t("reader.cancel"),
                  })
                )
                  saveHighlights(
                    highlights.filter((row) => row.id !== editingHighlight.id),
                    () => setEditingHighlight(null),
                  );
              }}
              onExcerpt={() => {
                // The memo stays in the notes; the card carries only the sentence.
                setExcerpt({
                  id: crypto.randomUUID(),
                  text: editingHighlight.text,
                  marks: [],
                  anchors: editingHighlight.anchors,
                  updatedAt: new Date().toISOString(),
                });
                setEditingHighlight(null);
              }}
              onGoto={() => gotoAnchor(editingHighlight.anchors[0])}
            />
          </div>
        )}
      </Modal>
      <Modal open={settings} onClose={() => setSettings(false)} title={t("reader.settings")}>
        <ReaderSettings
          chat={chat}
          onAdvanced={() => {
            setSettings(false);
            useUIStore.getState().openRightPanel("settings");
          }}
        />
      </Modal>
    </div>
  );
}
