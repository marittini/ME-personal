import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import {
  useCommittedMemory,
  useCommitMemory,
  useSetCommittedMemory,
  useMemoryPreview,
  useMemorySource,
} from "../../hooks/use-committed-memory";
import { useChatStore } from "../../stores/chat.store";
function Source({ chatId, id }: { chatId: string; id: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const source = useMemorySource(chatId, id, open);
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer break-all">
        {t("chat.committedMemory.source")}: {id}
      </summary>
      {source.isLoading && <Loader2 className="animate-spin" size={14} />}{" "}
      {source.error && <p>{t("chat.committedMemory.sourceMissing")}</p>}
      {source.data && <p className="my-2 whitespace-pre-wrap break-words">{source.data.content}</p>}
    </details>
  );
}
export function CommittedMemoryPanel({ chatId }: { chatId: string }) {
  const { t } = useTranslation();
  const status = useCommittedMemory(chatId);
  const commit = useCommitMemory(chatId);
  const toggle = useSetCommittedMemory(chatId);
  const streaming = useChatStore((s) => s.streamingChatId === chatId && s.isStreaming);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const preview = useMemoryPreview(chatId, search, previewOpen);
  const data = status.data;
  const busy = commit.isPending || toggle.isPending || data?.state.job?.status === "running";
  const error = status.error || commit.error || toggle.error;
  return (
    <section
      className="mb-3 space-y-3 rounded-lg border border-[var(--border)] bg-[var(--secondary)]/40 p-3"
      data-committed-memory
    >
      <h3 className="font-semibold">{t("chat.committedMemory.title")}</h3>
      <p className="text-xs text-[var(--muted-foreground)]">{t("chat.committedMemory.help")}</p>
      {!data && !error && <Loader2 className="animate-spin" size={16} />}
      {data && (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={data.state.enabled}
              disabled={busy || streaming}
              onChange={(e) => toggle.mutate(e.target.checked)}
            />
            {t("chat.committedMemory.enabled")}
          </label>
          <p className="text-xs">{t("chat.committedMemory.pending", { count: data.pending })}</p>
          <button
            type="button"
            className="rounded-md bg-[var(--primary)] px-3 py-2 text-sm text-[var(--primary-foreground)] disabled:opacity-50"
            disabled={busy || streaming || !data.pending}
            onClick={() => commit.mutate()}
          >
            {busy ? t("chat.committedMemory.processing") : t("chat.committedMemory.commit")}
          </button>
          {streaming && <p className="text-xs">{t("chat.committedMemory.waitForReply")}</p>}
          {data.state.job && (
            <p role="status" className="text-xs">
              {t(`chat.committedMemory.job.${data.state.job.status}`)} {data.state.job.completed}/{data.state.job.total}
            </p>
          )}
          {data.state.job?.error && (
            <p role="alert" className="text-xs text-[var(--destructive)]">
              {data.state.job.error}
            </p>
          )}
          <details>
            <summary className="cursor-pointer text-sm">{t("chat.committedMemory.records")}</summary>
            <div className="max-h-96 space-y-3 overflow-y-auto pt-2">
              {!data.state.batches.length && <p className="text-xs">{t("chat.committedMemory.empty")}</p>}
              {[...data.state.batches].reverse().map((b) => (
                <article key={b.id} className="space-y-2 rounded border border-[var(--border)] p-2 text-xs">
                  <p>
                    {b.createdAt} ·{" "}
                    {b.invalidated ? t("chat.committedMemory.invalidated") : t("chat.committedMemory.confirmed")}
                  </p>
                  <p className="whitespace-pre-wrap">{b.summary}</p>
                  <details>
                    <summary>{t("chat.committedMemory.core")}</summary>
                    <p className="whitespace-pre-wrap">{b.core}</p>
                  </details>
                  {b.facts.map((f) => (
                    <div key={f.id} className="border-l-2 border-[var(--border)] pl-2">
                      <p>
                        {t(`chat.committedMemory.kind.${f.kind}`)} · {t(`chat.committedMemory.factStatus.${f.status}`)}{" "}
                        ·{" "}
                        {f.audience === "shared"
                          ? t("chat.committedMemory.shared")
                          : t("chat.committedMemory.restrictedAudience", { audience: f.audience.join(", ") })}
                      </p>
                      <p className="whitespace-pre-wrap">{f.content}</p>
                    </div>
                  ))}
                  <details>
                    <summary>{t("chat.committedMemory.sources")}</summary>
                    {b.sources.map((s) => (
                      <Source key={s.id} chatId={chatId} id={s.id} />
                    ))}
                  </details>
                </article>
              ))}
            </div>
          </details>
          <details>
            <summary className="cursor-pointer text-sm">{t("chat.committedMemory.receipt")}</summary>
            <p className="my-2 text-xs text-[var(--muted-foreground)]">{t("chat.committedMemory.receiptHelp")}</p>
            {data.lastReceipt?.items.map((item) => (
              <details key={item.id} className="my-2 text-xs">
                <summary className="whitespace-pre-wrap">
                  {t(`chat.committedMemory.reason.${item.reason}`)}: {item.content}
                </summary>
                {item.sourceIds.map((id) => (
                  <Source key={id} chatId={chatId} id={id} />
                ))}
              </details>
            ))}
            {!data.lastReceipt?.items.length && <p className="text-xs">{t("chat.committedMemory.noReceipt")}</p>}
          </details>
          <details onToggle={(e) => setPreviewOpen(e.currentTarget.open)}>
            <summary className="cursor-pointer text-sm">{t("chat.committedMemory.preview")}</summary>
            <p className="my-2 text-xs text-[var(--muted-foreground)]">{t("chat.committedMemory.previewHelp")}</p>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setSearch(query);
              }}
            >
              <input
                className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--background)] p-2 text-sm"
                aria-label={t("chat.committedMemory.query")}
                placeholder={t("chat.committedMemory.query")}
                value={query}
                maxLength={12000}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button type="submit" className="text-sm">
                {t("chat.committedMemory.search")}
              </button>
            </form>
            {preview.error && <p role="alert">{preview.error.message}</p>}
            {preview.data && (
              <p className="my-2 text-xs">
                {t("chat.committedMemory.budget", { used: preview.data.usedBytes, total: preview.data.budgetBytes })}
              </p>
            )}
            {preview.data?.selected.map((item) => (
              <details key={item.id} className="my-2 text-xs">
                <summary className="whitespace-pre-wrap">
                  {t(`chat.committedMemory.reason.${item.reason}`)}: {item.content}
                </summary>
                {item.sourceIds.map((id) => (
                  <Source key={id} chatId={chatId} id={id} />
                ))}
              </details>
            ))}
          </details>
        </>
      )}
      {error && (
        <p role="alert" className="text-xs text-[var(--destructive)]">
          {error.message}
        </p>
      )}
    </section>
  );
}
