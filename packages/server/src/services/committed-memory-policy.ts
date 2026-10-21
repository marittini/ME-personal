import { createHash } from "node:crypto";
import type { CommittedMemoryBatch, CommittedMemoryState, CommittedMemorySelection } from "@marinara-engine/shared";
export interface MemorySourceMessage {
  id: string; content: string; role: string; activeSwipeIndex?: number; characterId?: string | null; extra?: unknown;
}
export function memoryExtra(value: unknown): Record<string, unknown> {
  if (typeof value === "string") { try { return memoryExtra(JSON.parse(value)); } catch { return {}; } }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function memoryFingerprint(message: MemorySourceMessage): string {
  const extra = memoryExtra(message.extra);
  return createHash("sha256").update(JSON.stringify([message.content, message.role, message.activeSwipeIndex ?? 0,
    message.characterId ?? null, extra.hiddenFromAI === true, extra.hiddenFromAICharacterIds ?? [], extra.roleplayCommandActivity ?? []])).digest("hex");
}
export function emptyCommittedMemory(chatId: string): CommittedMemoryState {
  return {version: 1, ownerChatId: chatId, enabled: false, batches: []};
}
export function readCommittedMemory(metadata: Record<string, unknown>, chatId: string): CommittedMemoryState {
  const state = metadata.committedMemory as CommittedMemoryState | undefined;
  // Copies cannot silently inherit another room's source identities.
  if (state?.version !== 1 || state.ownerChatId !== chatId || !Array.isArray(state.batches)) return emptyCommittedMemory(chatId);
  if (!state.batches.every(b => b && typeof b.id === "string" && Number.isFinite(b.turn) && typeof b.summary === "string" && typeof b.core === "string" && Array.isArray(b.sources) && b.sources.length && b.sources.every(s => typeof s.id === "string" && typeof s.fingerprint === "string") && Array.isArray(b.facts) && b.facts.every(f => f && typeof f.content === "string" && typeof f.key === "string" && typeof f.id === "string" && Array.isArray(f.sourceIds) && (f.audience === "shared" || Array.isArray(f.audience))))) return emptyCommittedMemory(chatId);
  return state;
}
export function reconcileCommittedMemory(state: CommittedMemoryState, messages: readonly MemorySourceMessage[]): CommittedMemoryState {
  const fingerprints = new Map(messages.map(m => [m.id, memoryFingerprint(m)]));
  return {...state, batches: state.batches.map(b => b.invalidated || b.sources.every(s => fingerprints.get(s.id) === s.fingerprint) ? b : {...b, invalidated: true})};
}
export function pendingMemoryMessages(state: CommittedMemoryState, messages: readonly MemorySourceMessage[]) {
  const covered = new Set(state.batches.filter(b => !b.invalidated).flatMap(b => b.sources.map(s => s.id)));
  return messages.filter(m => !covered.has(m.id) && (m.role === "user" || m.role === "assistant") && m.content.trim() && memoryExtra(m.extra).hiddenFromAI !== true);
}
function terms(text: string) {
  return new Set((text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).flatMap(word => {
    const chars = Array.from(word); return [word, ...chars.slice(1).map((c,i) => chars[i] + c)];
  }));
}
function relevance(text: string, query: Set<string>) {
  const tokens = terms(text);
  return [...query].filter(t => tokens.has(t)).length / Math.max(1, Math.sqrt(tokens.size * query.size));
}
export function selectCommittedMemory(state: CommittedMemoryState, queryText: string, excludedIds: readonly string[] = [], budget = 8000, audienceIds: readonly string[] = [], semanticScores: ReadonlyMap<string, number> = new Map()) {
  const excluded = new Set(excludedIds);
  const valid = state.batches.filter(b => !b.invalidated && !b.sources.some(s => excluded.has(s.id)));
  const newest = Math.max(0, ...valid.map(b => b.turn));
  const query = terms(queryText);
  const candidates: Array<CommittedMemorySelection & {score: number}> = [];
  const current = new Map<string, CommittedMemoryBatch["facts"][number]>();
  for (const batch of [...valid].sort((a,b) => a.turn-b.turn)) for (const fact of batch.facts) {
    if (fact.audience !== "shared" && (!audienceIds.length || !audienceIds.every(id => fact.audience.includes(id)))) continue;
    current.set(`${fact.kind}:${fact.key.normalize("NFKC").toLowerCase()}`, fact);
  }
  for (const fact of current.values()) {
    // A later uncertain update quarantines the previous value rather than reviving it.
    if (fact.status !== "current") continue;
    candidates.push({id: fact.id, content: `[${fact.kind}] ${fact.content}`, reason: "current", sourceIds: fact.sourceIds, score: (fact.kind === "promise" ? 4 : 2) + relevance(fact.content,query)});
  }
  for (const batch of valid) {
    const recent = newest - batch.turn < 30;
    const content = recent ? batch.summary : batch.core;
    if (!content) continue;
    const score = relevance(content,query) + Math.max(0, semanticScores.get(batch.id) ?? 0);
    if (recent || score > 0) candidates.push({id: batch.id, content: `[Earlier episode ${batch.turn}] ${content}`, reason: recent ? "recent" : "relevant", sourceIds: batch.sources.map(s => s.id), score: (recent ? 1 : 0) + score});
  }
  const selected: CommittedMemorySelection[] = [];
  const seen = new Set<string>(); let usedBytes = 0;
  for (const item of candidates.sort((a,b) => b.score-a.score)) {
    const key = item.content.normalize("NFKC").trim();
    const bytes = Buffer.byteLength(item.content,"utf8") + 32;
    if (seen.has(key) || usedBytes + bytes > budget) continue;
    seen.add(key); usedBytes += bytes;
    const {score: _score, ...selection} = item; selected.push(selection);
  }
  return {selected, text: selected.map(i => i.content).join("\n\n"), usedBytes, budgetBytes: budget};
}
