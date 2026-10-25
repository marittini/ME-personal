import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  CornerDownRight,
  FileText,
  Loader2,
  Search,
  Settings2,
  X,
} from "lucide-react";
import {
  isChatProvider,
  threadStalled,
  CHAT_SUMMARY_OUTPUT_TOKENS,
  type APIConnection,
  type CommittedMemoryBatch,
  type CommittedMemoryFact,
  type CommittedMemoryScene,
} from "@marinara-engine/shared";
import {
  useCommittedMemory,
  useCommitMemory,
  useSetCommittedMemory,
  useMemoryPreview,
  useMemorySource,
  useMemoryConnection,
  useEditMemory,
  useMemoryMaintenance,
  useConfigureMemory,
  useExportMemory,
  memoryCommitReadiness,
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
import {
  FalseBeliefList,
  KnowledgeLine,
  MEMORY_TOKEN_BUDGET,
  MemoryEntityList,
  MemoryOverviewDetails,
  MemorySceneDetail,
  RecallControls,
  useMemoryNames,
} from "./CommittedMemoryParts";
import "../../styles/memory-vault.css";

function Source({ chatId, id, position }: { chatId: string; id: string; position: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const source = useMemorySource(chatId, id, open);
  return (
    <details className="memory-vault__source" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        {t("chat.committedMemory.source")} {position}
      </summary>
      {source.isLoading && <Loader2 className="motion-safe:animate-spin" size={16} />}
      {source.error && <p role="alert">{t("chat.committedMemory.sourceMissing")}</p>}
      {source.data && <p className="whitespace-pre-wrap break-words">{source.data.content}</p>}
      {source.data && (
        <button
          type="button"
          className={SETTINGS_BUTTON_CLASS}
          onClick={() => useChatStore.getState().requestGotoMessage(chatId, 1, undefined, id)}
        >
          <CornerDownRight size={14} />
          {t("chat.committedMemory.vault.gotoSource")}
        </button>
      )}
    </details>
  );
}
type Tab = "overview" | "scenes" | "promise" | "entities" | "story" | "receipt" | "settings";
type Entry = { batch: CommittedMemoryBatch; fact?: CommittedMemoryFact; scene?: CommittedMemoryScene };
const TABS: Tab[] = ["overview", "scenes", "promise", "entities", "story", "receipt", "settings"];
const field = "memory-vault__field";
/** Threads and promises share one tab ("약속" stays on promises). */
const isThread = (fact: CommittedMemoryFact) => fact.kind === "promise" || fact.kind === "thread";
/** A thread is open until resolved; a promise has its own progress. */
const threadProgress = (fact: CommittedMemoryFact) =>
  fact.kind === "promise"
    ? (fact.progress ?? (fact.status === "resolved" ? "completed" : "pending"))
    : fact.status === "resolved"
      ? "completed"
      : "pending";

function MemoryDetail({
  chatId,
  entry,
  onBack,
  korean,
  entityName,
  stalled = false,
}: {
  chatId: string;
  entry: Entry;
  onBack: () => void;
  korean: boolean;
  entityName?: string;
  /** An open thread or promise with no development for several batches. */
  stalled?: boolean;
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
  const name = useMemoryNames(
    fact
      ? [
          ...(fact.audience === "shared" ? [] : fact.audience),
          ...(fact.unknownTo ?? []),
          ...(fact.falseBeliefs ?? []).map((belief) => belief.who),
        ]
      : [],
  );
  return (
    <article className="memory-vault__detail">
      <button className={`${SETTINGS_BUTTON_CLASS} memory-vault__back`} onClick={onBack}>
        <ArrowLeft size={14} />
        {t("chat.committedMemory.vault.back")}
      </button>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="memory-vault__eyebrow">
          {fact ? t(`chat.committedMemory.kind.${fact.kind}`) : t("chat.committedMemory.vault.tabs.story")} ·{" "}
          {entityName && `${entityName}${fact?.attribute ? ` · ${fact.attribute}` : ""} · `}
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
      {/* What the record says comes first: thread state, its development and clues, then the actions. */}
      {stalled && (
        <p className="memory-vault__notice" data-memory-stalled="">
          {t("chat.committedMemory.vault.stalledHelp")}
        </p>
      )}
      {fact?.latest && (
        <section data-memory-latest="">
          <h5>{t("chat.committedMemory.vault.latestDevelopment")}</h5>
          <p className="memory-vault__prose">{display(fact.latest, fact.latestKo)}</p>
        </section>
      )}
      {!!fact?.clues?.length && (
        <section data-memory-clues="">
          <h5>{t("chat.committedMemory.vault.clues", { clues: fact.clues.length })}</h5>
          <ol className="memory-vault__clues">
            {fact.clues.map((clue, index) => (
              <li key={`${clue.turn}:${index}`}>
                <span>{display(clue.text, clue.textKo)}</span>
                <span className="memory-vault__eyebrow">
                  {t("chat.committedMemory.vault.episode", { turn: clue.turn })}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
      {fact?.endCondition && (
        <p className="memory-vault__hint" data-memory-end-condition="">
          {t("chat.committedMemory.vault.endCondition", {
            text: display(fact.endCondition, fact.endConditionKo),
          })}
        </p>
      )}
      {fact?.evidence && (
        <p className="memory-vault__hint" data-memory-evidence="">
          {t("chat.committedMemory.vault.evidence", { text: fact.evidence })}
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
      {fact && <KnowledgeLine fact={fact} name={name} />}
      {fact && <FalseBeliefList fact={fact} name={name} korean={korean} />}
      {fact && !batch.invalidated && !fact.invalidated && !editing && (
        <RecallControls key={batch.revision ?? batch.createdAt} chatId={chatId} fact={fact} identity={identity} />
      )}
      {!!fact?.previous?.length && (
        <details className="space-y-1" data-memory-previous="">
          <summary className="cursor-pointer text-sm">
            {t("chat.committedMemory.vault.previous", { count: fact.previous.length })}
          </summary>
          <ul className="memory-vault__list-plain">
            {fact.previous.map((old, index) => (
              <li key={`${old.id}:${index}`}>
                <span className="memory-vault__eyebrow">
                  {t("chat.committedMemory.vault.episode", { turn: old.turn })}
                </span>{" "}
                {display(old.content, old.contentKo)}
              </li>
            ))}
          </ul>
        </details>
      )}
      <details className="memory-vault__evidence">
        <summary className="cursor-pointer text-sm">{t("chat.committedMemory.vault.details")}</summary>
        <h5>
          <FileText size={14} />
          {t("chat.committedMemory.sources")}
        </h5>
        {(fact?.sourceIds ?? batch.sources.map((s) => s.id)).map((id, index) => (
          <Source key={id} chatId={chatId} id={id} position={index + 1} />
        ))}
      </details>
    </article>
  );
}

export function CommittedMemoryPanel({ chatId }: { chatId: string }) {
  const { t } = useTranslation();
  const status = useCommittedMemory(chatId);
  const { data: chat } = useChat(chatId);
  const metadata = chat?.metadata as Record<string, unknown> | undefined;
  const [batchDraft, setBatchDraft] = useState<{ chatId: string; value: string } | null>(null);
  const batchValue =
    batchDraft?.chatId === chatId
      ? batchDraft.value
      : String(metadata?.committedMemoryBatchSize ?? metadata?.summaryContextSize ?? 20);
  const batchSize = Number(batchValue);
  const validBatchSize = batchValue.trim() !== "" && Number.isInteger(batchSize) && batchSize >= 1 && batchSize <= 500;
  const commit = useCommitMemory(chatId, validBatchSize ? batchSize : undefined);
  const toggle = useSetCommittedMemory(chatId);
  const maintenance = useMemoryMaintenance(chatId);
  const configure = useConfigureMemory(chatId);
  const backup = useExportMemory(chatId);
  const connection = useMemoryConnection(chatId);
  const update = useUpdateChatMetadata({ serialize: true });
  const { data: connections } = useConnections();
  const streaming = useChatStore((s) => s.streamingChatId === chatId && s.isStreaming);
  const [tab, setTab] = useState<Tab>("overview");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [recallQuery, setRecallQuery] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("active");
  const [progressFilter, setProgressFilter] = useState("all");
  /** Entities tab: null = every fact, "" = facts without an entity, otherwise one entity. */
  const [entityFilter, setEntityFilter] = useState<string | null>(null);
  const preview = useMemoryPreview(chatId, search, tab === "receipt");
  const data = status.data;
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
  const error =
    status.error ||
    commit.error ||
    toggle.error ||
    update.error ||
    maintenance.error ||
    configure.error ||
    backup.error;
  const batches = [...(data?.state.batches ?? [])].reverse();
  /** Positions of committed batches: a thread is stalled after several of them pass without a development. */
  const batchTurns = (data?.state.batches ?? []).filter((b) => !b.invalidated).map((b) => b.turn);
  const entries: Entry[] =
    tab === "story"
      ? batches.map((batch) => ({ batch }))
      : tab === "scenes"
        ? batches.flatMap((batch) => [...(batch.scenes ?? [])].reverse().map((scene) => ({ batch, scene })))
        : batches.flatMap((batch) =>
            batch.facts
              .filter((f) => (tab === "promise" ? isThread(f) : !isThread(f)))
              .filter((f) => tab !== "entities" || entityFilter === null || (f.entityId ?? "") === entityFilter)
              .map((fact) => ({ batch, fact })),
          );
  const entities = data?.state.entities ?? [];
  const entityNames = new Map(entities.map((entity) => [entity.id, entity.name]));
  const entityFactCount = (entityId: string | null) =>
    batches.reduce(
      (sum, batch) =>
        sum +
        (batch.invalidated || batch.excluded
          ? 0
          : batch.facts.filter(
              (f) =>
                !isThread(f) &&
                !f.excluded &&
                !f.invalidated &&
                !f.archived &&
                (entityId === null || (f.entityId ?? "") === entityId),
            ).length),
      0,
    );
  const visible = entries.filter(({ batch, fact, scene }) => {
    const state =
      batch.invalidated || fact?.invalidated ? "invalidated" : batch.excluded || fact?.excluded ? "excluded" : "active";
    const text = scene
      ? [scene.when, scene.where, ...scene.participants, scene.event, scene.eventKo, ...scene.lines.map((l) => l.text)]
          .filter(Boolean)
          .join(" ")
      : `${fact?.key ?? ""} ${fact?.keyKo ?? ""} ${fact?.contentKo ?? batch.summaryKo ?? ""} ${fact?.content ?? batch.summary} ${fact ? "" : batch.core + " " + (batch.coreKo ?? "")}`;
    return (
      (filter === "all" || state === filter) &&
      (tab !== "promise" ||
        progressFilter === "all" ||
        (progressFilter === "stalled"
          ? !!fact && threadStalled(fact, batch.turn, batchTurns)
          : (fact && threadProgress(fact)) === progressFilter)) &&
      text.normalize("NFKC").toLocaleLowerCase().includes(query.normalize("NFKC").toLocaleLowerCase())
    );
  });
  const entryId = (e: Entry) => e.scene?.id ?? e.fact?.id ?? e.batch.id;
  const stalledOf = (e: Entry) => !!e.fact && threadStalled(e.fact, e.batch.turn, batchTurns);
  const current = visible.find((e) => entryId(e) === selected);
  const valid = batches.filter((b) => !b.invalidated && !b.excluded);
  /** Batches committed before format 3 have no scenes until "다시 정리". */
  const legacyBatches = valid.filter((b) => !b.scenes).length;
  const readiness = memoryCommitReadiness(data);
  const switchTab = (value: Tab) => {
    setTab(value);
    setSelected(null);
    setQuery("");
    setFilter("active");
    setProgressFilter("all");
    setEntityFilter(null);
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
            busy || update.isPending || !validBatchSize || streaming || !readiness.ready || !connection.data?.ok
          }
          data-memory-suggest={readiness.ready > 0 && !busy ? "" : undefined}
          onClick={() => commit.mutate()}
        >
          {busy ? <Loader2 size={15} className="motion-safe:animate-spin" /> : <BookOpen size={15} />}
          {busy ? t("chat.committedMemory.processing") : t("chat.committedMemory.commit")}
        </button>
      </header>
      <div className="memory-vault__sync" role="status">
        <span data-memory-pending="">
          {readiness.partial && readiness.size
            ? t("chat.committedMemory.pendingPartial", { waiting: readiness.pending, size: readiness.size })
            : readiness.ready && readiness.ready < readiness.pending
              ? t("chat.committedMemory.pendingReady", { waiting: readiness.pending, ready: readiness.ready })
              : t("chat.committedMemory.pending", { count: readiness.pending })}
        </span>
        <span>
          {data?.state.job?.kind === "recommit" && data.state.job.status === "running"
            ? t("chat.committedMemory.vault.recommitProgress", {
                completed: data.state.job.completed,
                total: data.state.job.total,
              })
            : data?.state.job
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
      {data?.state.job?.status === "running" && (
        <button
          className={SETTINGS_BUTTON_CLASS}
          disabled={maintenance.isPending}
          onClick={() => maintenance.mutate("cancel")}
        >
          {t("chat.committedMemory.vault.stopJob")}
        </button>
      )}
      {readiness.partial && readiness.size && (
        <p className="memory-vault__hint" data-memory-partial="">
          {t("chat.committedMemory.pendingPartialHelp", { size: readiness.size })}
        </p>
      )}
      {streaming && <p className="memory-vault__notice">{t("chat.committedMemory.waitForReply")}</p>}
      {(error || data?.state.job?.error) && (
        <p role="alert" className="memory-vault__notice text-[var(--destructive)]">
          {data?.state.job?.error === "MEMORY_OUTPUT_INVALID" && !error
            ? t("chat.committedMemory.outputInvalid")
            : error?.message || data?.state.job?.error}
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
          {data.state.enabled && <p className="memory-vault__hint">{t("chat.committedMemory.vault.replacesOthers")}</p>}
          <ToggleSetting
            label={t("chat.committedMemory.enabled")}
            checked={data.state.enabled}
            disabled={busy || streaming}
            onChange={(enabled) => toggle.mutate(enabled)}
          />
          <div className="memory-vault__index">
            {(["scenes", "promise", "entities", "story"] as const).map((kind) => (
              <button key={kind} onClick={() => switchTab(kind)}>
                <span>{t(`chat.committedMemory.vault.tabs.${kind}`)}</span>
                <strong>
                  {kind === "story"
                    ? valid.length
                    : kind === "scenes"
                      ? valid.reduce((sum, b) => sum + (b.scenes?.length ?? 0), 0)
                      : valid
                          .flatMap((b) => b.facts)
                          .filter((f) => !f.excluded && (kind === "promise" ? isThread(f) : !isThread(f))).length}
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
                  {display(valid[0].summary, valid[0].summaryKo) ||
                    display(valid[0].core, valid[0].coreKo) ||
                    t("chat.committedMemory.vault.privateSummary")}
                </span>
                <ChevronRight size={16} className="shrink-0" />
              </button>
            ) : (
              <p className="memory-vault__empty">{t("chat.committedMemory.empty")}</p>
            )}
          </div>
          {legacyBatches > 0 && (
            <div className="memory-vault__notice space-y-2" data-memory-legacy="">
              <p>{t("chat.committedMemory.vault.legacyFormat", { batches: legacyBatches })}</p>
              <button
                className={SETTINGS_BUTTON_CLASS}
                disabled={busy || streaming || maintenance.isPending || !connection.data?.ok}
                onClick={() => {
                  if (window.confirm(t("chat.committedMemory.vault.recommitConfirm", { batches: valid.length })))
                    maintenance.mutate("recommit");
                }}
              >
                {t("chat.committedMemory.vault.recommit")}
              </button>
            </div>
          )}
          <MemoryOverviewDetails
            chatId={chatId}
            data={data}
            busy={busy || streaming}
            onOpenEntities={() => switchTab("entities")}
          />
        </div>
      )}
      {data && ["scenes", "promise", "entities", "story"].includes(tab) && (
        <>
          {tab === "entities" && (
            <MemoryEntityList
              chatId={chatId}
              entities={entities}
              factCount={entityFactCount}
              selected={entityFilter}
              busy={busy || streaming}
              onSelect={(id) => {
                setEntityFilter(id);
                setSelected(null);
              }}
            />
          )}
          {tab === "promise" && (
            <nav className="memory-vault__tabs" aria-label={t("chat.committedMemory.vault.progressLabel")}>
              {["all", "pending", "in_progress", "stalled", "completed", "cancelled"].map((value) => (
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
              {visible.map((entry) => {
                const { batch, fact, scene } = entry;
                const id = entryId(entry);
                if (scene)
                  return (
                    <button
                      key={id}
                      className="memory-vault__row"
                      aria-pressed={selected === id}
                      data-memory-scene=""
                      onClick={() => setSelected(id)}
                    >
                      <span className="memory-vault__eyebrow">
                        {[t("chat.committedMemory.vault.episode", { turn: batch.turn }), scene.when, scene.where]
                          .filter(Boolean)
                          .join(" · ")}
                        {!!scene.lines.length &&
                          ` · ${t("chat.committedMemory.vault.sceneLineCount", { lines: scene.lines.length })}`}
                      </span>
                      <strong>{scene.participants.join(", ") || t("chat.committedMemory.vault.tabs.scenes")}</strong>
                      <span className="line-clamp-2">{display(scene.event, scene.eventKo)}</span>
                    </button>
                  );
                return (
                  <button
                    key={id}
                    className="memory-vault__row"
                    aria-pressed={selected === id}
                    onClick={() => setSelected(id)}
                  >
                    <span className="memory-vault__eyebrow">
                      {fact
                        ? fact.kind === "thread"
                          ? t(`chat.committedMemory.vault.threadStatus.${stalledOf(entry) ? "stalled" : fact.status}`)
                          : t(
                              fact.kind === "promise"
                                ? `chat.committedMemory.vault.progress.${threadProgress(fact)}`
                                : `chat.committedMemory.factStatus.${fact.status}`,
                            )
                        : t("chat.committedMemory.vault.episode", { turn: batch.turn })}
                      {fact?.kind === "promise" &&
                        stalledOf(entry) &&
                        ` · ${t("chat.committedMemory.vault.progress.stalled")}`}
                      {!!fact?.clues?.length &&
                        ` · ${t("chat.committedMemory.vault.clueCount", { clues: fact.clues.length })}`}
                      {!!fact?.falseBeliefs?.length &&
                        ` · ${t("chat.committedMemory.vault.beliefCount", { beliefs: fact.falseBeliefs.length })}`}
                      {fact?.kind === "state" && ` · ${t("chat.committedMemory.kind.state")}`}
                      {fact?.entityId && entityNames.has(fact.entityId) && ` · ${entityNames.get(fact.entityId)}`}
                      {fact?.activation === "always" &&
                        !isThread(fact) &&
                        ` · ${t("chat.committedMemory.vault.activation.always")}`}
                      {fact?.archived && ` · ${t("chat.committedMemory.vault.archived")}`}
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
            {current?.scene ? (
              <article className="memory-vault__detail" key={current.scene.id} data-memory-scene-detail="">
                <button className={`${SETTINGS_BUTTON_CLASS} memory-vault__back`} onClick={() => setSelected(null)}>
                  <ArrowLeft size={14} />
                  {t("chat.committedMemory.vault.back")}
                </button>
                <MemorySceneDetail
                  batch={current.batch}
                  scene={current.scene}
                  korean={korean}
                  sources={
                    <details className="memory-vault__evidence">
                      <summary className="cursor-pointer text-sm">{t("chat.committedMemory.vault.details")}</summary>
                      <h5>
                        <FileText size={14} />
                        {t("chat.committedMemory.sources")}
                      </h5>
                      {current.scene.sourceIds.map((id, index) => (
                        <Source key={id} chatId={chatId} id={id} position={index + 1} />
                      ))}
                    </details>
                  }
                />
              </article>
            ) : current ? (
              <MemoryDetail
                key={current.fact?.id ?? current.batch.id}
                chatId={chatId}
                korean={korean}
                entry={current}
                entityName={current.fact?.entityId ? entityNames.get(current.fact.entityId) : undefined}
                stalled={stalledOf(current)}
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
                <span className="memory-vault__eyebrow">
                  {item.tier === "state" || item.tier === "thread" || item.tier === "scene"
                    ? t(`chat.committedMemory.vault.tier.${item.tier}`)
                    : t(`chat.committedMemory.reason.${item.reason}`)}
                </span>
                <p className="memory-vault__prose">{displaySelection(item)}</p>
                <details>
                  <summary className="cursor-pointer text-sm">{t("chat.committedMemory.vault.details")}</summary>
                  {item.sourceIds.map((id, index) => (
                    <Source key={id} chatId={chatId} id={id} position={index + 1} />
                  ))}
                </details>
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
                  {preview.data.budgetTokens
                    ? t("chat.committedMemory.vault.tokenUsage", {
                        used: preview.data.usedTokens,
                        total: preview.data.budgetTokens,
                      })
                    : t("chat.committedMemory.budget", {
                        used: preview.data.usedBytes,
                        total: preview.data.budgetBytes,
                      })}
                </p>
                <progress
                  className="w-full"
                  aria-label={t("chat.committedMemory.preview")}
                  value={preview.data.budgetTokens ? preview.data.usedTokens : preview.data.usedBytes}
                  max={preview.data.budgetTokens ?? preview.data.budgetBytes}
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
          {data.state.enabled && (
            <p className="memory-vault__notice" role="note" data-memory-replaces="">
              {t("chat.committedMemory.vault.replacesOthers")}
            </p>
          )}
          <label className="block text-sm">
            {t("chat.committedMemory.vault.batchSize")}
            <input
              type="number"
              className={`${field} mt-2`}
              min={1}
              max={500}
              step={1}
              value={batchValue}
              disabled={busy || update.isPending}
              onChange={(e) => setBatchDraft({ chatId, value: e.target.value })}
              onBlur={() => {
                if (validBatchSize && batchSize !== metadata?.committedMemoryBatchSize)
                  saveSettings({ committedMemoryBatchSize: batchSize });
              }}
            />
            <p className="memory-vault__hint">{t("chat.committedMemory.vault.batchSizeHelp")}</p>
            {!validBatchSize && <p role="alert">{t("chat.committedMemory.vault.batchSizeInvalid")}</p>}
          </label>
          <ToggleSetting
            label={t("chat.committedMemory.vault.koreanDisplay")}
            help={t("chat.committedMemory.vault.koreanDisplayHelp")}
            checked={korean}
            disabled={update.isPending}
            onChange={(checked) => saveSettings({ committedMemoryDisplayKorean: checked })}
          />
          <section className="space-y-3">
            <h4>{t("chat.committedMemory.vault.recallSettings")}</h4>
            <p className="memory-vault__hint">{t("chat.committedMemory.vault.recallHelp")}</p>
            <ToggleSetting
              label={t("chat.committedMemory.vault.semantic")}
              checked={data.state.recall?.semanticEnabled !== false}
              disabled={configure.isPending}
              onChange={(semanticEnabled) => configure.mutate({ semanticEnabled })}
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(
                [
                  ["tokenBudget", 256, 32000, MEMORY_TOKEN_BUDGET],
                  ["alwaysTokens", 0, 32000, 600],
                  ["recallLimit", 0, 100, 12],
                  ["recentMessages", 0, 1000, 30],
                  ["longTermMessages", 0, 10000, 300],
                  ["topK", 1, 100, 20],
                ] as const
              ).map(([key, min, max, fallback]) => (
                <label key={key} className="block text-sm">
                  {t(`chat.committedMemory.vault.${key}`)}
                  <input
                    type="number"
                    className={`${field} mt-2`}
                    min={min}
                    max={max}
                    key={`${key}:${data.state.recall?.[key]}`}
                    defaultValue={data.state.recall?.[key] ?? fallback}
                    disabled={configure.isPending}
                    onBlur={(e) => {
                      const n = Number(e.target.value);
                      if (
                        e.target.value.trim() &&
                        Number.isInteger(n) &&
                        n >= min &&
                        n <= max &&
                        n !== data.state.recall?.[key]
                      )
                        configure.mutate({ [key]: n });
                    }}
                  />
                </label>
              ))}
            </div>
          </section>
          <details className="space-y-3">
            <summary className="cursor-pointer text-sm">{t("chat.committedMemory.vault.maintenance")}</summary>
            <p className="memory-vault__hint">{t("chat.committedMemory.vault.maintenanceHelp")}</p>
            <p className="memory-vault__hint">{t("chat.committedMemory.vault.recommitHelp")}</p>
            <div className="flex flex-wrap gap-2">
              <button className={SETTINGS_BUTTON_CLASS} disabled={backup.isPending} onClick={() => backup.mutate()}>
                {t("chat.committedMemory.vault.export")}
              </button>
              <button
                className={SETTINGS_BUTTON_CLASS}
                disabled={busy || maintenance.isPending || !connection.data?.ok}
                onClick={() => maintenance.mutate("enrich")}
              >
                {t("chat.committedMemory.vault.enrich")}
              </button>
              <button
                className={SETTINGS_BUTTON_CLASS}
                disabled={busy || maintenance.isPending}
                onClick={() => maintenance.mutate("rebuild")}
              >
                {t("chat.committedMemory.vault.rebuild")}
              </button>
              <button
                className={SETTINGS_BUTTON_CLASS}
                data-memory-recommit=""
                disabled={busy || streaming || maintenance.isPending || !valid.length || !connection.data?.ok}
                onClick={() => {
                  if (window.confirm(t("chat.committedMemory.vault.recommitConfirm", { batches: valid.length })))
                    maintenance.mutate("recommit");
                }}
              >
                {t("chat.committedMemory.vault.recommit")}
              </button>
              <button
                className={`${SETTINGS_BUTTON_CLASS} text-[var(--destructive)]`}
                disabled={streaming || maintenance.isPending}
                onClick={() => {
                  if (
                    window.confirm(t("chat.committedMemory.vault.resetConfirm", { count: data.state.batches.length }))
                  ) {
                    setSelected(null);
                    maintenance.mutate("reset");
                  }
                }}
              >
                {t("chat.committedMemory.vault.reset")}
              </button>
            </div>
          </details>
          <details className="space-y-5">
            <summary className="cursor-pointer text-sm">{t("chat.committedMemory.vault.advanced")}</summary>
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
          </details>
        </div>
      )}
    </section>
  );
}
