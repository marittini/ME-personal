import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { MoreVertical, NotebookPen } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  EXCERPT_HIGHLIGHT_COLORS,
  type ExcerptMarkColor,
  type Message,
  type ReaderExcerpt,
  type ReaderHighlight,
} from "@marinara-engine/shared";
import { api } from "../../lib/api-client";
import { normalizeHydratedMessage } from "../../lib/message-hydration";
import { cn } from "../../lib/utils";
import { ChatBookmarksList } from "./ChatMessageMarksPanels";
import { INTEGRATION_BUTTON as button, INTEGRATION_INPUT as field } from "./IntegrationControls";

export const READER_NOTE_COLORS = Object.keys(EXCERPT_HIGHLIGHT_COLORS) as ExcerptMarkColor[];

export function ColorSwatches({
  value,
  onPick,
  labelKey,
}: {
  value?: ExcerptMarkColor;
  onPick: (color: ExcerptMarkColor) => void;
  labelKey: string;
}) {
  const { t } = useTranslation();
  return (
    <>
      {READER_NOTE_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-pressed={value === undefined ? undefined : value === color}
          aria-label={t(labelKey, { color: t(`excerptStudio.colors.${color}`) })}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-[var(--border)] aria-pressed:ring-2 aria-pressed:ring-[var(--primary)]"
          style={{ background: EXCERPT_HIGHLIGHT_COLORS[color] }}
          // Keep the reader selection while a swatch is pressed.
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => onPick(color)}
        >
          {value === color && (
            <span aria-hidden="true" className="text-base font-bold text-[#2F3437]">
              ✓
            </span>
          )}
        </button>
      ))}
    </>
  );
}

/** Color, private memo and actions for one highlighted sentence. */
export function HighlightEditor({
  highlight,
  busy,
  onSave,
  onDelete,
  onExcerpt,
  onGoto,
}: {
  highlight: ReaderHighlight;
  busy: boolean;
  onSave: (value: Pick<ReaderHighlight, "color" | "note">) => void;
  onDelete: () => void;
  onExcerpt: () => void;
  onGoto?: () => void;
}) {
  const { t } = useTranslation();
  const [color, setColor] = useState(highlight.color);
  const [note, setNote] = useState(highlight.note);
  return (
    <div className="space-y-4">
      <blockquote
        className="whitespace-pre-wrap break-words rounded-md border-l-4 px-3 py-2 text-sm"
        style={{ borderColor: EXCERPT_HIGHLIGHT_COLORS[color] }}
      >
        {highlight.text}
      </blockquote>
      <div role="group" aria-label={t("readerNotes.color")} className="flex flex-wrap gap-2">
        <ColorSwatches value={color} onPick={setColor} labelKey="readerNotes.colorOption" />
      </div>
      <label className="block text-sm">
        {t("readerNotes.memo")}
        <textarea
          className={field}
          rows={5}
          maxLength={5000}
          placeholder={t("readerNotes.memoPlaceholder")}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <p className="text-xs text-[var(--muted-foreground)]">{t("readerNotes.memoPrivate")}</p>
      <div className="flex flex-wrap gap-2">
        <button className={button} type="button" disabled={busy} onClick={() => onSave({ color, note })}>
          {t("readerNotes.save")}
        </button>
        <button className={button} type="button" onClick={onExcerpt}>
          {t("readerNotes.toExcerpt")}
        </button>
        {onGoto && (
          <button className={button} type="button" onClick={onGoto}>
            {t("reader.excerptSource")}
          </button>
        )}
        <button className={button} type="button" disabled={busy} onClick={onDelete}>
          {t("readerNotes.deleteHighlight")}
        </button>
      </div>
    </div>
  );
}

type Tab = "all" | "highlights" | "memos" | "excerpts" | "messages";

/** Reading notes like a novel reader: highlights and memos, excerpt cards and message bookmarks. */
export function ReaderNotesPanel({
  chatId,
  highlights,
  excerpts,
  busy,
  onOpenHighlight,
  onGotoHighlight,
  onExcerptHighlight,
  onDeleteHighlight,
  onEditExcerpt,
  onGotoExcerpt,
  onDeleteExcerpt,
  onGotoMessage,
}: {
  chatId: string;
  highlights: ReaderHighlight[];
  excerpts: ReaderExcerpt[];
  busy: boolean;
  onOpenHighlight: (highlight: ReaderHighlight) => void;
  onGotoHighlight: (highlight: ReaderHighlight) => void;
  onExcerptHighlight: (highlight: ReaderHighlight) => void;
  onDeleteHighlight: (highlight: ReaderHighlight) => void;
  onEditExcerpt: (excerpt: ReaderExcerpt) => void;
  onGotoExcerpt: (excerpt: ReaderExcerpt) => void;
  onDeleteExcerpt: (excerpt: ReaderExcerpt) => void;
  onGotoMessage: (messageNumber: number) => void;
}) {
  const { t } = useTranslation();
  const { i18n } = useTranslation();
  const [tab, setTab] = useState<Tab>("all");
  // Message bookmarks live on messages; load them only when their tab is open.
  const messages = useQuery({
    queryKey: ["chat-message-search", chatId],
    queryFn: ({ signal }) =>
      api.get<Message[]>(`/chats/${chatId}/messages`, { signal }).then((items) => items.map(normalizeHydratedMessage)),
    enabled: tab === "messages",
    staleTime: 30_000,
  });
  const withMemo = highlights.filter((row) => row.note.trim());
  const tabs: Array<[Tab, string, number | null]> = [
    ["all", t("readerNotes.all"), highlights.length],
    ["highlights", t("readerNotes.highlightsOnly"), highlights.length - withMemo.length],
    ["memos", t("readerNotes.memos"), withMemo.length],
    ["excerpts", t("readerNotes.excerpts"), excerpts.length],
    ["messages", t("readerNotes.messageBookmarks"), null],
  ];
  const control =
    "min-h-11 min-w-11 inline-flex items-center justify-center rounded-md px-2 hover:bg-[var(--secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:opacity-40";
  const empty = (text: string) => <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">{text}</p>;
  return (
    <div className="space-y-3 p-4">
      {/* One row of underlined tabs, like a novel reader's notes. */}
      <div
        role="tablist"
        aria-label={t("readerNotes.title")}
        className="-mx-4 flex overflow-x-auto border-b border-[var(--border)] px-2"
      >
        {tabs.map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={cn(
              "-mb-px min-h-11 shrink-0 whitespace-nowrap border-b-2 px-3 text-sm transition-colors",
              tab === key
                ? "border-[var(--foreground)] font-semibold text-[var(--foreground)]"
                : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
            )}
            onClick={() => setTab(key)}
          >
            {label}
            {count !== null && <span className="ml-1 text-xs opacity-70">{count}</span>}
          </button>
        ))}
      </div>
      {(tab === "all" || tab === "highlights" || tab === "memos") && (
        <HighlightList
          highlights={
            tab === "all" ? highlights : tab === "memos" ? withMemo : highlights.filter((row) => !row.note.trim())
          }
          locale={i18n.resolvedLanguage ?? i18n.language}
          busy={busy}
          empty={empty(t("readerNotes.noHighlights"))}
          onOpen={onOpenHighlight}
          onGoto={onGotoHighlight}
          onExcerpt={onExcerptHighlight}
          onDelete={onDeleteHighlight}
        />
      )}
      {tab === "excerpts" &&
        (excerpts.length
          ? [...excerpts].reverse().map((entry) => (
              <article key={entry.id} className="space-y-3 rounded-lg border border-[var(--border)] p-3">
                <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm">{entry.text}</p>
                <div className="flex flex-wrap gap-2 text-sm">
                  <button className={control} type="button" onClick={() => onEditExcerpt(entry)}>
                    {t("reader.editExcerpt")}
                  </button>
                  <button
                    className={control}
                    type="button"
                    disabled={!entry.anchors.length}
                    onClick={() => onGotoExcerpt(entry)}
                  >
                    {t("reader.excerptSource")}
                  </button>
                  <button className={control} type="button" disabled={busy} onClick={() => onDeleteExcerpt(entry)}>
                    {t("reader.deleteExcerpt")}
                  </button>
                </div>
              </article>
            ))
          : empty(t("reader.noExcerpts")))}
      {tab === "messages" &&
        (messages.isLoading ? (
          <p role="status" className="py-8 text-center text-sm">
            {t("integrations.loading")}
          </p>
        ) : (
          <ChatBookmarksList messages={messages.data ?? []} onJump={onGotoMessage} />
        ))}
    </div>
  );
}

/** Where a highlight sits in the record: first message, then position in it. */
function position(highlight: ReaderHighlight) {
  const anchor = highlight.anchors[0];
  return [anchor?.messageNumber ?? Number.MAX_SAFE_INTEGER, anchor?.start ?? 0] as const;
}

/**
 * Highlights the way novel readers list them: grouped by message in reading order, each with its color dot,
 * the sentence, its private memo in a grey box, and a footer with the message number, date and a menu.
 */
function HighlightList({
  highlights,
  locale,
  busy,
  empty,
  onOpen,
  onGoto,
  onExcerpt,
  onDelete,
}: {
  highlights: ReaderHighlight[];
  locale: string;
  busy: boolean;
  empty: ReactNode;
  onOpen: (highlight: ReaderHighlight) => void;
  onGoto: (highlight: ReaderHighlight) => void;
  onExcerpt: (highlight: ReaderHighlight) => void;
  onDelete: (highlight: ReaderHighlight) => void;
}) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !menuRef.current?.contains(event.target)) setMenu(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);
  if (!highlights.length) return <>{empty}</>;
  const sorted = [...highlights].sort((a, b) => {
    const [am, as] = position(a);
    const [bm, bs] = position(b);
    return am - bm || as - bs;
  });
  const date = new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit" });
  const item =
    "flex min-h-11 w-full items-center px-3 text-left text-sm hover:bg-[var(--secondary)] focus-visible:outline-none focus-visible:bg-[var(--secondary)]";
  return (
    <div data-component="ReaderNotes.Highlights">
      {sorted.map((highlight, index) => {
        const number = highlight.anchors[0]?.messageNumber;
        const groupStart = index === 0 || position(sorted[index - 1]!)[0] !== position(highlight)[0];
        return (
          <Fragment key={highlight.id}>
            {groupStart && (
              <h3 className="border-t border-[var(--border)] pb-3 pt-5 text-center text-sm text-[var(--muted-foreground)] first:border-t-0 first:pt-2">
                {number ? t("readerNotes.messageGroup", { number }) : t("readerNotes.unplaced")}
              </h3>
            )}
            <article
              className="relative border-b border-[var(--border)] py-4 last:border-b-0"
              data-reader-note={highlight.id}
            >
              <button
                type="button"
                className="flex w-full items-start gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                onClick={() => onGoto(highlight)}
              >
                <span
                  aria-hidden="true"
                  className="mt-1.5 h-3 w-3 shrink-0 rounded-full ring-1 ring-black/10"
                  style={{ background: EXCERPT_HIGHLIGHT_COLORS[highlight.color] }}
                />
                <span className="min-w-0 whitespace-pre-wrap break-words text-[0.95rem] leading-relaxed">
                  {highlight.text}
                </span>
              </button>
              {highlight.note.trim() && (
                <button
                  type="button"
                  className="mt-3 ml-6 flex w-[calc(100%-1.5rem)] items-start gap-2 rounded-md bg-[var(--secondary)] px-3 py-2.5 text-left text-sm"
                  onClick={() => onOpen(highlight)}
                  aria-label={t("readerNotes.editMemo")}
                >
                  <NotebookPen
                    size={16}
                    className="mt-0.5 shrink-0 text-[var(--muted-foreground)]"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 whitespace-pre-wrap break-words">{highlight.note}</span>
                </button>
              )}
              <div className="ml-6 mt-2 flex items-center justify-between gap-2 text-xs text-[var(--muted-foreground)]">
                <span>
                  {number ? t("readerNotes.messageNumber", { number }) : ""}
                  <span aria-hidden="true" className="mx-2 opacity-50">
                    |
                  </span>
                  {date.format(new Date(highlight.updatedAt))}
                </span>
                <button
                  type="button"
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md hover:bg-[var(--secondary)]"
                  aria-label={t("readerNotes.more")}
                  aria-expanded={menu === highlight.id}
                  onClick={() => setMenu(menu === highlight.id ? null : highlight.id)}
                >
                  <MoreVertical size={18} />
                </button>
              </div>
              {menu === highlight.id && (
                <div
                  ref={menuRef}
                  role="menu"
                  className="absolute bottom-12 right-0 z-10 w-44 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--popover)] py-1 text-[var(--popover-foreground)] shadow-lg"
                >
                  {[
                    [highlight.note.trim() ? "readerNotes.editMemo" : "readerNotes.addMemo", () => onOpen(highlight)],
                    ["reader.excerptSource", () => onGoto(highlight)],
                    ["readerNotes.toExcerpt", () => onExcerpt(highlight)],
                    ["readerNotes.deleteHighlight", () => onDelete(highlight)],
                  ].map(([key, action]) => (
                    <button
                      key={key as string}
                      type="button"
                      role="menuitem"
                      className={item}
                      disabled={busy && key === "readerNotes.deleteHighlight"}
                      onClick={() => {
                        setMenu(null);
                        (action as () => void)();
                      }}
                    >
                      {t(key as string)}
                    </button>
                  ))}
                </div>
              )}
            </article>
          </Fragment>
        );
      })}
    </div>
  );
}
