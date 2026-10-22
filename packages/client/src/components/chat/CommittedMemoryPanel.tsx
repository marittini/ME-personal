import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, BookOpen, Check, ChevronRight, FileText, Loader2, Search, Settings2, X } from "lucide-react";
import {
  isChatProvider,
  CHAT_SUMMARY_OUTPUT_TOKENS,
  type APIConnection,
  type CommittedMemoryBatch,
  type CommittedMemoryFact,
} from "@marinara-engine/shared";
import {
  useCommittedMemory,
  useCommitMemory,
  useSetCommittedMemory,
  useMemoryPreview,
  useMemorySource,
  useMemoryConnection,
  useEditMemory,
} from "../../hooks/use-committed-memory";
import { useChat, useUpdateChatMetadata } from "../../hooks/use-chats";
import { useConnections } from "../../hooks/use-connections";
import { useChatStore } from "../../stores/chat.store";
import {
  ToggleSetting,
  SETTINGS_BUTTON_CLASS,
  SETTINGS_PRIMARY_BUTTON_CLASS,
} from "../panels/settings/SettingControls";
import { NEUTRAL_SURFACE_VARIABLES } from "../ui/neutral-surface-styles";
import "../../styles/memory-vault.css";

function Source({ chatId, id }: { chatId: string; id: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const source = useMemorySource(chatId, id, open);
  return (
    <details className="memory-vault__source" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        {t("chat.committedMemory.source")} · {id.slice(0, 8)}
      </summary>
      {source.isLoading && <Loader2 className="motion-safe:animate-spin" size={16} />}
      {source.error && <p role="alert">{t("chat.committedMemory.sourceMissing")}</p>}
      {source.data && <p className="whitespace-pre-wrap break-words">{source.data.content}</p>}
    </details>
  );
}
type Tab = "overview" | "promise" | "facts" | "story" | "receipt" | "settings";
type Entry = { batch: CommittedMemoryBatch; fact?: CommittedMemoryFact };
const TABS: Tab[] = ["overview", "promise", "facts", "story", "receipt", "settings"];
const field = "memory-vault__field";

function MemoryDetail({
  chatId,
  entry,
  onBack,
  korean,
}: {
  chatId: string;
  entry: Entry;
  onBack: () => void;
  korean: boolean;
}) {
  const { t } = useTranslation();
  const { batch, fact } = entry;
  const edit = useEditMemory(chatId);
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(fact?.content ?? batch.summary);
  const [core, setCore] = useState(batch.core);
  const [revision, setRevision] = useState(batch.revision ?? batch.createdAt);
  const patch = (changes: Parameters<typeof edit.mutate>[0]) =>
    edit.mutate(changes, { onSuccess: () => setEditing(false) });
  const identity = {
    batchId: batch.id,
    factId: fact?.id,
    expectedRevision: editing ? revision : (batch.revision ?? batch.createdAt),
  };
  const excluded = batch.excluded || fact?.excluded;
  const display = (original: string, ko?: string) => (korean && ko?.trim() ? ko : original);
  return (
    <article className="memory-vault__detail">
      <button className={`${SETTINGS_BUTTON_CLASS} memory-vault__back`} onClick={onBack}>
        <ArrowLeft size={14} />
        {t("chat.committedMemory.vault.back")}
      </button>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="memory-vault__eyebrow">
          {fact ? t(`chat.committedMemory.kind.${fact.kind}`) : t("chat.committedMemory.vault.tabs.story")} ·{" "}
          {new Date(batch.createdAt).toLocaleDateString()}
        </span>
        <span className="memory-vault__status">
          {batch.invalidated || fact?.invalidated
            ? t("chat.committedMemory.invalidated")
            : excluded
              ? t("chat.committedMemory.vault.excluded")
              : t("chat.committedMemory.confirmed")}
        </span>
      </div>
      <h4>
        {(fact ? display(fact.key, fact.keyKo) : "") || t("chat.committedMemory.vault.episode", { turn: batch.turn })}
      </h4>
      {editing ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            patch({ ...identity, ...(fact ? { content } : { summary: content, core }) });
          }}
        >
          <label className="block">
            {t("chat.committedMemory.vault.originalContent")}
            <textarea
              className={field}
              rows={7}
              maxLength={fact ? 1500 : 12000}
              required={!!fact}
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </label>
          {!fact && (
            <label className="block">
              {t("chat.committedMemory.core")}
              <textarea
                className={field}
                rows={4}
                maxLength={2500}
                value={core}
                onChange={(e) => setCore(e.target.value)}
              />
            </label>
          )}
          <div className="flex gap-2">
            <button className={SETTINGS_PRIMARY_BUTTON_CLASS} disabled={edit.isPending}>
              <Check size={14} />
              {t("chat.committedMemory.vault.save")}
            </button>
            <button type="button" className={SETTINGS_BUTTON_CLASS} onClick={() => setEditing(false)}>
              <X size={14} />
              {t("chat.committedMemory.vault.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="memory-vault__prose">
            {(fact ? display(fact.content, fact.contentKo) : display(batch.summary, batch.summaryKo)) ||
              t("chat.committedMemory.vault.privateSummary")}
          </p>
          {!fact && batch.core && (
            <div className="memory-vault__core">
              <h5>{t("chat.committedMemory.core")}</h5>
              <p className="memory-vault__prose">{display(batch.core, batch.coreKo)}</p>
            </div>
          )}
        </>
      )}
      {fact && (
        <p className="memory-vault__eyebrow">
          {fact.audience === "shared"
            ? t("chat.committedMemory.shared")
            : t("chat.committedMemory.restrictedAudience", { audience: fact.audience.join(", ") })}
        </p>
      )}
      {!batch.invalidated && !fact?.invalidated && !editing && (
        <div className="flex flex-wrap gap-2">
          <button
            className={SETTINGS_BUTTON_CLASS}
            disabled={!fact && !batch.summary && !batch.core}
            onClick={() => {
              setContent(fact?.content ?? batch.summary);
              setCore(batch.core);
              setRevision(batch.revision ?? batch.createdAt);
              setEditing(true);
            }}
          >
            {t("chat.committedMemory.vault.edit")}
          </button>
          <button
            className={SETTINGS_BUTTON_CLASS}
            disabled={edit.isPending || (fact !== undefined && batch.excluded)}
            onClick={() => patch({ ...identity, excluded: !excluded })}
          >
            {t(excluded ? "chat.committedMemory.vault.restore" : "chat.committedMemory.vault.exclude")}
          </button>
          {fact?.kind === "promise" && (
            <label className="w-full text-xs">
              {t("chat.committedMemory.vault.progressLabel")}
              <select
                className={field}
                aria-label={t("chat.committedMemory.vault.progressLabel")}
                disabled={edit.isPending}
                value={fact.progress ?? (fact.status === "resolved" ? "completed" : "pending")}
                onChange={(e) =>
                  patch({ ...identity, progress: e.target.value as NonNullable<CommittedMemoryFact["progress"]> })
                }
              >
                {(["pending", "in_progress", "completed", "cancelled"] as const).map((value) => (
                  <option key={value} value={value}>
                    {t(`chat.committedMemory.vault.progress.${value}`)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {fact && (
            <select
              className={field}
              aria-label={t("chat.committedMemory.vault.status")}
              disabled={edit.isPending}
              value={fact.kind === "promise" && fact.status === "resolved" ? "current" : fact.status}
              onChange={(e) =>
                patch({
                  ...identity,
                  status:
                    fact.kind === "promise" &&
                    e.target.value === "current" &&
                    (fact.progress === "completed" || fact.progress === "cancelled")
                      ? "resolved"
                      : (e.target.value as CommittedMemoryFact["status"]),
                })
              }
            >
              {(fact.kind === "promise"
                ? (["current", "uncertain"] as const)
                : (["current", "resolved", "uncertain"] as const)
              ).map((s) => (
                <option key={s} value={s}>
                  {t(`chat.committedMemory.factStatus.${s}`)}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      {edit.error && (
        <p role="alert" className="text-[var(--destructive)]">
          {edit.error.message}
        </p>
      )}
      <section className="memory-vault__evidence">
        <h5>
          <FileText size={14} />
          {t("chat.committedMemory.sources")}
        </h5>
        {(fact?.sourceIds ?? batch.sources.map((s) => s.id)).map((id) => (
          <Source key={id} chatId={chatId} id={id} />
        ))}
      </section>
    </article>
  );
}

export function CommittedMemoryPanel({ chatId }: { chatId: string }) {
  const { t } = useTranslation();
  const status = useCommittedMemory(chatId);
  const commit = useCommitMemory(chatId);
  const toggle = useSetCommittedMemory(chatId);
  const connection = useMemoryConnection(chatId);
  const { data: chat } = useChat(chatId);
  const update = useUpdateChatMetadata({ serialize: true });
  const { data: connections } = useConnections();
  const streaming = useChatStore((s) => s.streamingChatId === chatId && s.isStreaming);
  const [tab, setTab] = useState<Tab>("overview");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [recallQuery, setRecallQuery] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [progressFilter, setProgressFilter] = useState("all");
  const preview = useMemoryPreview(chatId, search, tab === "receipt");
  const data = status.data;
  const metadata = chat?.metadata as Record<string, unknown> | undefined;
  const korean = metadata?.committedMemoryDisplayKorean !== false;
  const display = (original: string, ko?: string) => (korean && ko?.trim() ? ko : original);
  const saveSettings = (settings: Record<string, unknown>) =>
    update.mutate(
      { id: chatId, ...settings },
      {
        onSuccess: () => {
          void status.refetch();
        },
      },
    );
  const busy = commit.isPending || toggle.isPending || data?.state.job?.status === "running";
  const error = status.error || commit.error || toggle.error || update.error;
  const batches = [...(data?.state.batches ?? [])].reverse();
  const entries: Entry[] =
    tab === "story"
      ? batches.map((batch) => ({ batch }))
      : batches.flatMap((batch) =>
          batch.facts
            .filter((f) => (tab === "promise" ? f.kind === "promise" : f.kind !== "promise"))
            .map((fact) => ({ batch, fact })),
        );
  const visible = entries.filter(({ batch, fact }) => {
    const state =
      batch.invalidated || fact?.invalidated ? "invalidated" : batch.excluded || fact?.excluded ? "excluded" : "active";
    return (
      (filter === "all" || state === filter) &&
      (tab !== "promise" ||
        progressFilter === "all" ||
        (fact?.progress ?? (fact?.status === "resolved" ? "completed" : "pending")) === progressFilter) &&
      `${fact?.key ?? ""} ${fact?.keyKo ?? ""} ${fact?.contentKo ?? batch.summaryKo ?? ""} ${fact?.content ?? batch.summary} ${fact ? "" : batch.core + " " + (batch.coreKo ?? "")}`
        .normalize("NFKC")
        .toLocaleLowerCase()
        .includes(query.normalize("NFKC").toLocaleLowerCase())
    );
  });
  const current = visible.find((e) => (e.fact?.id ?? e.batch.id) === selected);
  const valid = batches.filter((b) => !b.invalidated && !b.excluded);
  const switchTab = (value: Tab) => {
    setTab(value);
    setSelected(null);
    setQuery("");
    setFilter("all");
    setProgressFilter("all");
  };
  const textConnections = (connections ?? []).filter(
    (c): c is APIConnection =>
      !!c && typeof c === "object" && "id" in c && "provider" in c && isChatProvider(c.provider),
  );
  const displaySelection = (item: import("@marinara-engine/shared").CommittedMemorySelection) => {
    if (!korean) return item.content;
    if (item.displayKo?.trim()) return item.displayKo;
    const original = item.content.replace(/^\[[^\]]+\]\s*/u, "");
    for (const batch of batches) {
      const fact = batch.facts.find((f) => f.id === item.id);
      if (fact && original === fact.content) return display(fact.content, fact.contentKo);
      if (batch.id === item.id && (original === batch.summary || original === batch.core))
        return item.reason === "recent" ? display(batch.summary, batch.summaryKo) : display(batch.core, batch.coreKo);
    }
    return item.content;
  };
  return (
    <section className={`memory-vault ${NEUTRAL_SURFACE_VARIABLES}`} data-committed-memory>
      <header className="memory-vault__header">
        <div className="flex min-w-0 items-center gap-2">
          <BookOpen size={21} className="shrink-0" />
          <div>
            <h3>{t("chat.committedMemory.vault.title")}</h3>
            <p className="memory-vault__eyebrow truncate">{chat?.name}</p>
          </div>
        </div>
        <button
          className={SETTINGS_PRIMARY_BUTTON_CLASS}
          disabled={
            busy || update.isPending || streaming || !(data?.selectedPending ?? data?.pending) || !connection.data?.ok
          }
          onClick={() => commit.mutate()}
        >
          {busy ? <Loader2 size={15} className="motion-safe:animate-spin" /> : <BookOpen size={15} />}
          {busy ? t("chat.committedMemory.processing") : t("chat.committedMemory.commit")}
        </button>
      </header>
      <div className="memory-vault__sync" role="status">
        <span>{t("chat.committedMemory.pending", { count: data?.selectedPending ?? data?.pending ?? 0 })}</span>
        <span>
          {data?.state.job
            ? t("chat.committedMemory.vault.progress", {
                state: t(`chat.committedMemory.job.${data.state.job.status}`),
                completed: data.state.job.completed,
                total: data.state.job.total,
              })
            : t("chat.committedMemory.vault.manual")}
        </span>
      </div>
      {data?.state.job?.status === "running" && (
        <progress
          className="w-full"
          aria-label={t("chat.committedMemory.processing")}
          value={data.state.job.completed}
          max={Math.max(1, data.state.job.total)}
        />
      )}
      {streaming && <p className="memory-vault__notice">{t("chat.committedMemory.waitForReply")}</p>}
      {(error || data?.state.job?.error) && (
        <p role="alert" className="memory-vault__notice text-[var(--destructive)]">
          {error?.message || data?.state.job?.error}
        </p>
      )}
      {connection.data && !connection.data.ok && (
        <div role="alert" className="memory-vault__notice">
          <p>{t("chat.committedMemory.vault.connectionMissing")}</p>
          <button className={SETTINGS_BUTTON_CLASS} onClick={() => switchTab("settings")}>
            <Settings2 size={14} />
            {t("chat.committedMemory.vault.configure")}
          </button>
        </div>
      )}
      <nav className="memory-vault__tabs" aria-label={t("chat.committedMemory.vault.navigation")}>
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            aria-current={tab === item ? "page" : undefined}
            onClick={() => switchTab(item)}
          >
            {t(`chat.committedMemory.vault.tabs.${item}`)}
          </button>
        ))}
      </nav>
      {!data && (
        <p className="memory-vault__notice">
          {status.isLoading && <Loader2 size={18} className="motion-safe:animate-spin" />}
        </p>
      )}
      {data && tab === "overview" && (
        <div className="memory-vault__body space-y-5">
          <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">{t("chat.committedMemory.help")}</p>
          <ToggleSetting
            label={t("chat.committedMemory.enabled")}
            checked={data.state.enabled}
            disabled={busy || streaming}
            onChange={(enabled) => toggle.mutate(enabled)}
          />
          <div className="memory-vault__index">
            {(["promise", "facts", "story"] as const).map((kind) => (
              <button key={kind} onClick={() => switchTab(kind)}>
                <span>{t(`chat.committedMemory.vault.tabs.${kind}`)}</span>
                <strong>
                  {kind === "story"
                    ? valid.length
                    : valid
                        .flatMap((b) => b.facts)
                        .filter(
                          (f) => !f.excluded && (kind === "promise" ? f.kind === "promise" : f.kind !== "promise"),
                        ).length}
                </strong>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
          <div>
            <h4>{t("chat.committedMemory.vault.latest")}</h4>
            {valid[0] ? (
              <button
                className="memory-vault__latest"
                onClick={() => {
                  switchTab("story");
                  setSelected(valid[0]!.id);
                }}
              >
                <span className="line-clamp-3">
                  {valid[0].summary || valid[0].core || t("chat.committedMemory.vault.privateSummary")}
                </span>
                <ChevronRight size={16} className="shrink-0" />
              </button>
            ) : (
              <p className="memory-vault__empty">{t("chat.committedMemory.empty")}</p>
            )}
          </div>
        </div>
      )}
      {data && ["promise", "facts", "story"].includes(tab) && (
        <>
          {tab === "promise" && (
            <nav className="memory-vault__tabs" aria-label={t("chat.committedMemory.vault.progressLabel")}>
              {["all", "pending", "in_progress", "completed", "cancelled"].map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-current={progressFilter === value ? "page" : undefined}
                  onClick={() => {
                    setProgressFilter(value);
                    setSelected(null);
                  }}
                >
                  {t(`chat.committedMemory.vault.progress.${value}`)}
                </button>
              ))}
            </nav>
          )}
          <div className="memory-vault__search">
            <Search size={16} />
            <input
              className="min-w-0 flex-1 bg-transparent outline-none"
              aria-label={t("chat.committedMemory.vault.search")}
              placeholder={t("chat.committedMemory.vault.search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              className="bg-[var(--background)]"
              aria-label={t("chat.committedMemory.vault.filter")}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              {["all", "active", "excluded", "invalidated"].map((f) => (
                <option key={f} value={f}>
                  {t(`chat.committedMemory.vault.filter.${f}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="memory-vault__split" data-selected={!!current}>
            <div className="memory-vault__list" aria-label={t("chat.committedMemory.records")}>
              {!visible.length && (
                <p className="memory-vault__empty">
                  {t(query ? "chat.committedMemory.vault.noResults" : "chat.committedMemory.empty")}
                </p>
              )}
              {visible.map(({ batch, fact }) => {
                const id = fact?.id ?? batch.id;
                return (
                  <button
                    key={id}
                    className="memory-vault__row"
                    aria-pressed={selected === id}
                    onClick={() => setSelected(id)}
                  >
                    <span className="memory-vault__eyebrow">
                      {fact
                        ? t(
                            fact.kind === "promise"
                              ? `chat.committedMemory.vault.progress.${fact.progress ?? (fact.status === "resolved" ? "completed" : "pending")}`
                              : `chat.committedMemory.factStatus.${fact.status}`,
                          )
                        : t("chat.committedMemory.vault.episode", { turn: batch.turn })}
                      {(batch.excluded || fact?.excluded) && ` · ${t("chat.committedMemory.vault.excluded")}`}
                      {batch.invalidated && ` · ${t("chat.committedMemory.invalidated")}`}
                    </span>
                    <strong>
                      {(fact ? display(fact.key, fact.keyKo) : "") || new Date(batch.createdAt).toLocaleDateString()}
                    </strong>
                    <span className="line-clamp-2">
                      {fact
                        ? display(fact.content, fact.contentKo)
                        : display(batch.summary, batch.summaryKo) || display(batch.core, batch.coreKo)}
                    </span>
                  </button>
                );
              })}
            </div>
            {current ? (
              <MemoryDetail
                key={current.fact?.id ?? current.batch.id}
                chatId={chatId}
                korean={korean}
                entry={current}
                onBack={() => setSelected(null)}
              />
            ) : (
              <p className="memory-vault__choose memory-vault__empty">{t("chat.committedMemory.vault.choose")}</p>
            )}
          </div>
        </>
      )}
      {data && tab === "receipt" && (
        <div className="memory-vault__body space-y-5">
          <section>
            <h4>{t("chat.committedMemory.receipt")}</h4>
            <p className="memory-vault__hint">{t("chat.committedMemory.receiptHelp")}</p>
            {!data.lastReceipt?.items.length && (
              <p className="memory-vault__empty">{t("chat.committedMemory.noReceipt")}</p>
            )}
            {data.lastReceipt?.items.map((item) => (
              <article key={item.id} className="memory-vault__receipt">
                <span className="memory-vault__eyebrow">{t(`chat.committedMemory.reason.${item.reason}`)}</span>
                <p className="memory-vault__prose">{displaySelection(item)}</p>
                {item.sourceIds.map((id) => (
                  <Source key={id} chatId={chatId} id={id} />
                ))}
              </article>
            ))}
          </section>
          <section>
            <h4>{t("chat.committedMemory.preview")}</h4>
            <p className="memory-vault__hint">{t("chat.committedMemory.previewHelp")}</p>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setSearch(recallQuery);
              }}
            >
              <input
                className={field}
                aria-label={t("chat.committedMemory.query")}
                placeholder={t("chat.committedMemory.query")}
                value={recallQuery}
                maxLength={12000}
                onChange={(e) => setRecallQuery(e.target.value)}
              />
              <button className={SETTINGS_BUTTON_CLASS}>{t("chat.committedMemory.search")}</button>
            </form>
            {preview.data && (
              <>
                <p className="memory-vault__hint">
                  {t("chat.committedMemory.budget", { used: preview.data.usedBytes, total: preview.data.budgetBytes })}
                </p>
                <progress
                  className="w-full"
                  aria-label={t("chat.committedMemory.preview")}
                  value={preview.data.usedBytes}
                  max={preview.data.budgetBytes}
                />
                {preview.data.selected.map((item) => (
                  <p key={item.id} className="memory-vault__receipt whitespace-pre-wrap">
                    {displaySelection(item)}
                  </p>
                ))}
              </>
            )}
            {preview.error && <p role="alert">{preview.error.message}</p>}
          </section>
        </div>
      )}
      {data && tab === "settings" && (
        <div className="memory-vault__body space-y-5">
          <ToggleSetting
            label={t("chat.committedMemory.enabled")}
            checked={data.state.enabled}
            disabled={busy || streaming}
            onChange={(enabled) => toggle.mutate(enabled)}
          />
          <ToggleSetting
            label={t("chat.committedMemory.vault.koreanDisplay")}
            help={t("chat.committedMemory.vault.koreanDisplayHelp")}
            checked={korean}
            disabled={update.isPending}
            onChange={(checked) => saveSettings({ committedMemoryDisplayKorean: checked })}
          />
          <label className="block text-sm">
            {t("chat.committedMemory.vault.sourceMode")}
            <select
              className={`${field} mt-2`}
              disabled={busy || update.isPending}
              value={String(metadata?.committedMemorySourceMode ?? "pending")}
              onChange={(e) =>
                saveSettings({
                  committedMemorySourceMode: e.target.value,
                  ...(e.target.value === "range"
                    ? {
                        committedMemoryRangeStart: Number(metadata?.committedMemoryRangeStart ?? 1),
                        committedMemoryRangeEnd: Number(metadata?.committedMemoryRangeEnd ?? data.totalMessages ?? 1),
                      }
                    : {}),
                })
              }
            >
              {["pending", "last", "range"].map((value) => (
                <option key={value} value={value}>
                  {t(`chat.committedMemory.vault.sourceMode.${value}`)}
                </option>
              ))}
            </select>
          </label>
          {metadata?.committedMemorySourceMode === "last" && (
            <>
              <label className="block text-sm">
                {t("chat.committedMemory.vault.contextSize")}
                <input
                  type="number"
                  className={`${field} mt-2`}
                  min={5}
                  max={500}
                  defaultValue={Number(metadata?.summaryContextSize ?? 50)}
                  key={`context:${metadata?.summaryContextSize}`}
                  disabled={busy || update.isPending}
                  onBlur={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isInteger(n) && n >= 5 && n <= 500) saveSettings({ summaryContextSize: n });
                  }}
                />
              </label>
            </>
          )}
          {metadata?.committedMemorySourceMode === "range" && (
            <div className="grid grid-cols-2 gap-3">
              {(["Start", "End"] as const).map((edge) => (
                <label key={edge} className="text-sm">
                  {t(`chat.committedMemory.vault.range${edge}`)}
                  <input
                    className={`${field} mt-2`}
                    type="number"
                    min={1}
                    max={Math.max(1, data.totalMessages ?? 1)}
                    key={`${edge}:${metadata?.[`committedMemoryRange${edge}`]}`}
                    defaultValue={Number(
                      metadata?.[`committedMemoryRange${edge}`] ?? (edge === "Start" ? 1 : (data.totalMessages ?? 1)),
                    )}
                    disabled={busy || update.isPending}
                    onBlur={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isInteger(n) && n >= 1) saveSettings({ [`committedMemoryRange${edge}`]: n });
                    }}
                  />
                </label>
              ))}
            </div>
          )}
          <p className="memory-vault__hint">{t("chat.committedMemory.vault.rangeHelp")}</p>
          {data.selectionError && (
            <p role="alert" className="text-[var(--destructive)]">
              {t("chat.committedMemory.vault.rangeInvalid")}
            </p>
          )}
          <ToggleSetting
            label={t("chat.committedMemory.vault.hideSummarised")}
            help={t("chat.committedMemory.vault.hideHelp")}
            checked={metadata?.hideSummarisedMessages === true}
            disabled={busy || update.isPending}
            onChange={(checked) => saveSettings({ hideSummarisedMessages: checked })}
          />
          <label className="block text-sm">
            {t("chat.committedMemory.vault.tail")}
            <input
              className={`${field} mt-2`}
              type="number"
              min={0}
              defaultValue={Number(metadata?.summaryTailMessages ?? 10)}
              key={`tail:${metadata?.summaryTailMessages}`}
              disabled={busy || update.isPending}
              onBlur={(e) => {
                const n = Number(e.target.value);
                if (Number.isInteger(n) && n >= 0) saveSettings({ summaryTailMessages: n });
              }}
            />
          </label>
          <ToggleSetting
            label={t("chat.committedMemory.vault.floating")}
            help={t("chat.committedMemory.vault.floatingHelp")}
            checked={metadata?.committedMemoryFloatingButton !== false}
            disabled={update.isPending}
            onChange={(checked) => update.mutate({ id: chatId, committedMemoryFloatingButton: checked })}
          />
          <label className="block text-sm">
            {t("chat.committedMemory.vault.connection")}
            <select
              className={`${field} mt-2`}
              disabled={update.isPending || busy}
              value={typeof metadata?.summaryConnectionId === "string" ? metadata.summaryConnectionId : ""}
              onChange={(e) =>
                update.mutate(
                  { id: chatId, summaryConnectionId: e.target.value || null },
                  {
                    onSuccess: () => {
                      void connection.refetch();
                    },
                  },
                )
              }
            >
              <option value="">{t("chat.committedMemory.vault.connectionDefault")}</option>
              {textConnections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.model}
                </option>
              ))}
            </select>
          </label>
          <div className="memory-vault__connection" role="status">
            {connection.isLoading ? (
              <Loader2 size={16} className="motion-safe:animate-spin" />
            ) : connection.data?.ok ? (
              <>
                <Check size={16} />
                <span>
                  {t("chat.committedMemory.vault.resolved", { model: connection.data.model })}
                  <small className="block text-[var(--muted-foreground)]">
                    {textConnections.find((c) => c.id === connection.data?.connectionId)?.name ??
                      connection.data.connectionId}
                  </small>
                </span>
              </>
            ) : (
              <span>{t("chat.committedMemory.vault.connectionMissing")}</span>
            )}
          </div>
          {connection.error && <p role="alert">{connection.error.message}</p>}
          {connection.data?.warnings.map((warning) => (
            <p key={warning} className="memory-vault__hint">
              {warning}
            </p>
          ))}
          <p className="memory-vault__hint">{t("chat.committedMemory.vault.connectionHelp")}</p>
          <label className="block text-sm">
            {t("chat.committedMemory.vault.outputTokens")}
            <input
              type="number"
              className={`${field} mt-2`}
              min={CHAT_SUMMARY_OUTPUT_TOKENS.MIN}
              max={CHAT_SUMMARY_OUTPUT_TOKENS.MAX}
              defaultValue={
                typeof metadata?.summaryMaxTokens === "number"
                  ? metadata.summaryMaxTokens
                  : CHAT_SUMMARY_OUTPUT_TOKENS.DEFAULT
              }
              key={String(metadata?.summaryMaxTokens)}
              disabled={busy || update.isPending}
              onBlur={(e) => {
                const value = Number(e.target.value);
                if (
                  Number.isInteger(value) &&
                  value >= CHAT_SUMMARY_OUTPUT_TOKENS.MIN &&
                  value <= CHAT_SUMMARY_OUTPUT_TOKENS.MAX
                )
                  update.mutate({ id: chatId, summaryMaxTokens: value });
              }}
            />
          </label>
        </div>
      )}
    </section>
  );
}
