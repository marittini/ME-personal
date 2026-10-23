import { useState } from "react";
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

type Tab = "highlights" | "excerpts" | "messages";

/** Reading notes like a novel reader: highlights and memos, excerpt cards and message bookmarks. */
export function ReaderNotesPanel({
  chatId,
  highlights,
  excerpts,
  busy,
  onOpenHighlight,
  onGotoHighlight,
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
  onEditExcerpt: (excerpt: ReaderExcerpt) => void;
  onGotoExcerpt: (excerpt: ReaderExcerpt) => void;
  onDeleteExcerpt: (excerpt: ReaderExcerpt) => void;
  onGotoMessage: (messageNumber: number) => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("highlights");
  // Message bookmarks live on messages; load them only when their tab is open.
  const messages = useQuery({
    queryKey: ["chat-message-search", chatId],
    queryFn: ({ signal }) =>
      api.get<Message[]>(`/chats/${chatId}/messages`, { signal }).then((items) => items.map(normalizeHydratedMessage)),
    enabled: tab === "messages",
    staleTime: 30_000,
  });
  const tabs: Array<[Tab, string, number | null]> = [
    ["highlights", t("readerNotes.highlights"), highlights.length],
    ["excerpts", t("readerNotes.excerpts"), excerpts.length],
    ["messages", t("readerNotes.messageBookmarks"), null],
  ];
  const control =
    "min-h-11 min-w-11 inline-flex items-center justify-center rounded-md px-2 hover:bg-[var(--secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:opacity-40";
  const empty = (text: string) => <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">{text}</p>;
  return (
    <div className="space-y-3 p-4">
      <div role="tablist" aria-label={t("readerNotes.title")} className="flex flex-wrap gap-1">
        {tabs.map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={cn(button, tab === key && "bg-[var(--secondary)] font-semibold")}
            onClick={() => setTab(key)}
          >
            {label}
            {count !== null && <span className="ml-1 text-xs opacity-70">{count}</span>}
          </button>
        ))}
      </div>
      {tab === "highlights" &&
        (highlights.length
          ? [...highlights].reverse().map((highlight) => (
              <article key={highlight.id} className="space-y-2 rounded-lg border border-[var(--border)] p-3">
                <p
                  className="line-clamp-3 whitespace-pre-wrap break-words border-l-4 pl-2 text-sm"
                  style={{ borderColor: EXCERPT_HIGHLIGHT_COLORS[highlight.color] }}
                >
                  {highlight.text}
                </p>
                {highlight.note.trim() && (
                  <p className="whitespace-pre-wrap break-words rounded-md bg-[var(--secondary)] px-2 py-1.5 text-sm">
                    {highlight.note}
                  </p>
                )}
                <div className="flex flex-wrap gap-2 text-sm">
                  <button className={control} type="button" onClick={() => onOpenHighlight(highlight)}>
                    {t(highlight.note.trim() ? "readerNotes.editMemo" : "readerNotes.addMemo")}
                  </button>
                  <button className={control} type="button" onClick={() => onGotoHighlight(highlight)}>
                    {t("reader.excerptSource")}
                  </button>
                </div>
              </article>
            ))
          : empty(t("readerNotes.noHighlights")))}
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
