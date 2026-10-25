import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight, Combine, Undo2, UserRoundX } from "lucide-react";
import type {
  CommittedMemoryBatch,
  CommittedMemoryEntity,
  CommittedMemoryFact,
  CommittedMemoryScene,
  CommittedMemorySelection,
  CommittedMemoryStatus,
} from "@marinara-engine/shared";
import { useEditMemory, useMemoryHistoryAction, useMemoryPreview } from "../../hooks/use-committed-memory";
import { useCharacterSummaries } from "../../hooks/use-characters";
import { SETTINGS_BUTTON_CLASS } from "../panels/settings/SettingControls";

const TIERS = ["always", "state", "recall", "thread", "boundary", "scene", "flow"] as const;
/** Server default (committed-memory-policy COMMITTED_MEMORY_DEFAULTS). */
export const MEMORY_TOKEN_BUDGET = 2400;

/** Character names for knowledge lines; an ID without a character stays as the ID. */
export function useMemoryNames(ids: string[]) {
  const { data } = useCharacterSummaries(ids);
  const names = new Map((data ?? []).map((c) => [c.id, c.name]));
  return (id: string) => names.get(id) ?? id;
}

/** Who knows a fact and who explicitly does not. */
export function KnowledgeLine({ fact, name }: { fact: CommittedMemoryFact; name: (id: string) => string }) {
  const { t } = useTranslation();
  return (
    <p className="memory-vault__eyebrow" data-memory-knowledge="">
      {fact.audience === "shared"
        ? t("chat.committedMemory.vault.knownByAll")
        : fact.audience.length
          ? t("chat.committedMemory.vault.knownBy", { names: fact.audience.map(name).join(", ") })
          : t("chat.committedMemory.vault.knownByNarrator")}
      {!!fact.unknownTo?.length &&
        ` · ${t("chat.committedMemory.vault.unknownTo", { names: fact.unknownTo.map(name).join(", ") })}`}
    </p>
  );
}

/** One recorded scene: when and where, who was there, what happened, its exact lines and what changed. */
export function MemorySceneDetail({
  batch,
  scene,
  korean,
  sources,
}: {
  batch: CommittedMemoryBatch;
  scene: CommittedMemoryScene;
  korean: boolean;
  sources: ReactNode;
}) {
  const { t } = useTranslation();
  const name = useMemoryNames(scene.audience === "shared" ? [] : scene.audience);
  const changes = korean && scene.changesKo?.length === scene.changes.length ? scene.changesKo : scene.changes;
  return (
    <>
      <span className="memory-vault__eyebrow">
        {[t("chat.committedMemory.vault.episode", { turn: batch.turn }), scene.when, scene.where]
          .filter(Boolean)
          .join(" · ")}
      </span>
      {!!scene.participants.length && (
        <p className="memory-vault__hint">
          {t("chat.committedMemory.vault.scenePresent", { names: scene.participants.join(", ") })}
        </p>
      )}
      <p className="memory-vault__prose">{korean && scene.eventKo?.trim() ? scene.eventKo : scene.event}</p>
      {!!scene.lines.length && (
        <section className="space-y-2" data-memory-lines="">
          <h5>{t("chat.committedMemory.vault.sceneLines")}</h5>
          {scene.lines.map((line, index) => (
            <blockquote key={`${line.sourceId}:${index}`} className="memory-vault__quote">
              <span className="memory-vault__eyebrow">
                {line.to
                  ? t("chat.committedMemory.vault.lineTo", { speaker: line.speaker, to: line.to })
                  : line.speaker}
              </span>
              <p>{t("chat.committedMemory.vault.quote", { text: line.text })}</p>
              {korean && line.textKo?.trim() && <p className="memory-vault__hint">{line.textKo}</p>}
            </blockquote>
          ))}
        </section>
      )}
      {!!changes.length && (
        <section>
          <h5>{t("chat.committedMemory.vault.sceneChanges")}</h5>
          <ul className="memory-vault__list-plain">
            {changes.map((change, index) => (
              <li key={index}>{change}</li>
            ))}
          </ul>
        </section>
      )}
      <p className="memory-vault__eyebrow" data-memory-knowledge="">
        {scene.audience === "shared"
          ? t("chat.committedMemory.vault.knownByAll")
          : scene.audience.length
            ? t("chat.committedMemory.vault.knownBy", { names: scene.audience.map(name).join(", ") })
            : t("chat.committedMemory.vault.knownByNarrator")}
      </p>
      {sources}
    </>
  );
}

/** "Always" / "when called up" and the words that call a fact up. */
export function RecallControls({
  chatId,
  fact,
  identity,
}: {
  chatId: string;
  fact: CommittedMemoryFact;
  identity: { batchId: string; factId?: string; expectedRevision: string };
}) {
  const { t } = useTranslation();
  const edit = useEditMemory(chatId);
  const activation = fact.activation ?? (fact.kind === "promise" ? "always" : "recall");
  const [keywords, setKeywords] = useState((fact.keywords ?? []).join(", "));
  const [combos, setCombos] = useState((fact.combos ?? []).map((combo) => combo.join(" + ")).join("\n"));
  const split = (value: string, by: RegExp) =>
    value
      .split(by)
      .map((word) => word.trim())
      .filter(Boolean);
  const nextKeywords = split(keywords, /[,\n]/u).slice(0, 24);
  const nextCombos = split(combos, /\n/u)
    .map((line) => split(line, /[+,]/u).slice(0, 6))
    .filter((combo) => combo.length)
    .slice(0, 12);
  const changed =
    JSON.stringify(nextKeywords) !== JSON.stringify(fact.keywords ?? []) ||
    JSON.stringify(nextCombos) !== JSON.stringify(fact.combos ?? []);
  return (
    <section className="memory-vault__recall space-y-2" data-memory-recall="">
      <div
        role="radiogroup"
        aria-label={t("chat.committedMemory.vault.activation")}
        className="memory-vault__segmented"
      >
        {(["always", "recall"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={activation === value}
            disabled={edit.isPending}
            onClick={() => activation !== value && edit.mutate({ ...identity, activation: value })}
          >
            {t(`chat.committedMemory.vault.activation.${value}`)}
          </button>
        ))}
      </div>
      <p className="memory-vault__hint">{t(`chat.committedMemory.vault.activationHelp.${activation}`)}</p>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          edit.mutate({ ...identity, keywords: nextKeywords, combos: nextCombos });
        }}
      >
        <label className="block text-xs">
          {t("chat.committedMemory.vault.keywords")}
          <input
            className="memory-vault__field"
            value={keywords}
            maxLength={2400}
            placeholder={t("chat.committedMemory.vault.keywordsPlaceholder")}
            onChange={(e) => setKeywords(e.target.value)}
          />
        </label>
        <label className="block text-xs">
          {t("chat.committedMemory.vault.combos")}
          <textarea
            className="memory-vault__field"
            rows={2}
            value={combos}
            maxLength={2400}
            placeholder={t("chat.committedMemory.vault.combosPlaceholder")}
            onChange={(e) => setCombos(e.target.value)}
          />
        </label>
        <button className={SETTINGS_BUTTON_CLASS} disabled={!changed || edit.isPending}>
          <Check size={14} />
          {t("chat.committedMemory.vault.saveRecall")}
        </button>
      </form>
      {edit.error && (
        <p role="alert" className="text-[var(--destructive)]">
          {edit.error.message}
        </p>
      )}
    </section>
  );
}

/** The overview: what went in this turn, what waits, how much is kept, and the change history with undo. */
export function MemoryOverviewDetails({
  chatId,
  data,
  busy,
  onOpenEntities,
}: {
  chatId: string;
  data: CommittedMemoryStatus;
  busy: boolean;
  onOpenEntities: () => void;
}) {
  const { t } = useTranslation();
  const history = useMemoryHistoryAction(chatId);
  const preview = useMemoryPreview(chatId, "", true);
  const items: CommittedMemorySelection[] = data.lastReceipt?.items ?? [];
  const tierOf = (item: CommittedMemorySelection) => item.tier ?? (item.reason === "current" ? "always" : "flow");
  const tokens = Object.fromEntries(
    TIERS.map((tier) => [
      tier,
      items.filter((item) => tierOf(item) === tier).reduce((sum, item) => sum + (item.tokens ?? 0), 0),
    ]),
  ) as Record<(typeof TIERS)[number], number>;
  const total = TIERS.reduce((sum, tier) => sum + tokens[tier], 0);
  const budget = data.state.recall?.tokenBudget ?? MEMORY_TOKEN_BUDGET;
  const facts = new Map(data.state.batches.flatMap((batch) => batch.facts.map((fact) => [fact.id, fact] as const)));
  const waiting = (preview.data?.waiting ?? []).flatMap((id) => (facts.has(id) ? [facts.get(id)!] : []));
  const counts = data.counts;
  const commits = [...(data.state.commits ?? [])].reverse().slice(0, 5);
  const undoError =
    history.error && "status" in history.error && history.error.status === 409
      ? t("chat.committedMemory.vault.undoBlocked")
      : history.error?.message;
  return (
    <div className="space-y-5" data-memory-overview="">
      {data.unreadable && (
        <p role="alert" className="memory-vault__notice text-[var(--destructive)]">
          {t("chat.committedMemory.vault.unreadable")}
        </p>
      )}
      {!!data.quarantined && (
        <p role="status" className="memory-vault__notice">
          {t("chat.committedMemory.vault.quarantined", { count: data.quarantined })}
        </p>
      )}
      <section aria-label={t("chat.committedMemory.vault.turnTokens")}>
        <h4>{t("chat.committedMemory.vault.turnTokens")}</h4>
        <p className="memory-vault__hint" data-memory-turn-tokens="">
          {items.length
            ? t("chat.committedMemory.vault.turnTokensValue", { total, budget })
            : t("chat.committedMemory.noReceipt")}
        </p>
        <div className="memory-vault__bar" aria-hidden="true">
          {TIERS.map((tier) =>
            tokens[tier] ? (
              <span
                key={tier}
                data-tier={tier}
                style={{ width: `${Math.min(100, (tokens[tier] / Math.max(budget, total)) * 100)}%` }}
              />
            ) : null,
          )}
        </div>
        <dl className="memory-vault__table">
          {TIERS.map((tier) => (
            <div key={tier} data-tier={tier}>
              <dt>{t(`chat.committedMemory.vault.tier.${tier}`)}</dt>
              <dd>{tokens[tier]}</dd>
            </div>
          ))}
        </dl>
      </section>
      {waiting.length > 0 && (
        <section data-memory-waiting="">
          <h4>{t("chat.committedMemory.vault.waiting", { count: waiting.length })}</h4>
          <p className="memory-vault__hint">{t("chat.committedMemory.vault.waitingHelp")}</p>
          <ul className="memory-vault__list-plain">
            {waiting.map((fact) => (
              <li key={fact.id}>{fact.keyKo || fact.key}</li>
            ))}
          </ul>
        </section>
      )}
      {counts && (
        <section>
          <h4>{t("chat.committedMemory.vault.kept")}</h4>
          <dl className="memory-vault__table" data-memory-counts="">
            {(["entities", "currentFacts", "historyFacts", "homonyms", "duplicateSuspects"] as const).map((key) => (
              <div key={key}>
                <dt>{t(`chat.committedMemory.vault.count.${key}`)}</dt>
                <dd>{counts[key]}</dd>
              </div>
            ))}
          </dl>
          {counts.homonyms > 0 && (
            <button className={`${SETTINGS_BUTTON_CLASS} mt-2`} onClick={onOpenEntities}>
              {t("chat.committedMemory.vault.reviewHomonyms")}
              <ChevronRight size={14} />
            </button>
          )}
        </section>
      )}
      <section className="space-y-2">
        <h4>{t("chat.committedMemory.vault.organize")}</h4>
        <p className="memory-vault__hint">{t("chat.committedMemory.vault.organizeHelp")}</p>
        <button
          className={SETTINGS_BUTTON_CLASS}
          disabled={busy || history.isPending || !data.state.batches.length}
          onClick={() => history.mutate({ kind: "organize" })}
        >
          <Combine size={14} />
          {t("chat.committedMemory.vault.organize")}
        </button>
      </section>
      <section data-memory-history="">
        <h4>{t("chat.committedMemory.vault.history")}</h4>
        {!commits.length && <p className="memory-vault__empty">{t("chat.committedMemory.vault.historyEmpty")}</p>}
        <ul className="memory-vault__history">
          {commits.map((commit) => (
            <li key={commit.id}>
              <span>
                <strong>{t(`chat.committedMemory.vault.change.${commit.kind}`)}</strong>
                <span className="memory-vault__eyebrow block">
                  {new Date(commit.at).toLocaleString()} ·{" "}
                  {t("chat.committedMemory.vault.changeSummary", {
                    facts: commit.summary.facts,
                    entities: commit.summary.entities,
                  })}
                </span>
              </span>
              <button
                className={SETTINGS_BUTTON_CLASS}
                disabled={busy || history.isPending}
                onClick={() => history.mutate({ kind: "undo", commitId: commit.id })}
              >
                <Undo2 size={14} />
                {t("chat.committedMemory.vault.undo")}
              </button>
            </li>
          ))}
        </ul>
        {undoError && (
          <p role="alert" className="text-[var(--destructive)]">
            {undoError}
          </p>
        )}
      </section>
    </div>
  );
}

/** Entity list for the entities tab, with namesake review (merge into the other one, or keep apart). */
export function MemoryEntityList({
  chatId,
  entities,
  factCount,
  selected,
  onSelect,
  busy,
}: {
  chatId: string;
  entities: CommittedMemoryEntity[];
  factCount: (entityId: string | null) => number;
  selected: string | null;
  onSelect: (entityId: string | null) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const history = useMemoryHistoryAction(chatId);
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const unsorted = factCount("");
  return (
    <div className="memory-vault__entities" data-memory-entities="">
      <button type="button" aria-pressed={selected === null} onClick={() => onSelect(null)}>
        <span>{t("chat.committedMemory.vault.allEntities")}</span>
        <strong>{factCount(null)}</strong>
      </button>
      {entities.map((entity) => (
        <div key={entity.id} className="memory-vault__entity" data-homonym={!!entity.homonymOf?.length || undefined}>
          <button type="button" aria-pressed={selected === entity.id} onClick={() => onSelect(entity.id)}>
            <span className="min-w-0">
              <span className="block truncate font-semibold">{entity.name}</span>
              <span className="memory-vault__eyebrow block truncate">
                {t(`chat.committedMemory.vault.entityKind.${entity.kind}`)}
                {entity.aliases.length > 0 && ` · ${entity.aliases.join(", ")}`}
              </span>
            </span>
            <strong>{factCount(entity.id)}</strong>
          </button>
          {!!entity.homonymOf?.length && (
            <div className="memory-vault__homonym" role="group" aria-label={t("chat.committedMemory.vault.homonym")}>
              <span className="memory-vault__eyebrow">{t("chat.committedMemory.vault.homonym")}</span>
              {entity.homonymOf.map((otherId) =>
                byId.has(otherId) ? (
                  <button
                    key={otherId}
                    className={SETTINGS_BUTTON_CLASS}
                    disabled={busy || history.isPending}
                    onClick={() => history.mutate({ kind: "merge", fromId: entity.id, intoId: otherId })}
                  >
                    <Combine size={14} />
                    {t("chat.committedMemory.vault.mergeInto", { name: describe(byId.get(otherId)!, t) })}
                  </button>
                ) : null,
              )}
              <button
                className={SETTINGS_BUTTON_CLASS}
                disabled={busy || history.isPending}
                onClick={() => history.mutate({ kind: "distinct", entityId: entity.id })}
              >
                <UserRoundX size={14} />
                {t("chat.committedMemory.vault.keepApart")}
              </button>
            </div>
          )}
        </div>
      ))}
      {unsorted > 0 && (
        <button type="button" aria-pressed={selected === ""} onClick={() => onSelect("")}>
          <span>{t("chat.committedMemory.vault.unsorted")}</span>
          <strong>{unsorted}</strong>
        </button>
      )}
      {history.error && (
        <p role="alert" className="text-[var(--destructive)]">
          {history.error.message}
        </p>
      )}
    </div>
  );
}

function describe(entity: CommittedMemoryEntity, t: (key: string) => string) {
  return `${entity.name} (${t(`chat.committedMemory.vault.entityKind.${entity.kind}`)} · ${new Date(entity.createdAt).toLocaleDateString()})`;
}
