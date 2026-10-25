import type { CommittedMemoryFact } from "../types/committed-memory.js";

/** A thread or promise with no new development for this many committed batches is stalled. */
export const COMMITTED_MEMORY_STALL_BATCHES = 5;

/** The newest message position at which a thread moved: its own value or its newest clue. */
export function threadLastActivity(fact: Pick<CommittedMemoryFact, "clues">, valueTurn: number) {
  return Math.max(valueTurn, ...(fact.clues ?? []).map((clue) => clue.turn));
}

/**
 * True when an open thread or promise has had no development for COMMITTED_MEMORY_STALL_BATCHES batches.
 * `batchTurns` are the positions of the committed (valid) batches. Computed, never stored, so it clears itself
 * the moment the thread moves again.
 */
export function threadStalled(
  fact: Pick<CommittedMemoryFact, "kind" | "status" | "progress" | "clues">,
  valueTurn: number,
  batchTurns: readonly number[],
) {
  if (fact.kind !== "thread" && fact.kind !== "promise") return false;
  if (fact.status !== "current" || fact.progress === "completed" || fact.progress === "cancelled") return false;
  const last = threadLastActivity(fact, valueTurn);
  return batchTurns.filter((turn) => turn > last).length >= COMMITTED_MEMORY_STALL_BATCHES;
}
