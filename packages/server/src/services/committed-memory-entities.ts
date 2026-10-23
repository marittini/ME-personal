import { randomUUID } from "node:crypto";
import type {
  CommittedMemoryBatch,
  CommittedMemoryCommitRecord,
  CommittedMemoryEntity,
  CommittedMemoryFact,
  CommittedMemoryState,
} from "@marinara-engine/shared";
import { consolidateCommittedMemory, memoryFactIdentity, sameMemoryValue } from "./committed-memory-policy.js";

export const ENTITY_KINDS = ["person", "object", "place", "group", "concept"] as const;
const COMMIT_LOG_LIMIT = 20;

export function normalizeEntityName(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}
function entityNames(entity: Pick<CommittedMemoryEntity, "name" | "aliases">) {
  return [entity.name, ...entity.aliases].map(normalizeEntityName).filter(Boolean);
}

/** Entities whose name or an alias appears in the text (used to show the model what it may update). */
export function mentionedEntities(entities: readonly CommittedMemoryEntity[], text: string) {
  const scene = normalizeEntityName(text);
  const direct = entities.filter((entity) => entityNames(entity).some((name) => scene.includes(name)));
  // Entities sharing a name with a mentioned one come too, so the model can tell them apart by ID.
  const names = new Set(direct.flatMap(entityNames));
  return entities.filter((entity) => direct.includes(entity) || entityNames(entity).some((name) => names.has(name)));
}

export type ExtractedEntityRef = { name: string; aliases?: string[]; kind?: (typeof ENTITY_KINDS)[number] };

/**
 * Attach extracted facts to entities. Only an existing entity ID the model names joins an existing entity. A new
 * entity whose name or alias another entity already uses is created separately and flagged as a possible
 * namesake for the user to merge or keep apart; it is never merged automatically.
 */
export function resolveExtractedEntities<
  T extends { entityId?: string; entity?: ExtractedEntityRef; attribute?: string },
>(facts: T[], entities: readonly CommittedMemoryEntity[], now = new Date().toISOString()) {
  const next = entities.map((entity) => ({ ...entity, aliases: [...entity.aliases] }));
  const created = new Map<string, CommittedMemoryEntity>();
  const modified = new Set<string>();
  const resolved = facts.map((fact) => {
    const { entity: ref, ...rest } = fact;
    if (fact.entityId) {
      const known = next.find((entity) => entity.id === fact.entityId);
      if (!known) throw new Error("Memory references an unknown entity");
      // New aliases the model learned for a known entity identify it in later scenes.
      const fresh = (ref?.aliases ?? []).filter(
        (alias) => alias.trim() && !entityNames(known).includes(normalizeEntityName(alias)),
      );
      if (fresh.length) {
        known.aliases = [...known.aliases, ...fresh.map((alias) => alias.trim())].slice(0, 24);
        modified.add(known.id);
      }
      return { ...rest, entityId: known.id } as Omit<T, "entity">;
    }
    if (!ref?.name?.trim()) return rest as Omit<T, "entity">;
    const key = normalizeEntityName(ref.name);
    let entity = created.get(key);
    if (!entity) {
      const names = [ref.name, ...(ref.aliases ?? [])].map(normalizeEntityName).filter(Boolean);
      const namesakes = next.filter((other) => entityNames(other).some((name) => names.includes(name)));
      entity = {
        id: randomUUID(),
        name: ref.name.trim(),
        aliases: [...new Set((ref.aliases ?? []).map((alias) => alias.trim()).filter(Boolean))]
          .filter((alias) => normalizeEntityName(alias) !== key)
          .slice(0, 24),
        kind: ENTITY_KINDS.includes(ref.kind as never) ? ref.kind! : "concept",
        createdAt: now,
        ...(namesakes.length ? { homonymOf: namesakes.map((other) => other.id) } : {}),
      };
      created.set(key, entity);
      next.push(entity);
    }
    return { ...rest, entityId: entity.id } as Omit<T, "entity">;
  });
  return { facts: resolved, entities: next, added: [...created.values()].map((e) => e.id), modified: [...modified] };
}

const batchJson = (batch: CommittedMemoryBatch) => JSON.stringify({ ...batch, revision: undefined });

/**
 * Record one confirmed change so it can be undone: the batches it removed or modified as they were, the ones it
 * added, and their revisions right after. Changed batches get a new revision.
 */
export function recordCommittedChange(
  before: CommittedMemoryState,
  after: CommittedMemoryState,
  kind: CommittedMemoryCommitRecord["kind"],
  addedEntities: string[] = [],
  modifiedEntities: string[] = [],
): CommittedMemoryState {
  const previous = new Map(before.batches.map((batch) => [batch.id, batch]));
  const afterIds = new Set(after.batches.map((batch) => batch.id));
  const added: string[] = [];
  const changedBefore: CommittedMemoryBatch[] = [];
  const batches = after.batches.map((batch) => {
    const old = previous.get(batch.id);
    if (!old) {
      added.push(batch.id);
      return { ...batch, revision: randomUUID() };
    }
    if (batchJson(old) === batchJson(batch)) return batch;
    changedBefore.push(structuredClone(old));
    return { ...batch, revision: randomUUID() };
  });
  for (const old of before.batches) if (!afterIds.has(old.id)) changedBefore.push(structuredClone(old));
  const afterRevisions: Record<string, string> = {};
  for (const batch of batches)
    if (added.includes(batch.id) || changedBefore.some((old) => old.id === batch.id))
      afterRevisions[batch.id] = batch.revision!;
  const record: CommittedMemoryCommitRecord = {
    id: randomUUID(),
    at: new Date().toISOString(),
    kind,
    before: changedBefore,
    added,
    after: afterRevisions,
    entitiesBefore: (before.entities ?? []).filter((entity) => modifiedEntities.includes(entity.id)),
    addedEntities,
    summary: {
      facts: batches.filter((b) => added.includes(b.id)).flatMap((b) => b.facts).length,
      entities: addedEntities.length,
    },
  };
  return { ...after, batches, commits: [...(after.commits ?? []), record].slice(-COMMIT_LOG_LIMIT) };
}

/** Undo one recorded change, if nothing recorded later has changed the same batches since. */
export function undoCommittedChange(state: CommittedMemoryState, commitId: string): CommittedMemoryState {
  const record = state.commits?.find((commit) => commit.id === commitId);
  if (!record) throw Object.assign(new Error("That change is no longer in the history"), { statusCode: 404 });
  const current = new Map(state.batches.map((batch) => [batch.id, batch]));
  for (const [id, revision] of Object.entries(record.after))
    if (current.get(id)?.revision !== revision)
      throw Object.assign(new Error("A later change depends on this one; undo the later change first"), {
        statusCode: 409,
      });
  const restored = new Map(record.before.map((batch) => [batch.id, batch]));
  const batches = [
    ...state.batches
      .filter((batch) => !record.added.includes(batch.id))
      .map((batch) => (restored.has(batch.id) ? restored.get(batch.id)! : batch)),
    ...record.before.filter((batch) => !current.has(batch.id)),
  ]
    .map((batch) => ({ ...batch, revision: randomUUID() }))
    .sort((a, b) => a.turn - b.turn);
  const used = new Set(batches.flatMap((batch) => batch.facts.map((fact) => fact.entityId)).filter(Boolean));
  const entitiesBefore = new Map(record.entitiesBefore.map((entity) => [entity.id, entity]));
  const present = new Set((state.entities ?? []).map((entity) => entity.id));
  const entities = [
    ...(state.entities ?? [])
      .filter((entity) => !record.addedEntities.includes(entity.id) || used.has(entity.id))
      .map((entity) => entitiesBefore.get(entity.id) ?? entity),
    // An entity this change removed (a merge) comes back.
    ...record.entitiesBefore.filter((entity) => !present.has(entity.id)),
  ];
  return {
    ...state,
    batches,
    entities,
    commits: (state.commits ?? []).filter((commit) => commit.id !== commitId),
  };
}

/**
 * "기억 정리(합치기)": merges only what is certainly the same — repeated copies of one value — and flags names
 * shared by different entities. Possible namesakes are only marked, never merged.
 */
export function organizeCommittedMemory(state: CommittedMemoryState) {
  const before = consolidateCommittedMemory(state);
  const next = structuredClone(before);
  let merged = 0;
  const kept = new Map<string, CommittedMemoryFact>();
  for (const batch of [...next.batches].sort((a, b) => b.turn - a.turn)) {
    if (batch.invalidated) continue;
    batch.facts = batch.facts.filter((fact) => {
      if (fact.invalidated || fact.edited || fact.excluded) return true;
      const group = JSON.stringify([fact.entityId ?? memoryFactIdentity({ ...fact, key: "" }), fact.kind]);
      const key = `${group}:${fact.content.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase()}`;
      const newer = kept.get(key);
      if (newer && sameMemoryValue(newer, fact)) {
        newer.sourceIds = [...new Set([...newer.sourceIds, ...fact.sourceIds])];
        newer.dependencies = [
          ...new Map([...(newer.dependencies ?? []), ...(fact.dependencies ?? [])].map((s) => [s.id, s])).values(),
        ];
        merged++;
        return false;
      }
      kept.set(key, fact);
      return true;
    });
  }
  const entities = (next.entities ?? []).map((entity) => {
    const namesakes = (next.entities ?? []).filter(
      (other) =>
        other.id !== entity.id &&
        entityNames(other).some((name) => entityNames(entity).includes(name)) &&
        !(entity.homonymOf ?? []).includes(other.id),
    );
    return namesakes.length
      ? { ...entity, homonymOf: [...(entity.homonymOf ?? []), ...namesakes.map((other) => other.id)] }
      : entity;
  });
  const flagged = entities.filter((entity, index) => entity !== (next.entities ?? [])[index]).map((e) => e.id);
  const organized = consolidateCommittedMemory({ ...next, entities });
  return {
    state: recordCommittedChange(before, organized, "organize", [], flagged),
    merged,
    flagged: flagged.length,
  };
}

/** The user's merge of two entities: facts move to the kept one; a shared slot keeps the newest value. */
export function mergeCommittedEntities(state: CommittedMemoryState, fromId: string, intoId: string) {
  const from = state.entities?.find((entity) => entity.id === fromId);
  const into = state.entities?.find((entity) => entity.id === intoId);
  if (!from || !into || fromId === intoId)
    throw Object.assign(new Error("Choose two different entities to merge"), { statusCode: 400 });
  const before = consolidateCommittedMemory(state);
  const next = structuredClone(before);
  for (const batch of next.batches)
    for (const fact of batch.facts) if (fact.entityId === fromId) fact.entityId = intoId;
  const merged: CommittedMemoryEntity = {
    ...into,
    aliases: [
      ...new Set(
        [...into.aliases, from.name, ...from.aliases].filter(
          (a) => normalizeEntityName(a) !== normalizeEntityName(into.name),
        ),
      ),
    ].slice(0, 24),
    homonymOf: (into.homonymOf ?? []).filter((id) => id !== fromId),
  };
  next.entities = (next.entities ?? [])
    .filter((entity) => entity.id !== fromId)
    .map((entity) =>
      entity.id === intoId
        ? merged
        : entity.homonymOf?.includes(fromId)
          ? { ...entity, homonymOf: entity.homonymOf.filter((id) => id !== fromId) }
          : entity,
    );
  const modified = (before.entities ?? []).filter((entity) => entity.id !== fromId).map((entity) => entity.id);
  const result = recordCommittedChange(before, consolidateCommittedMemory(next), "merge", [], modified);
  // Undo must bring the merged-away entity back too.
  const record = result.commits!.at(-1)!;
  record.entitiesBefore = [...record.entitiesBefore, from];
  return result;
}

/** "다른 인물": the user confirms a possible namesake is someone else; the flag goes away. */
export function confirmDistinctEntity(state: CommittedMemoryState, entityId: string): CommittedMemoryState {
  if (!state.entities?.some((entity) => entity.id === entityId))
    throw Object.assign(new Error("Entity not found"), { statusCode: 404 });
  return {
    ...state,
    entities: state.entities.map((entity) =>
      entity.id === entityId
        ? { ...entity, homonymOf: undefined }
        : entity.homonymOf?.includes(entityId)
          ? { ...entity, homonymOf: entity.homonymOf.filter((id) => id !== entityId) }
          : entity,
    ),
  };
}

/** Overview counts: entities, current and history facts, namesakes and likely duplicates. */
export function committedMemoryCounts(state: CommittedMemoryState, waiting = 0) {
  const facts = state.batches.filter((b) => !b.invalidated).flatMap((b) => b.facts);
  const live = facts.filter((f) => !f.invalidated && !f.excluded);
  const values = new Map<string, number>();
  for (const fact of live) {
    const key = `${fact.entityId ?? ""}:${fact.kind}:${fact.content.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase()}`;
    values.set(key, (values.get(key) ?? 0) + 1);
  }
  return {
    entities: state.entities?.length ?? 0,
    currentFacts: live.filter((f) => f.status !== "resolved" && !f.archived).length,
    historyFacts:
      live.filter((f) => f.archived || f.status === "resolved").length +
      live.reduce((sum, f) => sum + (f.previous?.length ?? 0), 0),
    homonyms: (state.entities ?? []).filter((entity) => entity.homonymOf?.length).length,
    duplicateSuspects: [...values.values()].filter((count) => count > 1).reduce((sum, count) => sum + count - 1, 0),
    waiting,
  };
}
