import { estimateTextTokens } from "@marinara-engine/shared";
import { createHash } from "node:crypto";
import type {
  CommittedMemoryBatch,
  CommittedMemoryState,
  CommittedMemorySelection,
  CommittedMemoryFact,
  CommittedMemoryEntity,
  CommittedMemoryScene,
} from "@marinara-engine/shared";
export interface MemorySourceMessage {
  id: string;
  content: string;
  role: string;
  activeSwipeIndex?: number;
  memoryRevision?: string | null;
  characterId?: string | null;
  extra?: unknown;
}
export function memoryExtra(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return memoryExtra(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
export function memoryFingerprint(m: MemorySourceMessage): string {
  const extra = memoryExtra(m.extra);
  return createHash("sha256")
    .update(
      JSON.stringify([
        m.content,
        m.role,
        m.activeSwipeIndex ?? 0,
        m.memoryRevision ?? null,
        m.characterId ?? null,
        extra.hiddenFromAI === true,
        extra.hiddenFromAICharacterIds ?? [],
        extra.roleplayCommandActivity ?? [],
      ]),
    )
    .digest("hex");
}
export function emptyCommittedMemory(chatId: string): CommittedMemoryState {
  return { version: 1, ownerChatId: chatId, enabled: false, batches: [] };
}
const MEMORY_VERSIONS = new Set([1, 2, 3]);
function validFact(f: unknown) {
  const fact = f as CommittedMemoryFact | null;
  return (
    !!fact &&
    typeof fact.id === "string" &&
    typeof fact.content === "string" &&
    typeof fact.key === "string" &&
    Array.isArray(fact.sourceIds) &&
    (fact.audience === "shared" || Array.isArray(fact.audience))
  );
}
function validBatch(b: unknown) {
  const batch = b as CommittedMemoryBatch | null;
  return (
    !!batch &&
    typeof batch.id === "string" &&
    Number.isFinite(batch.turn) &&
    typeof batch.summary === "string" &&
    typeof batch.core === "string" &&
    Array.isArray(batch.sources) &&
    batch.sources.length > 0 &&
    batch.sources.every((r) => r && typeof r.id === "string" && typeof r.fingerprint === "string") &&
    Array.isArray(batch.facts) &&
    batch.facts.every(validFact)
  );
}
function validScene(s: unknown) {
  const scene = s as CommittedMemoryScene | null;
  return (
    !!scene &&
    typeof scene.id === "string" &&
    typeof scene.event === "string" &&
    Array.isArray(scene.sourceIds) &&
    (scene.audience === "shared" || Array.isArray(scene.audience))
  );
}
const stringList = (value: unknown, limit: number) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").slice(0, limit) : [];
function validEntity(e: unknown) {
  const entity = e as CommittedMemoryEntity | null;
  return (
    !!entity &&
    typeof entity.id === "string" &&
    typeof entity.name === "string" &&
    Array.isArray(entity.aliases) &&
    entity.aliases.every((alias) => typeof alias === "string")
  );
}
/**
 * "absent" or "foreign" (a branch still holding its parent's copy) read as an empty memory; "unreadable" is a
 * memory of this chat in a shape this version cannot read. Writers refuse it, so nothing overwrites it.
 */
export function committedMemoryReadability(
  metadata: Record<string, unknown>,
  chatId: string,
): "absent" | "foreign" | "readable" | "unreadable" {
  const raw = metadata.committedMemory as Record<string, unknown> | undefined | null;
  if (raw === undefined || raw === null) return "absent";
  if (typeof raw !== "object" || Array.isArray(raw)) return "unreadable";
  if (raw.ownerChatId !== chatId) return "foreign";
  return MEMORY_VERSIONS.has(raw.version as number) && typeof raw.enabled === "boolean" && Array.isArray(raw.batches)
    ? "readable"
    : "unreadable";
}
export function readCommittedMemory(metadata: Record<string, unknown>, chatId: string): CommittedMemoryState {
  if (committedMemoryReadability(metadata, chatId) !== "readable") return emptyCommittedMemory(chatId);
  const s = metadata.committedMemory as CommittedMemoryState;
  // One malformed batch no longer empties the whole memory: it is set aside untouched (and written back as it
  // was), and every readable batch keeps working.
  const quarantine = [
    ...(Array.isArray(s.quarantine) ? s.quarantine : []),
    ...s.batches.filter((b) => !validBatch(b)),
    ...(Array.isArray(s.entities) ? s.entities.filter((e) => !validEntity(e)).map((entity) => ({ entity })) : []),
  ];
  // Ignore malformed optional derived data without discarding compatible canonical memories.
  const keywords = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((word): word is string => typeof word === "string" && word.length <= 100).slice(0, 24)
      : undefined;
  const combos = (value: unknown) =>
    Array.isArray(value)
      ? value
          .filter((combo): combo is string[] => Array.isArray(combo))
          .map((combo) => combo.filter((word) => typeof word === "string" && word.trim()).slice(0, 6))
          .filter((combo) => combo.length > 0)
          .slice(0, 12)
      : undefined;
  return {
    ...s,
    ...(quarantine.length ? { quarantine } : {}),
    entities: Array.isArray(s.entities) ? s.entities.filter(validEntity) : s.entities,
    batches: s.batches.filter(validBatch).map((b) => ({
      ...b,
      gist: typeof b.gist === "string" ? b.gist : undefined,
      gistKo: typeof b.gistKo === "string" ? b.gistKo : undefined,
      keywords: keywords(b.keywords),
      // Scenes are optional detail: a malformed one is skipped without setting the batch aside.
      ...(Array.isArray(b.scenes)
        ? {
            scenes: b.scenes.filter(validScene).map((scene) => ({
              ...scene,
              participants: stringList(scene.participants, 30),
              changes: stringList(scene.changes, 12),
              keywords: keywords(scene.keywords),
              lines: (Array.isArray(scene.lines) ? scene.lines : [])
                .filter((line) => line && typeof line.text === "string" && typeof line.sourceId === "string")
                .slice(0, 3),
            })),
          }
        : {}),
      facts: b.facts.map((f) => ({
        ...f,
        keywords: keywords(f.keywords),
        combos: combos(f.combos),
        activation: f.activation === "always" || f.activation === "recall" ? f.activation : undefined,
      })),
    })),
  };
}
/** A memory of this chat this version cannot read is never overwritten. */
export function assertCommittedMemoryWritable(metadata: Record<string, unknown>, chatId: string) {
  if (committedMemoryReadability(metadata, chatId) === "unreadable")
    throw Object.assign(new Error("The saved memory could not be read, so it was not overwritten"), {
      statusCode: 409,
    });
}
/**
 * Every write stores format 3. The first time a format-1 memory is written, its original is kept once in
 * `legacyBackup`; set-aside batches are always written back unchanged.
 */
export function storedCommittedMemory(
  next: CommittedMemoryState,
  metadata: Record<string, unknown>,
  chatId: string,
): CommittedMemoryState {
  assertCommittedMemoryWritable(metadata, chatId);
  const raw =
    committedMemoryReadability(metadata, chatId) === "readable"
      ? (metadata.committedMemory as CommittedMemoryState)
      : null;
  const legacyBackup =
    raw?.legacyBackup !== undefined ? raw.legacyBackup : raw?.version === 1 ? structuredClone(raw) : next.legacyBackup;
  const quarantine = next.quarantine ?? raw?.quarantine;
  return {
    ...next,
    version: 3,
    ...(legacyBackup !== undefined ? { legacyBackup } : {}),
    ...(quarantine?.length ? { quarantine } : {}),
  };
}
export function memoryFactIdentity(
  f: Pick<CommittedMemoryFact, "kind" | "key" | "audience"> &
    Partial<Pick<CommittedMemoryFact, "entityId" | "attribute">>,
): string {
  if (f.entityId && f.attribute?.trim())
    return JSON.stringify(["entity", f.entityId, f.attribute.normalize("NFKC").trim().toLowerCase()]);
  return JSON.stringify([
    f.kind,
    f.key.normalize("NFKC").trim().toLowerCase(),
    f.audience === "shared" ? "shared" : [...new Set(f.audience)].sort(),
  ]);
}
/** Legacy batches are upgraded without discarding episode summaries or source coverage. */
export function consolidateCommittedMemory(state: CommittedMemoryState): CommittedMemoryState {
  const next = structuredClone(state);
  const current = new Map<string, { batch: CommittedMemoryBatch; fact: CommittedMemoryFact }>();
  for (const batch of [...next.batches].sort((a, b) => a.turn - b.turn)) {
    if (batch.invalidated) continue;
    batch.factKeys = [...new Set([...(batch.factKeys ?? []), ...batch.facts.map(memoryFactIdentity)])];
    for (const fact of [...batch.facts]) {
      const identity = memoryFactIdentity(fact);
      fact.dependencies ??= batch.sources.filter((s) => fact.sourceIds.includes(s.id));
      const previous = current.get(identity);
      // The same slot with the same value (and the same knowledge) is no change: keep the existing memory, add
      // the new evidence to it, and create neither a new item nor a history entry.
      if (previous && !previous.fact.invalidated && sameMemoryValue(previous.fact, fact)) {
        previous.fact.dependencies = [
          ...new Map([...(previous.fact.dependencies ?? []), ...fact.dependencies].map((s) => [s.id, s])).values(),
        ];
        previous.fact.sourceIds = [...new Set([...previous.fact.sourceIds, ...fact.sourceIds])];
        previous.fact.keywords = [...new Set([...(previous.fact.keywords ?? []), ...(fact.keywords ?? [])])].slice(
          0,
          24,
        );
        batch.facts = batch.facts.filter((f) => f !== fact);
        continue;
      }
      if (previous) {
        fact.id = previous.fact.id;
        fact.excluded = previous.fact.excluded || fact.excluded;
        fact.edited = previous.fact.edited || fact.edited;
        if (!previous.fact.invalidated && !previous.fact.edited) {
          const { previous: history = [], ...oldValue } = previous.fact;
          const evidence = [
            ...new Map(
              [...(oldValue.dependencies ?? []), ...previous.batch.sources].map((source) => [source.id, source]),
            ).values(),
          ];
          fact.previous = [...history, { ...oldValue, dependencies: evidence, turn: previous.batch.turn }].slice(-3);
        }

        // Retain evidence versions so a later edit cannot silently legitimize stale knowledge.
        fact.dependencies = [
          ...new Map(
            [...(previous.fact.invalidated ? [] : (previous.fact.dependencies ?? [])), ...fact.dependencies].map(
              (s) => [s.id, s],
            ),
          ).values(),
        ];
        previous.batch.facts = previous.batch.facts.filter((f) => f !== previous.fact);
      }
      fact.progress ??= fact.status === "resolved" ? "completed" : "pending";
      current.set(identity, { batch, fact });
    }
  }
  // At most ENTITY_FACT_CAP current facts per entity; older ones become history (kept, never injected).
  const byEntity = new Map<string, Array<{ fact: CommittedMemoryFact; turn: number }>>();
  for (const batch of next.batches) {
    if (batch.invalidated) continue;
    for (const fact of batch.facts) {
      delete fact.archived;
      if (!fact.entityId || fact.invalidated || fact.status === "resolved") continue;
      byEntity.set(fact.entityId, [...(byEntity.get(fact.entityId) ?? []), { fact, turn: batch.turn }]);
    }
  }
  for (const facts of byEntity.values())
    facts
      .sort((a, b) => b.turn - a.turn)
      .slice(ENTITY_FACT_CAP)
      .forEach(({ fact }) => (fact.archived = true));
  return next;
}
export const ENTITY_FACT_CAP = 8;
function normalizedText(value: string | undefined) {
  return (value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}
function sameAudience(a: CommittedMemoryFact["audience"], b: CommittedMemoryFact["audience"]) {
  if (a === "shared" || b === "shared") return a === b;
  return JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());
}
const promiseProgress = (f: CommittedMemoryFact) => f.progress ?? (f.status === "resolved" ? "completed" : "pending");
/** Same content, status, progress and knowledge: a repeated memory, not an update. */
export function sameMemoryValue(a: CommittedMemoryFact, b: CommittedMemoryFact) {
  return (
    normalizedText(a.content) === normalizedText(b.content) &&
    a.status === b.status &&
    (a.kind !== "promise" || promiseProgress(a) === promiseProgress(b)) &&
    sameAudience(a.audience, b.audience)
  );
}
export function reconcileCommittedMemory(
  state: CommittedMemoryState,
  messages: readonly MemorySourceMessage[],
): CommittedMemoryState {
  const fingerprints = new Map(messages.map((m) => [m.id, memoryFingerprint(m)]));
  const positions = new Map(messages.map((m, index) => [m.id, index + 1]));
  const checked = {
    ...state,
    batches: state.batches.map((batch) => {
      if (batch.invalidated) return batch;
      if (!batch.sources.every((source) => fingerprints.get(source.id) === source.fingerprint))
        return { ...batch, invalidated: true };
      return {
        ...batch,
        facts: batch.facts.map((fact) => ({
          ...fact,
          previous: (fact.previous ?? [])
            .slice(-3)
            .filter(
              (version) =>
                memoryFactIdentity(version) === memoryFactIdentity(fact) &&
                (version.dependencies ?? []).length > 0 &&
                version.dependencies!.every((source) => fingerprints.get(source.id) === source.fingerprint),
            )
            .map((version) => ({
              ...version,
              turn: Math.max(...version.dependencies!.map((source) => positions.get(source.id) ?? 0)),
            })),
          invalidated:
            fact.invalidated ||
            (fact.dependencies ?? []).some((source) => fingerprints.get(source.id) !== source.fingerprint),
        })),
        // Re-floor positions before choosing which fact is newest after deletions.
        turn: Math.max(...batch.sources.map((source) => positions.get(source.id) ?? 0)),
      };
    }),
  };
  return consolidateCommittedMemory(checked);
}
export function pendingMemoryMessages(state: CommittedMemoryState, messages: readonly MemorySourceMessage[]) {
  const covered = new Set(
    state.batches
      .filter((b) => !b.invalidated && !b.facts.some((f) => f.invalidated))
      .flatMap((b) => b.sources.map((s) => s.id)),
  );
  return messages.filter(
    (m) =>
      !covered.has(m.id) &&
      (m.role === "user" || m.role === "assistant") &&
      m.content.trim() &&
      memoryExtra(m.extra).hiddenFromAI !== true,
  );
}
export function memoryTerms(text: string) {
  return new Set(
    (
      text
        .normalize("NFKC")
        .toLowerCase()
        .match(/[\p{L}\p{N}]+/gu) ?? []
    ).flatMap((word) => {
      const chars = Array.from(word);
      return [word, ...chars.slice(1).map((c, i) => chars[i] + c)];
    }),
  );
}
function relevance(text: string, query: Set<string>) {
  const tokens = memoryTerms(text);
  return [...query].filter((t) => tokens.has(t)).length / Math.max(1, Math.sqrt(tokens.size * query.size));
}
export const COMMITTED_MEMORY_DEFAULTS = { tokenBudget: 2400, alwaysTokens: 600, recallLimit: 12 } as const;
/** Promises come up every turn by default; everything else only when the scene calls for it. */
export function factActivation(f: Pick<CommittedMemoryFact, "activation" | "kind">) {
  return f.activation ?? (f.kind === "promise" ? "always" : "recall");
}
function hasWord(haystack: string, word: string) {
  const needle = word.normalize("NFKC").toLowerCase().trim();
  return needle.length > 0 && haystack.includes(needle);
}
/**
 * How strongly the recent scene calls a "recall" fact: any one keyword, or every word of a combination. Facts
 * from before keywords existed fall back to their text overlapping the scene.
 */
export function factRecallScore(
  f: Pick<CommittedMemoryFact, "keywords" | "combos" | "key" | "content" | "keyKo" | "contentKo">,
  sceneText: string,
  sceneTerms: Set<string>,
) {
  const scene = sceneText.normalize("NFKC").toLowerCase();
  const keywordHits = (f.keywords ?? []).filter((k) => hasWord(scene, k)).length;
  const comboHits = (f.combos ?? []).filter(
    (combo) => combo.length > 0 && combo.every((w) => hasWord(scene, w)),
  ).length;
  if (keywordHits || comboHits) return keywordHits + 2 * comboHits;
  if ((f.keywords ?? []).length || (f.combos ?? []).length) return 0;
  const overlap = relevance([f.key, f.content, f.keyKo, f.contentKo].filter(Boolean).join(" "), sceneTerms);
  return overlap >= 0.2 ? overlap : 0;
}
type Candidate = CommittedMemorySelection & {
  score: number;
  knownBy?: string[];
  notKnownBy?: string[];
  turn: number;
  progressRank: number;
  activation?: "always" | "recall";
};
/**
 * What goes into the prompt, in three tiers under one token budget:
 * - always: promises in progress and facts pinned "always" (own budget; the rest wait, never deleted);
 * - recall: other current facts the scene calls up by keyword, combination or meaning (count limit);
 * - flow: recent episode summaries, then older ones that matter, with what is left.
 * Knowledge stays scoped: for one character only what they know; when several characters are written at once,
 * a secret some of them know goes into <knowledge_boundaries>, marked with who does not know it.
 */
export function selectCommittedMemory(
  state: CommittedMemoryState,
  queryText: string,
  excludedIds: readonly string[] = [],
  budget = 8000,
  audienceIds: readonly string[] = [],
  semanticScores: ReadonlyMap<string, number> = new Map(),
  names: ReadonlyMap<string, string> = new Map(),
) {
  const config = state.recall ?? {};
  const tokenBudget = config.tokenBudget ?? COMMITTED_MEMORY_DEFAULTS.tokenBudget;
  const alwaysTokens = Math.min(tokenBudget, config.alwaysTokens ?? COMMITTED_MEMORY_DEFAULTS.alwaysTokens);
  const recallLimit = config.recallLimit ?? COMMITTED_MEMORY_DEFAULTS.recallLimit;
  const recentWindow = config.recentMessages ?? 30;
  const longWindow = Math.max(recentWindow, config.longTermMessages ?? 300);
  const excluded = new Set(excludedIds);
  const valid = state.batches.filter((b) => !b.invalidated && !b.sources.some((s) => excluded.has(s.id)));
  const newest = Math.max(0, ...valid.map((b) => b.turn));
  const query = memoryTerms(queryText);
  const facts: Candidate[] = [];
  const current = new Map<string, { fact: CommittedMemoryBatch["facts"][number]; turn: number }>();
  for (const batch of [...state.batches].filter((b) => !b.invalidated).sort((a, b) => a.turn - b.turn))
    for (const fact of batch.facts) {
      let value = fact;
      const futureEvidence =
        batch.sources.some((source) => excluded.has(source.id)) ||
        (fact.dependencies ?? []).some((source) => excluded.has(source.id));
      if (futureEvidence && !fact.excluded && !fact.edited && !fact.invalidated && !batch.excluded) {
        const previous = [...(fact.previous ?? [])]
          .reverse()
          .find(
            (version) =>
              !version.invalidated &&
              (version.dependencies ?? []).length > 0 &&
              !version.dependencies!.some((source) => excluded.has(source.id)),
          );
        if (!previous) continue;
        value = previous;
      }
      current.set(memoryFactIdentity(value), {
        fact: batch.excluded ? { ...value, excluded: true } : value,
        turn: batch.turn,
      });
    }

  const nameOf = (id: string) => names.get(id) ?? id;
  for (const { fact: f, turn } of current.values()) {
    if (
      f.status !== "current" ||
      f.progress === "completed" ||
      f.progress === "cancelled" ||
      f.excluded ||
      f.invalidated ||
      f.archived ||
      (f.dependencies ?? []).some((s) => excluded.has(s.id))
    )
      continue;
    // Knowledge: shared facts for everyone; a scoped fact for one character only if they know it; with several
    // characters, a scoped fact some of them know is a marked secret; one nobody here knows stays out.
    let knownBy: string[] | undefined;
    let notKnownBy: string[] | undefined;
    if (f.audience !== "shared") {
      if (!audienceIds.length || !f.audience.length) continue;
      const knowing = audienceIds.filter((id) => f.audience.includes(id));
      if (!knowing.length) continue;
      if (knowing.length < audienceIds.length) {
        if (audienceIds.length === 1) continue;
        knownBy = knowing;
        notKnownBy = [...new Set([...audienceIds.filter((id) => !f.audience.includes(id)), ...(f.unknownTo ?? [])])];
      }
    }
    const activation = factActivation(f);
    const semantic = Math.max(0, semanticScores.get(f.id) ?? 0);
    const called =
      activation === "always" ? 1 : factRecallScore(f, queryText, query) + (semantic > 0.35 ? semantic : 0);
    if (!called) continue;
    const label = `[${f.kind}${f.kind === "promise" ? `:${f.progress ?? "pending"}` : ""}] ${f.content}`;
    facts.push({
      id: f.id,
      content: knownBy
        ? `${label} (known by: ${knownBy.map(nameOf).join(", ")}; not known by: ${notKnownBy!.map(nameOf).join(", ")})`
        : label,
      displayKo: f.contentKo,
      reason: "current",
      tier: knownBy ? "boundary" : activation,
      sourceIds: f.sourceIds,
      score: called,
      knownBy,
      notKnownBy,
      turn,
      progressRank: f.progress === "in_progress" ? 0 : f.kind === "promise" ? 1 : 2,
      activation,
    });
  }
  const correctedKeys = new Set(
    [...current.values()]
      .map(({ fact }) => fact)
      .filter((f) => f.excluded || f.edited || f.invalidated)
      .map(memoryFactIdentity),
  );
  const episodes: Candidate[] = [];
  for (const b of valid) {
    // A corrected/withheld fact may still be repeated by the original narrative.
    if (b.excluded || [...(b.factKeys ?? []), ...b.facts.map(memoryFactIdentity)].some((key) => correctedKeys.has(key)))
      continue;
    const age = newest - b.turn;
    const recent = age < recentWindow;
    const stage = recent ? "short" : age < longWindow ? "long" : "core";
    const useGist = stage === "core" && b.gist && estimateTextTokens(b.gist) < estimateTextTokens(b.core);
    const content = recent ? b.summary : useGist ? b.gist! : b.core;
    const displayKo = recent ? b.summaryKo : useGist ? b.gistKo : b.coreKo;
    if (!content) continue;
    const score =
      relevance([content, displayKo, ...(b.keywords ?? [])].filter(Boolean).join(" "), query) +
      Math.max(0, semanticScores.get(b.id) ?? 0);
    if (recent || score > 0)
      episodes.push({
        id: b.id,
        content: `[Earlier episode ${b.turn}] ${content}`,
        displayKo,
        stage,
        reason: recent ? "recent" : "relevant",
        tier: "flow",
        sourceIds: b.sources.map((s) => s.id),
        score: (recent ? 1 : 0) + score,
        turn: b.turn,
        progressRank: 0,
      });
  }

  const selected: CommittedMemorySelection[] = [];
  const waiting: string[] = [];
  const seen = new Set<string>();
  const fits = (item: CommittedMemorySelection) => {
    const text = renderCommittedMemory([...selected, item]);
    return estimateTextTokens(text) <= tokenBudget && Buffer.byteLength(text, "utf8") <= budget;
  };
  const take = (item: Candidate) => {
    const {
      score: _score,
      knownBy: _k,
      notKnownBy: _n,
      turn: _t,
      progressRank: _p,
      activation: _a,
      ...selection
    } = item;
    const key = selection.content.normalize("NFKC").trim();
    if (seen.has(key)) return true;
    if (!fits(selection)) return false;
    seen.add(key);
    selected.push({ ...selection, tokens: estimateTextTokens(selection.content) });
    return true;
  };
  // 1. always, by priority: promises in progress, other promises, then the newest.
  let alwaysUsed = 0;
  for (const item of facts
    .filter((f) => f.activation === "always")
    .sort((a, b) => a.progressRank - b.progressRank || b.turn - a.turn)) {
    const cost = estimateTextTokens(item.content);
    if (alwaysUsed + cost > alwaysTokens || !take(item)) {
      waiting.push(item.id);
      continue;
    }
    alwaysUsed += cost;
  }
  // 2. recall, strongest first, up to the count limit.
  let recalled = 0;
  for (const item of facts
    .filter((f) => !selected.some((s) => s.id === f.id) && !waiting.includes(f.id))
    .sort((a, b) => b.score - a.score || b.turn - a.turn)) {
    if (recalled >= recallLimit) break;
    if (take(item)) recalled++;
  }
  // 3. flow: episodes with what is left.
  let flowCount = 0;
  for (const item of episodes.sort((a, b) => b.score - a.score)) {
    if (flowCount >= (config.topK ?? 20)) break;
    if (take(item)) flowCount++;
  }
  // Retrieval priority decides inclusion; episode chronology decides presentation.
  const order = new Map(valid.map((b) => [b.id, b.turn]));
  const ordered = [
    ...selected.filter((i) => i.reason === "current"),
    ...selected.filter((i) => i.reason !== "current").sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)),
  ];
  const text = renderCommittedMemory(ordered);
  const tokensOf = (tier: CommittedMemorySelection["tier"]) =>
    ordered.filter((i) => i.tier === tier).reduce((sum, i) => sum + (i.tokens ?? 0), 0);
  return {
    selected: ordered,
    text,
    usedBytes: Buffer.byteLength(text, "utf8"),
    budgetBytes: budget,
    usedTokens: estimateTextTokens(text),
    budgetTokens: tokenBudget,
    tierTokens: {
      always: tokensOf("always"),
      recall: tokensOf("recall"),
      boundary: tokensOf("boundary"),
      flow: tokensOf("flow"),
    },
    waiting,
    tokenCountMethod: "unicode-estimate" as const,
  };
}
export const KNOWLEDGE_BOUNDARY_INSTRUCTION =
  "Each character speaks and acts only on what they know. A character who does not know something never notices it by guess or coincidence. A secret comes out only when the story actually shows it being revealed.";
function renderCommittedMemory(selected: CommittedMemorySelection[]) {
  const facts = selected.filter((i) => i.reason === "current" && i.tier !== "boundary");
  const secrets = selected.filter((i) => i.tier === "boundary");
  const episodes = selected.filter((i) => i.reason !== "current");
  return [
    facts.length
      ? `<current_facts_and_obligations>\n${facts.map((i) => i.content).join("\n")}\n</current_facts_and_obligations>`
      : "",
    secrets.length
      ? `<knowledge_boundaries>\n${KNOWLEDGE_BOUNDARY_INSTRUCTION}\n${secrets.map((i) => `- ${i.content}`).join("\n")}\n</knowledge_boundaries>`
      : "",
    episodes.length ? `<story_chronology>\n${episodes.map((i) => i.content).join("\n\n")}\n</story_chronology>` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
