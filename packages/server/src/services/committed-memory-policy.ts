import { estimateTextTokens } from "@marinara-engine/shared";
import { createHash } from "node:crypto";
import type {
  CommittedMemoryBatch,
  CommittedMemoryState,
  CommittedMemorySelection,
  CommittedMemoryFact,
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
export function readCommittedMemory(metadata: Record<string, unknown>, chatId: string): CommittedMemoryState {
  const s = metadata.committedMemory as CommittedMemoryState | undefined;
  if (s?.version !== 1 || s.ownerChatId !== chatId || typeof s.enabled !== "boolean" || !Array.isArray(s.batches))
    return emptyCommittedMemory(chatId);
  if (
    !s.batches.every(
      (b) =>
        b &&
        typeof b.id === "string" &&
        Number.isFinite(b.turn) &&
        typeof b.summary === "string" &&
        typeof b.core === "string" &&
        Array.isArray(b.sources) &&
        b.sources.length &&
        b.sources.every((r) => r && typeof r.id === "string" && typeof r.fingerprint === "string") &&
        Array.isArray(b.facts) &&
        b.facts.every(
          (f) =>
            f &&
            typeof f.id === "string" &&
            typeof f.content === "string" &&
            typeof f.key === "string" &&
            Array.isArray(f.sourceIds) &&
            (f.audience === "shared" || Array.isArray(f.audience)),
        ),
    )
  )
    return emptyCommittedMemory(chatId);
  // Ignore malformed optional derived data without discarding compatible canonical memories.
  const keywords = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((word): word is string => typeof word === "string" && word.length <= 100).slice(0, 24)
      : undefined;
  return {
    ...s,
    batches: s.batches.map((b) => ({
      ...b,
      gist: typeof b.gist === "string" ? b.gist : undefined,
      gistKo: typeof b.gistKo === "string" ? b.gistKo : undefined,
      keywords: keywords(b.keywords),
      facts: b.facts.map((f) => ({ ...f, keywords: keywords(f.keywords) })),
    })),
  };
}
export function memoryFactIdentity(f: Pick<CommittedMemoryFact, "kind" | "key" | "audience">): string {
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
  return next;
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
export function selectCommittedMemory(
  state: CommittedMemoryState,
  queryText: string,
  excludedIds: readonly string[] = [],
  budget = 8000,
  audienceIds: readonly string[] = [],
  semanticScores: ReadonlyMap<string, number> = new Map(),
) {
  const config = state.recall ?? {};
  const recentWindow = config.recentMessages ?? 30;
  const longWindow = Math.max(recentWindow, config.longTermMessages ?? 300);
  const excluded = new Set(excludedIds);
  const valid = state.batches.filter((b) => !b.invalidated && !b.sources.some((s) => excluded.has(s.id)));
  const newest = Math.max(0, ...valid.map((b) => b.turn));
  const query = memoryTerms(queryText);
  const candidates: Array<CommittedMemorySelection & { score: number }> = [];
  const current = new Map<string, CommittedMemoryBatch["facts"][number]>();
  for (const batch of [...state.batches].filter((b) => !b.invalidated).sort((a, b) => a.turn - b.turn))
    for (const fact of batch.facts) {
      if (fact.audience !== "shared" && (!audienceIds.length || !audienceIds.every((id) => fact.audience.includes(id))))
        continue;
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
      current.set(memoryFactIdentity(value), batch.excluded ? { ...value, excluded: true } : value);
    }

  for (const f of current.values())
    if (
      f.status === "current" &&
      f.progress !== "completed" &&
      f.progress !== "cancelled" &&
      !f.excluded &&
      !f.invalidated &&
      !(f.dependencies ?? []).some((s) => excluded.has(s.id))
    )
      candidates.push({
        id: f.id,
        content: `[${f.kind}${f.kind === "promise" ? `:${f.progress ?? "pending"}` : ""}] ${f.content}`,
        displayKo: f.contentKo,
        reason: "current",
        sourceIds: f.sourceIds,
        score:
          (f.kind === "promise" ? 4 : 2) +
          relevance([f.key, f.content, f.contentKo, f.keyKo, ...(f.keywords ?? [])].filter(Boolean).join(" "), query) +
          Math.max(0, semanticScores.get(f.id) ?? 0),
      });
  const correctedKeys = new Set(
    [...current.values()].filter((f) => f.excluded || f.edited || f.invalidated).map(memoryFactIdentity),
  );
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
      candidates.push({
        id: b.id,
        content: `[Earlier episode ${b.turn}] ${content}`,
        displayKo,
        stage,
        reason: recent ? "recent" : "relevant",
        sourceIds: b.sources.map((s) => s.id),
        score: (recent ? 1 : 0) + score,
      });
  }
  let selected: CommittedMemorySelection[] = [];
  const seen = new Set<string>();
  for (const item of candidates.sort((a, b) => b.score - a.score)) {
    const key = item.content.normalize("NFKC").trim();
    if (seen.has(key)) continue;
    if (item.reason !== "current" && selected.filter((i) => i.reason !== "current").length >= (config.topK ?? 20))
      continue;
    const { score: _score, ...selection } = item;
    const text = renderCommittedMemory([...selected, selection]);
    if (
      config.tokenBudget !== undefined
        ? estimateTextTokens(text) > config.tokenBudget
        : Buffer.byteLength(text, "utf8") > budget
    )
      continue;
    seen.add(key);
    selected.push(selection);
  }
  // Retrieval priority decides inclusion; episode chronology decides presentation.
  const order = new Map(valid.map((b) => [b.id, b.turn]));
  selected = [
    ...selected.filter((i) => i.reason === "current"),
    ...selected.filter((i) => i.reason !== "current").sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)),
  ];
  const text = renderCommittedMemory(selected);
  return {
    selected,
    text,
    usedBytes: Buffer.byteLength(text, "utf8"),
    budgetBytes: budget,
    usedTokens: estimateTextTokens(text),
    budgetTokens: config.tokenBudget ?? null,
    tokenCountMethod: "unicode-estimate" as const,
  };
}
function renderCommittedMemory(selected: CommittedMemorySelection[]) {
  const facts = selected.filter((i) => i.reason === "current");
  const episodes = selected.filter((i) => i.reason !== "current");
  return [
    facts.length
      ? `<current_facts_and_obligations>\n${facts.map((i) => i.content).join("\n")}\n</current_facts_and_obligations>`
      : "",
    episodes.length ? `<story_chronology>\n${episodes.map((i) => i.content).join("\n\n")}\n</story_chronology>` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
