import { estimateTextTokens, threadLastActivity, threadStalled } from "@marinara-engine/shared";
import { createHash } from "node:crypto";
import type {
  CommittedMemoryBatch,
  CommittedMemoryState,
  CommittedMemorySelection,
  CommittedMemoryFact,
  CommittedMemoryEntity,
  CommittedMemoryScene,
  CommittedMemoryRoutine,
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
/**
 * Chat responses (the chat list, a chat, a metadata save) carry only this much of the unified memory: whether
 * it is on, its owner and epoch. The memory itself can be megabytes in a long room and the client reads it
 * through /committed-memory, so it is not sent with every chat. Storage keeps it whole; clients patch metadata
 * by key and never send this key back.
 */
export function committedMemoryResponseStub(metadata: Record<string, unknown>) {
  const memory = metadata.committedMemory;
  if (!memory || typeof memory !== "object" || Array.isArray(memory)) return metadata;
  const { version, ownerChatId, enabled, epoch } = memory as Record<string, unknown>;
  return { ...metadata, committedMemory: { version, ownerChatId, enabled, epoch } };
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
/**
 * A line saved before voice markup was stripped could be a wrapper's id ("char-9f2a", a 21-character ID) instead
 * of words; such a line is hidden on read. Re-committing ("다시 정리") records the real words.
 */
const TRACKING_ID = /^(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{8,}$/;
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
                .filter(
                  (line) =>
                    line &&
                    typeof line.text === "string" &&
                    typeof line.sourceId === "string" &&
                    !TRACKING_ID.test(line.text.trim()),
                )
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
export function consolidateCommittedMemory(
  state: CommittedMemoryState,
  /** The caller hands over a state of its own (fresh batch and fact objects) that may be changed in place. */
  owned = false,
): CommittedMemoryState {
  const next = owned ? state : structuredClone(state);
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
        // An unchanged thread can still gain clues or a development, and beliefs can change.
        Object.assign(previous.fact, carriedThreadAndBeliefs(previous.fact, fact));
        batch.facts = batch.facts.filter((f) => f !== fact);
        continue;
      }
      if (previous) {
        Object.assign(fact, carriedThreadAndBeliefs(previous.fact, fact));
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
const CLUE_LIMIT = 10;
/**
 * What a new value of a record takes over from the old one: clues add up (newest kept, at most CLUE_LIMIT, a
 * repeated text once), the newest development wins, and false beliefs and suspicions carry over unless the new
 * value lists them (an empty list clears them). A belief or suspicion ends when its holder is in the audience:
 * they know the truth now. Reasons for not knowing are kept for those who still do not know.
 */
function carriedThreadAndBeliefs(old: CommittedMemoryFact, next: CommittedMemoryFact) {
  const clues = [
    ...new Map(
      [...(old.clues ?? []), ...(next.clues ?? [])].map((clue) => [normalizedText(clue.text), clue] as const),
    ).values(),
  ]
    .sort((a, b) => a.turn - b.turn)
    .slice(-CLUE_LIMIT);
  const beliefs = (next.falseBeliefs ?? old.falseBeliefs ?? []).filter(
    (belief) => next.audience === "shared" || !next.audience.includes(belief.who),
  );
  const latest = next.latest ?? old.latest;
  const unaware = (id: string) => next.audience !== "shared" && !next.audience.includes(id);
  // Suspicion and the reasons someone does not know follow the same rule: kept until they know.
  const suspectedBy = (next.suspectedBy ?? old.suspectedBy ?? []).filter(unaware);
  const reasons = Object.fromEntries(
    Object.entries({ ...old.unknownReasons, ...next.unknownReasons }).filter(([id]) => unaware(id)),
  );
  return {
    ...(clues.length ? { clues } : {}),
    ...(latest ? { latest, latestKo: next.latest ? next.latestKo : old.latestKo } : {}),
    falseBeliefs: beliefs.length ? beliefs : undefined,
    suspectedBy: suspectedBy.length ? suspectedBy : undefined,
    unknownReasons: Object.keys(reasons).length ? reasons : undefined,
  };
}
/**
 * Small bounded cache for pure text work that every load and every turn repeats on the same saved texts
 * (word sets, normalized text). Results are shared, so callers never change them.
 */
function memoized<T>(compute: (text: string) => T, limit = 5000) {
  const cache = new Map<string, T>();
  return (text: string) => {
    const hit = cache.get(text);
    if (hit !== undefined) return hit;
    const value = compute(text);
    if (cache.size >= limit) cache.delete(cache.keys().next().value!);
    cache.set(text, value);
    return value;
  };
}
const normalizedTextOf = memoized((value) => value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase());
function normalizedText(value: string | undefined) {
  return normalizedTextOf(value ?? "");
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
  // `checked` is built here from new batch and fact objects, so consolidation needs no deep copy of it.
  return consolidateCommittedMemory(checked, true);
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
export const memoryTerms: (text: string) => ReadonlySet<string> = memoized((text) => memoryTermsUncached(text));
function memoryTermsUncached(text: string) {
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
function relevance(text: string, query: ReadonlySet<string>) {
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
  sceneTerms: ReadonlySet<string>,
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
  /** Shared records reach everyone; scoped ones per the knowledge rules above. */
  const scope = (audience: CommittedMemoryFact["audience"], unknownTo: readonly string[] = []) => {
    if (audience === "shared") return { ok: true as const };
    if (!audienceIds.length || !audience.length) return { ok: false as const };
    const knowing = audienceIds.filter((id) => audience.includes(id));
    if (!knowing.length) return { ok: false as const };
    if (knowing.length === audienceIds.length) return { ok: true as const };
    if (audienceIds.length === 1) return { ok: false as const };
    return {
      ok: true as const,
      knownBy: knowing,
      notKnownBy: [...new Set([...audienceIds.filter((id) => !audience.includes(id)), ...unknownTo])],
    };
  };
  // Who is in the scene now: roster characters, and entities the recent conversation names.
  const sceneLower = queryText.normalize("NFKC").toLowerCase();
  const rosterNames = new Set([...names.values()].map((name) => name.normalize("NFKC").trim().toLowerCase()));
  const presentEntities = new Set(
    (state.entities ?? [])
      .filter((entity) =>
        [entity.name, ...entity.aliases].some((name) => {
          const needle = name.normalize("NFKC").trim().toLowerCase();
          return needle && (rosterNames.has(needle) || sceneLower.includes(needle));
        }),
      )
      .map((entity) => entity.id),
  );
  // A state changed in one of the three newest batches is a recent change.
  const recentTurns = [...new Set(valid.map((b) => b.turn))].sort((a, b) => b - a).slice(0, 3);
  const recentFloor = recentTurns.length ? Math.min(...recentTurns) : Infinity;
  const knowers = (audience: CommittedMemoryFact["audience"]) =>
    audience === "shared" ? "" : `; known to: ${audience.length ? audience.map(nameOf).join(", ") : "narrator only"}`;
  const batchTurns = valid.map((b) => b.turn);
  const entityNames = new Map((state.entities ?? []).map((entity) => [entity.id, entity.name]));
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
    const access = scope(f.audience, f.unknownTo);
    // False beliefs of the characters in this generation (all of them when it is not scoped to anyone).
    const holders = (f.falseBeliefs ?? []).filter((b) => !audienceIds.length || audienceIds.includes(b.who));
    // Characters in this generation who only suspect it.
    const guessers = (f.suspectedBy ?? []).filter((id) => !audienceIds.length || audienceIds.includes(id));
    // A character who does not know the record, or who is the only one written now, gets their belief or their
    // suspicion instead of the plain truth: they act on it until the story shows them learning otherwise.
    const beliefOnly = holders.length + guessers.length > 0 && (!access.ok || audienceIds.length === 1);
    if (!access.ok && !beliefOnly) continue;
    const activation = factActivation(f);
    const semantic = Math.max(0, semanticScores.get(f.id) ?? 0);
    const recall =
      factRecallScore(f, queryText, query) +
      (holders.length ? relevance(holders.map((b) => b.believes).join(" "), query) : 0) +
      (semantic > 0.35 ? semantic : 0);
    const isState = f.kind === "state";
    const isThread = f.kind === "thread" || f.kind === "promise" || f.kind === "emotion";
    // Threads and unresolved emotions are open storylines: called up when relevant, otherwise rotated in.
    const openLine = f.kind === "thread" || f.kind === "emotion";
    const tracksHistory = isState || f.kind === "relationship" || /^relationship/i.test(f.attribute ?? "");
    // Earlier values follow the same knowledge rules as current ones.
    const history = tracksHistory
      ? (f.previous ?? []).filter((version) => !version.invalidated && scope(version.audience, version.unknownTo).ok)
      : [];
    const changedRecently = isState && history.length > 0 && turn >= recentFloor;
    const present = isState && !!f.entityId && presentEntities.has(f.entityId);
    const called = activation === "always" ? 1 : recall + (present ? 1 : 0) + (changedRecently ? 1 : 0);
    // Dormant threads stay candidates for the rotation below.
    if (!called && !(openLine && !beliefOnly)) continue;
    if (beliefOnly) {
      facts.push({
        id: f.id,
        content: [
          ...holders.map((b) => `[belief] ${nameOf(b.who)} believes: ${b.believes}`),
          ...guessers.map((id) => `[suspicion] ${nameOf(id)} suspects, without being sure: ${f.content}`),
        ].join("\n"),
        displayKo:
          holders
            .map((b) => b.believesKo)
            .filter(Boolean)
            .join("\n") || undefined,
        reason: "current",
        kind: "belief",
        tier: audienceIds.length > 1 ? "boundary" : activation,
        sourceIds: f.sourceIds,
        score: called,
        turn,
        progressRank: 2,
        activation,
      });
      continue;
    }
    const { knownBy, notKnownBy } = access as { knownBy?: string[]; notKnownBy?: string[] };
    let label = `[${f.kind}${f.kind === "promise" ? `:${f.progress ?? "pending"}` : ""}] ${f.content}`;
    if (history.length)
      label += ` (changed at message ${turn}${knowers(f.audience)}. Before: ${[...history]
        .reverse()
        .map((version) => `${version.content} (message ${version.turn}${knowers(version.audience)})`)
        .join(" ← ")})`;
    const lastActivity = isThread ? threadLastActivity(f, turn) : turn;
    if (isThread) {
      if (f.latest) label += ` (latest: ${f.latest})`;
      const clues = (f.clues ?? []).slice(-THREAD_CLUES_SHOWN);
      if (clues.length) label += ` (clues: ${clues.map((clue) => `${clue.text} [message ${clue.turn}]`).join("; ")})`;
      if (f.cause) label += ` (cause: ${f.cause})`;
      if (f.endCondition)
        label += f.kind === "emotion" ? ` (needs: ${f.endCondition})` : ` (closes when: ${f.endCondition})`;
      if (threadStalled(f, turn, batchTurns)) label += ` (stalled since message ${lastActivity})`;
      else if (openLine) label += ` (last development at message ${lastActivity})`;
    }
    if (holders.length)
      label += ` (wrongly believed: ${holders.map((b) => `${nameOf(b.who)} believes ${b.believes}`).join("; ")})`;
    if (guessers.length) label += ` (only suspected by: ${guessers.map(nameOf).join(", ")})`;
    const marked = !!knownBy || ((holders.length > 0 || guessers.length > 0) && audienceIds.length > 1);
    // A state is shown under its entity in the scene-now block.
    const subject = isState && f.entityId ? entityNames.get(f.entityId) : undefined;
    const why = (id: string) => (f.unknownReasons?.[id] ? `${nameOf(id)} (${f.unknownReasons[id]})` : nameOf(id));
    facts.push({
      id: f.id,
      content: knownBy
        ? `${label} (known by: ${knownBy.map(nameOf).join(", ")}; not known by: ${notKnownBy!.map(why).join(", ")})`
        : label,
      displayKo: f.contentKo,
      reason: "current",
      kind: f.kind,
      ...(subject ? { subject } : {}),
      tier: marked ? "boundary" : isState ? "state" : openLine ? "thread" : activation,
      sourceIds: f.sourceIds,
      score: called,
      knownBy,
      notKnownBy,
      turn: lastActivity,
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
  const scenes: Candidate[] = [];
  // Words the recent conversation shares with only a few saved records (a name or thing said once long ago)
  // call those records up strongly; words every record has count for nothing.
  const sceneText = (scene: CommittedMemoryScene) =>
    [
      scene.where,
      ...scene.participants,
      scene.event,
      scene.eventKo,
      ...scene.lines.map((line) => line.text),
      ...scene.changes,
      ...(scene.keywords ?? []),
    ]
      .filter(Boolean)
      .join(" ");
  const rare = rareWordScorer(
    valid.flatMap((b) => [
      [b.summary, b.core, b.summaryKo, b.coreKo].filter(Boolean).join(" "),
      ...(b.scenes ?? []).map(sceneText),
    ]),
    queryText,
  );
  const sceneRare = new Map<string, number>();
  for (const b of valid) {
    // A corrected/withheld fact may still be repeated by the original narrative.
    if (b.excluded || [...(b.factKeys ?? []), ...b.facts.map(memoryFactIdentity)].some((key) => correctedKeys.has(key)))
      continue;
    // Scenes come back when this moment calls them: a name, place, object or line they share, or their meaning.
    for (const scene of b.scenes ?? []) {
      const access = scope(scene.audience);
      if (!access.ok || access.knownBy) continue;
      // Who was there but remembers it vaguely or not at all; one who forgot it, written alone, does not recall it.
      const blurred = (scene.memory ?? []).filter((m) => !audienceIds.length || audienceIds.includes(m.who));
      if (audienceIds.length === 1 && blurred[0]?.remembers === "none") continue;
      const rareScore = rare(sceneText(scene));
      const score =
        factRecallScore(
          {
            key: [scene.where, ...scene.participants].filter(Boolean).join(" "),
            content: [scene.event, ...scene.lines.map((line) => line.text), ...scene.changes].join(" "),
            keywords: scene.keywords,
          },
          queryText,
          query,
        ) +
        rareScore +
        Math.max(0, (semanticScores.get(scene.id) ?? 0) > 0.35 ? semanticScores.get(scene.id)! : 0);
      if (!score) continue;
      sceneRare.set(scene.id, rareScore);
      const heading = [
        `message ${b.turn}`,
        scene.when,
        scene.where,
        scene.participants.length ? `present: ${scene.participants.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("; ");
      scenes.push({
        id: scene.id,
        content: [
          `[Scene, ${heading}] ${scene.event}`,
          ...scene.lines.map((line) => `  ${line.speaker}${line.to ? ` → ${line.to}` : ""}: "${line.text}"`),
          ...(scene.changes.length ? [`  Changed: ${scene.changes.join("; ")}`] : []),
          ...(blurred.length
            ? [
                `  Memory: ${blurred
                  .map(
                    (m) =>
                      `${nameOf(m.who)} ${m.remembers === "none" ? "does not remember it" : "remembers it only vaguely"}${m.why ? ` (${m.why})` : ""}`,
                  )
                  .join("; ")}`,
              ]
            : []),
        ].join("\n"),
        displayKo: scene.eventKo,
        reason: "relevant",
        tier: "scene",
        sourceIds: scene.sourceIds,
        score,
        turn: b.turn,
        progressRank: 0,
      });
    }
    const age = newest - b.turn;
    const recent = age < recentWindow;
    const stage = recent ? "short" : age < longWindow ? "long" : "core";
    const useGist = stage === "core" && b.gist && estimateTextTokens(b.gist) < estimateTextTokens(b.core);
    const content = recent ? b.summary : useGist ? b.gist! : b.core;
    const displayKo = recent ? b.summaryKo : useGist ? b.gistKo : b.coreKo;
    if (!content) continue;
    const score =
      relevance([content, displayKo, ...(b.keywords ?? [])].filter(Boolean).join(" "), query) +
      rare([b.summary, b.core, b.summaryKo, b.coreKo].filter(Boolean).join(" ")) +
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

  // "You said back then…": the conversation points at something said before, so the first scene where it came
  // up goes ahead of later scenes that only mention it again.
  if (BACK_REFERENCE.test(queryText)) {
    const top = Math.max(0, ...sceneRare.values());
    const first = scenes
      .filter((scene) => top > 0 && (sceneRare.get(scene.id) ?? 0) >= top / 2)
      .sort((a, b) => a.turn - b.turn)[0];
    if (first) first.score += 1;
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
  const taken = (item: Candidate) => selected.some((s) => s.id === item.id) || waiting.includes(item.id);
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
  // 2. the scene now: states of who is here and states that just changed, with their history.
  let states = 0;
  for (const item of facts
    .filter((f) => f.kind === "state" && !taken(f))
    .sort((a, b) => b.score - a.score || b.turn - a.turn)) {
    if (states >= SCENE_STATE_LIMIT) break;
    if (take(item)) states++;
  }
  // 2b. daily life of the people in the scene: one small block, computed from the routine records.
  // A person's daily life joins their entity's line when the name is one of its names or aliases.
  const entityByName = new Map(
    (state.entities ?? []).flatMap((entity) =>
      [entity.name, ...entity.aliases].map(
        (name) => [name.normalize("NFKC").trim().toLowerCase(), entity.name] as const,
      ),
    ),
  );
  for (const person of dailyLife(valid, queryText, names, (who) =>
    entityByName.get(who.normalize("NFKC").trim().toLowerCase()),
  ))
    take({
      id: `daily-life:${person.who}`,
      content: person.content,
      subject: person.who,
      reason: "current",
      tier: "life",
      sourceIds: person.sourceIds,
      score: 1,
      turn: newest,
      progressRank: 2,
    });
  // 3. recall, strongest first, up to the count limit.
  let recalled = 0;
  for (const item of facts
    .filter((f) => f.kind !== "state" && f.kind !== "thread" && f.kind !== "emotion" && !taken(f))
    .sort((a, b) => b.score - a.score || b.turn - a.turn)) {
    if (recalled >= recallLimit) break;
    if (take(item)) recalled++;
  }
  // 4. open threads: the ones this moment calls, then dormant ones in rotation so old foreshadowing is not lost.
  const threads = facts.filter((f) => (f.kind === "thread" || f.kind === "emotion") && !taken(f));
  const called = threads.filter((f) => f.score > 0).sort((a, b) => b.score - a.score || b.turn - a.turn);
  const dormant = threads.filter((f) => f.score === 0).sort((a, b) => a.turn - b.turn);
  const start = dormant.length ? rotation(queryText) % dormant.length : 0;
  const rotated = [...dormant.slice(start), ...dormant.slice(0, start)].slice(0, DORMANT_THREAD_ROTATION);
  let threadCount = 0;
  for (const item of [...called, ...rotated]) {
    if (threadCount >= THREAD_LIMIT) break;
    if (take(item)) threadCount++;
  }
  // 5. scenes this moment calls back, with their exact lines.
  let sceneCount = 0;
  for (const item of scenes.sort((a, b) => b.score - a.score || b.turn - a.turn)) {
    if (sceneCount >= SCENE_RECALL_LIMIT) break;
    if (take(item)) sceneCount++;
  }
  // 6. flow: episodes with what is left.
  let flowCount = 0;
  for (const item of episodes.sort((a, b) => b.score - a.score)) {
    if (flowCount >= (config.topK ?? 20)) break;
    if (take(item)) flowCount++;
  }
  // Retrieval priority decides inclusion; episode chronology decides presentation.
  const order = new Map(valid.map((b) => [b.id, b.turn]));
  const sceneTurns = new Map(scenes.map((s) => [s.id, s.turn]));
  const ordered = [
    ...selected.filter((i) => i.reason === "current"),
    ...selected
      .filter((i) => i.reason !== "current")
      .sort((a, b) => (order.get(a.id) ?? sceneTurns.get(a.id) ?? 0) - (order.get(b.id) ?? sceneTurns.get(b.id) ?? 0)),
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
      state: tokensOf("state"),
      life: tokensOf("life"),
      thread: tokensOf("thread"),
      scene: tokensOf("scene"),
      flow: tokensOf("flow"),
    },
    waiting,
    tokenCountMethod: "unicode-estimate" as const,
  };
}
/** A story time's date ("24-10-18", "2024.10.18", "10월 18일" is not dated) and minutes into the day. */
function storyTime(at: string | undefined) {
  if (!at) return {};
  const date = /(\d{2,4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/u.exec(at);
  const clock = /(\d{1,2})\s*(?::|시)\s*(\d{1,2})?/u.exec(at.replace(date?.[0] ?? "", ""));
  let minutes: number | undefined;
  if (clock) {
    let hour = Number(clock[1]);
    if (/오후|저녁|밤|pm/iu.test(at) && hour < 12) hour += 12;
    if (hour <= 24) minutes = hour * 60 + Number(clock[2] ?? 0);
  }
  const year = date ? (date[1]!.length === 2 ? 2000 + Number(date[1]) : Number(date[1])) : undefined;
  return {
    day: date ? `${year}-${date[2]!.padStart(2, "0")}-${date[3]!.padStart(2, "0")}` : undefined,
    minutes,
  };
}
/**
 * The daily-life block for the people in the scene (characters of the room and anyone the conversation names;
 * otherwise the three most recently active): their last meal and how many meals that day, sleep and waking with
 * the hours slept, washing and medicine. All counting is done here, from the routine records.
 */
function dailyLife(
  batches: readonly CommittedMemoryBatch[],
  queryText: string,
  names: ReadonlyMap<string, string>,
  /** The entity name for a written name (its name or an alias), so "미라" and "Mira" are one person. */
  canonical: (who: string) => string | undefined = () => undefined,
) {
  const people = new Map<string, Array<{ entry: CommittedMemoryRoutine; turn: number }>>();
  // Every name a person was written as, to tell whether the conversation names them.
  const spellings = new Map<string, Set<string>>();
  for (const batch of [...batches].sort((a, b) => a.turn - b.turn))
    for (const entry of batch.routine ?? []) {
      if (entry.excluded) continue;
      for (const who of entry.who
        .split(/[·,、&]|\s+and\s+/u)
        .map((name) => name.trim())
        .filter(Boolean)) {
        const name = canonical(who) ?? who;
        const key = name.normalize("NFKC").toLowerCase();
        people.set(key, [...(people.get(key) ?? []), { entry: { ...entry, who: name }, turn: batch.turn }]);
        spellings.set(key, new Set([...(spellings.get(key) ?? []), key, who.normalize("NFKC").toLowerCase()]));
      }
    }
  if (!people.size) return [];
  const scene = queryText.normalize("NFKC").toLowerCase();
  const room = new Set([...names.values()].map((name) => name.normalize("NFKC").toLowerCase()));
  const lastTurn = (key: string) => Math.max(...people.get(key)!.map((item) => item.turn));
  const present = [...people.keys()].filter((key) =>
    [...spellings.get(key)!].some((spelling) => room.has(spelling) || scene.includes(spelling)),
  );
  const chosen = (present.length ? present : [...people.keys()].sort((a, b) => lastTurn(b) - lastTurn(a)).slice(0, 3))
    .sort((a, b) => lastTurn(b) - lastTurn(a))
    .slice(0, 6);
  const when = (item: { entry: CommittedMemoryRoutine; turn: number }) =>
    `message ${item.turn}${item.entry.at ? `, ${item.entry.at}` : ""}`;
  const said = (entry: CommittedMemoryRoutine) => (entry.claimed ? ", said" : "");
  return chosen.map((key) => {
    const sourceIds = new Set<string>();
    const items = people.get(key)!;
    const last = (what: CommittedMemoryRoutine["what"]) => items.filter((item) => item.entry.what === what).at(-1);
    const parts: string[] = [];
    const meal = last("meal");
    if (meal) {
      const day = storyTime(meal.entry.at).day;
      const count = day
        ? items.filter(
            (item) => item.entry.what === "meal" && !item.entry.substitute && storyTime(item.entry.at).day === day,
          ).length
        : 0;
      parts.push(
        `last meal: ${meal.entry.text ?? "a meal"}${meal.entry.substitute ? " (made do)" : ""} (${when(meal)}${said(meal.entry)}${count ? `; meal ${count} that day` : ""})`,
      );
    }
    const sleep = last("sleep");
    const wake = last("wake");
    if (sleep && (!wake || wake.turn < sleep.turn)) parts.push(`asleep since ${when(sleep)}`);
    else if (wake) {
      const from = storyTime(sleep?.entry.at);
      const to = storyTime(wake.entry.at);
      let hours: number | undefined;
      if (sleep && from.minutes !== undefined && to.minutes !== undefined) {
        const days = from.day && to.day ? (Date.parse(to.day) - Date.parse(from.day)) / 86400000 : undefined;
        const span =
          days !== undefined
            ? days * 1440 + to.minutes - from.minutes
            : to.minutes - from.minutes + (to.minutes < from.minutes ? 1440 : 0);
        if (span > 0 && span < 2880) hours = Math.round(span / 6) / 10;
      }
      parts.push(
        sleep
          ? `slept ${when(sleep)} → woke ${when(wake)}${hours !== undefined ? ` (${hours} h)` : ""}`
          : `woke ${when(wake)}`,
      );
    }
    for (const [what, label] of [
      ["wash", "washed"],
      ["medicine", "medicine"],
    ] as const) {
      const item = last(what);
      if (item) parts.push(`${label}: ${item.entry.text ?? what} (${when(item)}${said(item.entry)})`);
    }
    for (const item of [meal, sleep, wake, last("wash"), last("medicine")])
      if (item) sourceIds.add(item.entry.sourceId);
    return { who: items[0]!.entry.who, content: parts.join(" · "), sourceIds: [...sourceIds] };
  });
}
const BACK_REFERENCE =
  /(그때|그날|예전에|전에\s*(말|했)|말했잖|했잖아|약속했잖|기억\s*(나|안\s*나|하지|해\?)|처음\s*만났|remember\s+when|you\s+said|back\s+then|that\s+time|last\s+time|you\s+promised)/iu;
/**
 * Words for rarity: whole words of two or more letters, plus two-letter pieces of Korean, Japanese and Chinese
 * words (so "미라가" and "미라는" share "미라"). Latin two-letter pieces ("he" in "the") would make noise.
 */
const rareTerms: (text: string) => ReadonlySet<string> = memoized((text) => rareTermsUncached(text));
function rareTermsUncached(text: string) {
  const words =
    text
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(
    words.flatMap((word) => {
      const chars = Array.from(word);
      if (chars.length < 2) return [];
      const cjk = /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(word);
      return cjk ? [word, ...chars.slice(1).map((c, i) => chars[i] + c)] : [word];
    }),
  );
}
/**
 * How rare the conversation's words are among the saved records, for one record's text: the summed inverse
 * document frequency of shared words found in at most about a fifth of the records, squashed to 0..1. Too few
 * records make every word look rare, so it stays 0 below five.
 */
function rareWordScorer(documents: readonly string[], queryText: string) {
  const query = rareTerms(queryText);
  if (documents.length < 5 || !query.size) return () => 0;
  const df = new Map<string, number>();
  for (const document of documents) {
    const terms = rareTerms(document);
    for (const term of query) if (terms.has(term)) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const weights = new Map(
    [...df].flatMap(([term, count]) => {
      const idf = Math.log((documents.length + 1) / count);
      return idf >= 1.5 ? [[term, idf] as const] : [];
    }),
  );
  if (!weights.size) return () => 0;
  return (text: string) => {
    const terms = rareTerms(text);
    const sum = [...weights].reduce((total, [term, idf]) => total + (terms.has(term) ? idf : 0), 0);
    return sum / (sum + 3);
  };
}
/** Caps for the format-3 blocks, inside the one token budget. */
const SCENE_STATE_LIMIT = 8;
const THREAD_LIMIT = 5;
const DORMANT_THREAD_ROTATION = 2;
const SCENE_RECALL_LIMIT = 3;
/** Newest clues shown per thread in the prompt (all of them stay in the record). */
const THREAD_CLUES_SHOWN = 3;
/** A stable number that changes as the conversation moves, so dormant threads take turns. */
function rotation(text: string) {
  return createHash("sha256").update(text).digest().readUInt32BE(0);
}
export const KNOWLEDGE_BOUNDARY_INSTRUCTION =
  "Each character speaks and acts only on what they know. A character who does not know something never notices it by guess or coincidence. A character who wrongly believes something acts on that belief. A secret comes out only when the story actually shows it being revealed.";
export const MEMORY_RECENCY_INSTRUCTION =
  "This memory was saved from earlier messages. Where the recent conversation shows something newer, the conversation wins.";
export const SCENE_NOW_INSTRUCTION =
  'Who and what is in the scene now: current states with how they changed (newest first), and daily life (last meal, sleep, washing, medicine; counts and hours are computed). Characters who were there when a state changed noticed it and react to it naturally; those who were not there do not know it. Keep hunger, tiredness and care consistent. "said" means only claimed, not seen.';
export const OPEN_THREAD_INSTRUCTION =
  "Open threads, promises and unresolved feelings, with their newest development and planted clues. Pick one up when it fits the moment, building on its clues; a stalled one can return when the moment allows. Never force a payoff. A thread or promise closes only when the story shows it; a feeling lasts, and colours how that character speaks and acts, until what it needs happens.";
export const RECALLED_SCENE_INSTRUCTION =
  "Earlier scenes this moment calls back. Quoted lines are the exact words spoken.";
function renderCommittedMemory(selected: CommittedMemorySelection[]) {
  const isThread = (i: CommittedMemorySelection) => i.kind === "thread" || i.kind === "promise" || i.kind === "emotion";
  const current = selected.filter((i) => i.reason === "current" && i.tier !== "boundary");
  const facts = current.filter((i) => i.kind !== "state" && !isThread(i) && i.tier !== "life");
  // States and daily life of the same person or thing share one line in the scene-now block.
  const now = new Map<string, string[]>();
  for (const item of current.filter((i) => i.kind === "state" || i.tier === "life")) {
    const content = item.subject ? item.content.replace(/^\[state\]\s*/u, "") : item.content;
    const key = item.subject ? item.subject.normalize("NFKC").toLowerCase() : `\u0000${item.id}`;
    now.set(key, [...(now.get(key) ?? [item.subject ? `${item.subject}:` : ""]), content]);
  }
  const nowLines = [...now.values()].map(([head, ...parts]) => `- ${head ? `${head} ` : ""}${parts.join(" · ")}`);
  const threads = current.filter(isThread);
  const secrets = selected.filter((i) => i.tier === "boundary");
  const scenes = selected.filter((i) => i.tier === "scene");
  const episodes = selected.filter((i) => i.reason !== "current" && i.tier !== "scene");
  const blocks = [
    nowLines.length ? `<scene_now>\n${SCENE_NOW_INSTRUCTION}\n${nowLines.join("\n")}\n</scene_now>` : "",
    facts.length
      ? `<current_facts_and_obligations>\n${facts.map((i) => i.content).join("\n")}\n</current_facts_and_obligations>`
      : "",
    threads.length
      ? `<open_threads>\n${OPEN_THREAD_INSTRUCTION}\n${threads.map((i) => i.content).join("\n")}\n</open_threads>`
      : "",
    secrets.length
      ? `<knowledge_boundaries>\n${KNOWLEDGE_BOUNDARY_INSTRUCTION}\n${secrets.map((i) => `- ${i.content}`).join("\n")}\n</knowledge_boundaries>`
      : "",
    scenes.length
      ? `<recalled_scenes>\n${RECALLED_SCENE_INSTRUCTION}\n${scenes.map((i) => i.content).join("\n\n")}\n</recalled_scenes>`
      : "",
    episodes.length ? `<story_chronology>\n${episodes.map((i) => i.content).join("\n\n")}\n</story_chronology>` : "",
  ].filter(Boolean);
  return blocks.length ? [MEMORY_RECENCY_INSTRUCTION, ...blocks].join("\n\n") : "";
}
