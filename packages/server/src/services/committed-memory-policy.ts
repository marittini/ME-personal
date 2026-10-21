import { createHash } from "node:crypto";
import type { CommittedMemoryBatch, CommittedMemoryState, CommittedMemorySelection } from "@marinara-engine/shared";
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
  return s;
}
export function reconcileCommittedMemory(
  state: CommittedMemoryState,
  messages: readonly MemorySourceMessage[],
): CommittedMemoryState {
  const fingerprints = new Map(messages.map((m) => [m.id, memoryFingerprint(m)]));
  return {
    ...state,
    batches: state.batches.map((b) =>
      b.invalidated || b.sources.every((s) => fingerprints.get(s.id) === s.fingerprint)
        ? b
        : { ...b, invalidated: true },
    ),
  };
}
export function pendingMemoryMessages(state: CommittedMemoryState, messages: readonly MemorySourceMessage[]) {
  const covered = new Set(state.batches.filter((b) => !b.invalidated).flatMap((b) => b.sources.map((s) => s.id)));
  return messages.filter(
    (m) =>
      !covered.has(m.id) &&
      (m.role === "user" || m.role === "assistant") &&
      m.content.trim() &&
      memoryExtra(m.extra).hiddenFromAI !== true,
  );
}
function terms(text: string) {
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
  const tokens = terms(text);
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
  const excluded = new Set(excludedIds);
  const valid = state.batches.filter((b) => !b.invalidated && !b.sources.some((s) => excluded.has(s.id)));
  const newest = Math.max(0, ...valid.map((b) => b.turn));
  const query = terms(queryText);
  const candidates: Array<CommittedMemorySelection & { score: number }> = [];
  const current = new Map<string, CommittedMemoryBatch["facts"][number]>();
  for (const batch of [...valid].sort((a, b) => a.turn - b.turn))
    for (const f of batch.facts) {
      if (f.audience !== "shared" && (!audienceIds.length || !audienceIds.every((id) => f.audience.includes(id))))
        continue;
      current.set(`${f.kind}:${f.key.normalize("NFKC").toLowerCase()}`, f);
    }
  for (const f of current.values())
    if (f.status === "current")
      candidates.push({
        id: f.id,
        content: `[${f.kind}] ${f.content}`,
        reason: "current",
        sourceIds: f.sourceIds,
        score: (f.kind === "promise" ? 4 : 2) + relevance(f.content, query),
      });
  for (const b of valid) {
    const recent = newest - b.turn < 30;
    const content = recent ? b.summary : b.core;
    if (!content) continue;
    const score = relevance(content, query) + Math.max(0, semanticScores.get(b.id) ?? 0);
    if (recent || score > 0)
      candidates.push({
        id: b.id,
        content: `[Earlier episode ${b.turn}] ${content}`,
        reason: recent ? "recent" : "relevant",
        sourceIds: b.sources.map((s) => s.id),
        score: (recent ? 1 : 0) + score,
      });
  }
  const selected: CommittedMemorySelection[] = [];
  const seen = new Set<string>();
  let usedBytes = 0;
  for (const item of candidates.sort((a, b) => b.score - a.score)) {
    const key = item.content.normalize("NFKC").trim();
    const bytes = Buffer.byteLength(item.content, "utf8") + 32;
    if (seen.has(key) || usedBytes + bytes > budget) continue;
    seen.add(key);
    usedBytes += bytes;
    const { score: _score, ...selection } = item;
    selected.push(selection);
  }
  return { selected, text: selected.map((i) => i.content).join("\n\n"), usedBytes, budgetBytes: budget };
}
