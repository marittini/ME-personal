// Unified memory format 2: safe reading/writing, tiers under one budget, entity slots that update instead of
// multiplying, namesakes kept apart, knowledge boundaries, atomic and idempotent commits, undo and tidy-up.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directory = mkdtempSync(join(tmpdir(), "memory-v2-"));
process.env.DATA_DIR = directory;
process.env.FILE_STORAGE_DIR = join(directory, "storage");
process.env.NODE_ENV = "test";
process.env.MARINARA_LITE = "true";
process.env.LOG_LEVEL = "silent";
const { getDB, closeDB } = await import("../../packages/server/src/db/connection.js");
const { createChatsStorage } = await import("../../packages/server/src/services/storage/chats.storage.js");
const { createConnectionsStorage } = await import("../../packages/server/src/services/storage/connections.storage.js");
const memory = await import("../../packages/server/src/services/committed-memory.js");
const policy = await import("../../packages/server/src/services/committed-memory-policy.js");
const entities = await import("../../packages/server/src/services/committed-memory-entities.js");
import type {
  CommittedMemoryBatch,
  CommittedMemoryFact,
  CommittedMemoryState,
} from "../../packages/shared/src/types/committed-memory.js";

// ── Pure policy ──
const fact = (id: string, over: Partial<CommittedMemoryFact> = {}): CommittedMemoryFact => ({
  id,
  kind: "fact",
  key: id,
  content: `${id} content`,
  status: "current",
  audience: "shared",
  sourceIds: ["m1"],
  ...over,
});
const batch = (id: string, turn: number, facts: CommittedMemoryFact[], over: Partial<CommittedMemoryBatch> = {}) => ({
  id,
  turn,
  createdAt: "2026-10-24T00:00:00.000Z",
  sources: [{ id: `src-${id}`, fingerprint: `fp-${id}` }],
  summary: "",
  core: "",
  facts,
  ...over,
});
const base = (batches: CommittedMemoryBatch[], over: Partial<CommittedMemoryState> = {}): CommittedMemoryState => ({
  version: 2,
  ownerChatId: "room",
  enabled: true,
  batches,
  ...over,
});

// One malformed batch no longer empties the memory; it is set aside and written back untouched.
const broken = { id: 42, turn: "x" };
const readable = policy.readCommittedMemory(
  {
    committedMemory: {
      ...base([batch("good", 1, [fact("kept")])]),
      batches: [batch("good", 1, [fact("kept")]), broken],
    },
  },
  "room",
);
assert.equal(readable.batches.length, 1);
assert.deepEqual(readable.quarantine, [broken]);
const stored = policy.storedCommittedMemory(readable, { committedMemory: { ...base([]), version: 1 } }, "room");
assert.equal(stored.version, 2);
assert.deepEqual(stored.quarantine, [broken], "set-aside batches are written back as they were");
assert.deepEqual(
  (stored.legacyBackup as { version: number }).version,
  1,
  "format 1 is backed up once on the first write",
);
// An unreadable memory of this chat is never overwritten.
assert.equal(
  policy.committedMemoryReadability({ committedMemory: { version: 9, ownerChatId: "room" } }, "room"),
  "unreadable",
);
assert.throws(
  () => policy.storedCommittedMemory(base([]), { committedMemory: { version: 9, ownerChatId: "room" } }, "room"),
  /not overwritten/,
);
assert.equal(
  policy.committedMemoryReadability({ committedMemory: { ...base([]), ownerChatId: "parent" } }, "room"),
  "foreign",
);

// Tiers: promises always (own budget, the rest wait), other facts only when called, one token budget.
const promise = fact("promise", { kind: "promise", content: "Alice will return the book.", progress: "in_progress" });
const locker = fact("locker", {
  content: "Jihee keeps a note in her locker.",
  keywords: ["note"],
  combos: [["Jihee", "locker"]],
});
const quiet = fact("quiet", { content: "The lighthouse keeper hums.", keywords: ["lighthouse"] });
const tiered = base([batch("b1", 1, [promise, locker, quiet])]);
let selection = policy.selectCommittedMemory(tiered, "Nothing relevant here.");
assert(selection.text.includes("return the book"), "promises come up every turn");
assert(!selection.text.includes("locker"), "recall facts stay out until the scene calls them");
assert(
  policy.selectCommittedMemory(tiered, "Jihee opened her locker.").text.includes("locker"),
  "a combination calls a fact",
);
assert(
  !policy.selectCommittedMemory(tiered, "Only Jihee walked by.").text.includes("locker"),
  "half a combination does not",
);
assert(policy.selectCommittedMemory(tiered, "a NOTE fell").text.includes("locker"), "any single keyword calls a fact");
selection = policy.selectCommittedMemory({ ...tiered, recall: { alwaysTokens: 1 } }, "");
assert.deepEqual(selection.waiting, ["promise"], "an always fact over its budget waits instead of being dropped");
assert(!selection.text.includes("return the book"));
const many = base([
  batch(
    "b1",
    1,
    Array.from({ length: 20 }, (_, i) => fact(`f${i}`, { keywords: ["storm"] })),
  ),
]);
assert.equal(
  policy
    .selectCommittedMemory({ ...many, recall: { recallLimit: 5 } }, "storm")
    .selected.filter((s) => s.tier === "recall").length,
  5,
);
assert(policy.selectCommittedMemory(many, "storm").usedTokens <= 2400, "one token budget");

// Knowledge: one character sees only what they know; several at once get the secret as a marked boundary.
const secret = fact("secret", { content: "The ring is fake.", audience: ["alice"], activation: "always" });
const known = base([batch("b1", 1, [secret])]);
assert(!policy.selectCommittedMemory(known, "", [], 8000, ["bob"]).text.includes("ring is fake"));
assert(policy.selectCommittedMemory(known, "", [], 8000, ["alice"]).text.includes("ring is fake"));
const boundary = policy.selectCommittedMemory(
  known,
  "",
  [],
  8000,
  ["alice", "bob"],
  new Map(),
  new Map([
    ["alice", "Alice"],
    ["bob", "Bob"],
  ]),
);
assert.match(boundary.text, /<knowledge_boundaries>[\s\S]*The ring is fake\. \(known by: Alice; not known by: Bob\)/u);
// The secret comes out: the same entity slot with a wider audience updates in place.
const ringEntity = { entityId: "ring", attribute: "authenticity" };
const revealed = policy.consolidateCommittedMemory(
  base([
    batch("b1", 1, [
      fact("secret", { ...ringEntity, content: "The ring is fake.", audience: ["alice"], activation: "always" }),
    ]),
    batch("b2", 2, [
      fact("reveal", { ...ringEntity, content: "The ring is fake.", audience: ["alice", "bob"], activation: "always" }),
    ]),
  ]),
);
assert.equal(revealed.batches.flatMap((b) => b.facts).length, 1, "a revealed secret is the same memory, not a new one");
assert(policy.selectCommittedMemory(revealed, "", [], 8000, ["bob"]).text.includes("ring is fake"), "Bob knows it now");
assert(
  !policy.selectCommittedMemory(revealed, "", [], 8000, ["alice", "bob"]).text.includes("<knowledge_boundaries>"),
  "no longer a secret between them",
);

// Entity slots update instead of multiplying; the same value adds nothing; the cap moves extras to history.
const slot = { entityId: "sword", attribute: "owner" };
const updated = policy.consolidateCommittedMemory(
  base([
    batch("b1", 1, [fact("o1", { ...slot, content: "Liam owns the sword." })]),
    batch("b2", 2, [fact("o2", { ...slot, content: "Mira owns the sword." })]),
    batch("b3", 3, [fact("o3", { ...slot, content: "Mira owns the sword." })]),
  ]),
);
const owners = updated.batches.flatMap((b) => b.facts);
assert.equal(owners.length, 1, "one slot, one current fact");
assert.equal(owners[0]!.content, "Mira owns the sword.");
assert.equal(owners[0]!.previous?.length, 1, "the old value moved to history; the repeat added nothing");
const crowded = policy.consolidateCommittedMemory(
  base([
    batch(
      "b1",
      1,
      Array.from({ length: 11 }, (_, i) => fact(`a${i}`, { entityId: "mira", attribute: `trait${i}` })),
    ),
  ]),
);
assert.equal(crowded.batches[0]!.facts.filter((f) => f.archived).length, 3, "at most 8 current facts per entity");
assert(!policy.selectCommittedMemory(crowded, "a0 content a1 content a2 content").text.includes("archived"));

// Namesakes: only an ID the model names joins an existing entity; the same name alone stays separate, flagged.
const known1 = [{ id: "liam-1", name: "Liam", aliases: ["리암"], kind: "person" as const, createdAt: "x" }];
const byId = entities.resolveExtractedEntities(
  [{ entityId: "liam-1", entity: { name: "Liam", aliases: ["Lee"] } }],
  known1,
);
assert.equal(byId.facts[0]!.entityId, "liam-1");
assert.deepEqual(byId.entities[0]!.aliases, ["리암", "Lee"]);
const byName = entities.resolveExtractedEntities(
  [{ entity: { name: "리암", kind: "person" } }, { entity: { name: "리암" } }],
  known1,
);
assert.notEqual(byName.facts[0]!.entityId, "liam-1", "a namesake is never merged automatically");
assert.equal(byName.facts[0]!.entityId, byName.facts[1]!.entityId, "one new entity per name within a batch");
assert.deepEqual(byName.entities.at(-1)!.homonymOf, ["liam-1"], "and is flagged for the user");
assert.throws(() => entities.resolveExtractedEntities([{ entityId: "nobody" }], known1), /unknown entity/);

// Undo restores exactly what a change replaced; a later change on the same batch blocks it.
const before = base([batch("b1", 1, [fact("o1", { ...slot, content: "Liam owns the sword." })])], { entities: known1 });
const afterCommit = entities.recordCommittedChange(
  before,
  policy.consolidateCommittedMemory({
    ...before,
    batches: [...before.batches, batch("b2", 2, [fact("o2", { ...slot, content: "Mira owns the sword." })])],
  }),
  "commit",
);
assert.equal(afterCommit.commits!.length, 1);
const undone = entities.undoCommittedChange(afterCommit, afterCommit.commits![0]!.id);
assert.deepEqual(
  undone.batches.map((b) => [b.id, b.facts.map((f) => f.content)]),
  [["b1", ["Liam owns the sword."]]],
);
const later = {
  ...afterCommit,
  batches: afterCommit.batches.map((b) => (b.id === "b2" ? { ...b, revision: "edited" } : b)),
};
assert.throws(() => entities.undoCommittedChange(later, afterCommit.commits![0]!.id), /later change/);
// Tidy-up merges repeated copies, flags namesakes, and is undoable.
const messy = base(
  [
    batch("b1", 1, [fact("d1", { key: "k1", content: "Mira likes tea." })]),
    batch("b2", 2, [fact("d2", { key: "k2", content: "Mira likes tea." })]),
  ],
  { entities: [...known1, { id: "liam-2", name: "Liam", aliases: [], kind: "person", createdAt: "x" }] },
);
const organized = entities.organizeCommittedMemory(messy);
assert.equal(organized.merged, 1);
assert.equal(organized.state.batches.flatMap((b) => b.facts).length, 1);
assert.equal(organized.flagged, 2, "both entities named Liam are marked");
assert.equal(
  entities.undoCommittedChange(organized.state, organized.state.commits!.at(-1)!.id).batches.flatMap((b) => b.facts)
    .length,
  2,
);

// ── Through the service with a scripted model ──
const db = await getDB();
const chats = createChatsStorage(db);
let failNext = false;
/** The ID of the entity the model recognises, when it names it. */
let knownEntityId: string | undefined;
let calls = 0;
const provider = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const request = JSON.parse(Buffer.concat(chunks).toString());
  const transcript = JSON.parse(request.messages[1].content) as Array<{ id: string; content: string }>;
  calls++;
  if (failNext) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: { message: "fixture failure" } }));
    return;
  }
  const content = {
    summary: transcript.map((m) => m.content).join(" "),
    core: "The sword changed hands.",
    summaryKo: "칼의 주인이 바뀌었다",
    coreKo: "칼의 주인이 바뀌었다",
    facts: [
      {
        kind: "fact",
        key: "sword owner",
        keyKo: "칼 주인",
        content: "Mira owns the sword.",
        contentKo: "미라가 칼을 가졌다",
        status: "current",
        audience: "shared",
        sourceIds: [transcript[0]!.id],
        attribute: "owner",
        ...(knownEntityId
          ? { entityId: knownEntityId }
          : { entity: { name: "Sword", aliases: ["칼"], kind: "object" } }),
      },
    ],
  };
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      choices: [{ message: { role: "assistant", content: JSON.stringify(content) }, finish_reason: "stop" }],
    }),
  );
});
async function finish(id: string) {
  const until = Date.now() + 15000;
  while ((await memory.committedMemoryStatus(db, id)).state.job?.status === "running") {
    if (Date.now() > until) throw new Error("Memory job timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return memory.committedMemoryStatus(db, id);
}
try {
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();
  assert(address && typeof address === "object");
  await createConnectionsStorage(db).create({
    name: "Memory v2 fixture",
    provider: "custom",
    model: "fixture",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: "fixture",
    isDefault: true,
  });
  const chat = await chats.create({ name: "Memory v2", mode: "roleplay", characterIds: [] });
  assert(chat);
  await chats.patchMetadata(chat.id, { committedMemoryBatchSize: 1 });
  await chats.createMessage({
    chatId: chat.id,
    role: "assistant",
    characterId: null,
    content: "Mira takes the sword.",
  });
  // Nothing runs until the user asks.
  assert.equal((await memory.committedMemoryStatus(db, chat.id)).state.batches.length, 0);
  await memory.startCommittedMemory(db, chat.id);
  let status = await finish(chat.id);
  assert.equal(status.state.job?.status, "complete");
  assert.equal(status.state.version, 2);
  assert.equal(status.state.entities?.length, 1);
  assert.equal(status.counts?.currentFacts, 1);
  const firstCommit = status.state.commits?.at(-1);
  // The status lists changes without their undo snapshots (sent every refresh); the stored record keeps them.
  assert(firstCommit && firstCommit.kind === "commit" && !("before" in firstCommit) && !("added" in firstCommit));
  const storedCommits = (
    policy.memoryExtra((await chats.getById(chat.id))!.metadata).committedMemory as {
      commits: Array<{ added: string[] }>;
    }
  ).commits;
  assert.equal(storedCommits.at(-1)!.added.length, 1);

  // A failing batch writes nothing; the memory stays exactly as it was.
  await chats.createMessage({
    chatId: chat.id,
    role: "assistant",
    characterId: null,
    content: "Mira sharpens the sword.",
  });
  const beforeFailure = JSON.stringify((await memory.committedMemoryStatus(db, chat.id)).state.batches);
  failNext = true;
  await memory.startCommittedMemory(db, chat.id);
  status = await finish(chat.id);
  assert.equal(status.state.job?.status, "failed");
  assert.equal(JSON.stringify(status.state.batches), beforeFailure, "a failed commit never touches existing memory");
  // Running again resumes from the failed batch only, and repeats create no duplicates.
  failNext = false;
  knownEntityId = status.state.entities![0]!.id;
  const callsBefore = calls;
  await memory.startCommittedMemory(db, chat.id);
  status = await finish(chat.id);
  assert.equal(status.state.job?.status, "complete");
  assert.equal(calls - callsBefore, 1, "already committed messages are skipped");
  assert.equal(
    status.state.batches.flatMap((b) => b.facts).length,
    1,
    "the same entity, attribute and value is not duplicated",
  );
  assert.equal(status.state.entities?.length, 1);
  assert.equal(status.state.batches.flatMap((b) => b.facts)[0]!.previous?.length ?? 0, 0, "and adds no history");
  // A later batch that only repeats the name, without the ID, gets a separate entity…
  knownEntityId = undefined;
  await chats.createMessage({
    chatId: chat.id,
    role: "assistant",
    characterId: null,
    content: "Another sword appears.",
  });
  await memory.startCommittedMemory(db, chat.id);
  status = await finish(chat.id);
  assert.equal(status.state.entities?.length, 2, "a new name without an ID is a separate entity…");
  assert.equal(status.counts?.homonyms, 1, "…flagged as a possible namesake");
  // The user keeps them apart or merges them.
  const flagged = status.state.entities!.find((e) => e.homonymOf?.length)!;
  status = await memory.mergeCommittedMemoryEntities(db, chat.id, flagged.id, flagged.homonymOf![0]!);
  assert.equal(status.state.entities?.length, 1);
  status = await memory.undoCommittedMemory(db, chat.id, status.state.commits!.at(-1)!.id);
  assert.equal(status.state.entities?.length, 2, "the merge is undoable");
  status = await memory.confirmDistinctCommittedMemoryEntity(db, chat.id, flagged.id);
  assert.equal(status.counts?.homonyms, 0);
  // Pinning and keywords are editable.
  const live = status.state.batches.flatMap((b) => b.facts.map((f) => ({ b, f }))).at(-1)!;
  status = await memory.editCommittedMemory(db, chat.id, {
    batchId: live.b.id,
    factId: live.f.id,
    expectedRevision: live.b.revision ?? live.b.createdAt,
    activation: "always",
    keywords: ["blade"],
    combos: [["Mira", "sword"]],
  });
  const edited = status.state.batches.flatMap((b) => b.facts).find((f) => f.id === live.f.id)!;
  assert.equal(edited.activation, "always");
  assert.deepEqual(edited.combos, [["Mira", "sword"]]);
  // An unreadable stored memory is reported and never overwritten.
  const odd = await chats.create({ name: "Odd", mode: "roleplay", characterIds: [] });
  assert(odd);
  await chats.patchMetadata(odd.id, () => ({ committedMemory: { version: 7, ownerChatId: odd.id, mystery: true } }));
  assert.equal((await memory.committedMemoryStatus(db, odd.id)).unreadable, true);
  await assert.rejects(memory.setCommittedMemoryEnabled(db, odd.id, true), /not overwritten/);
  assert.equal(
    (policy.memoryExtra((await chats.getById(odd.id))!.metadata).committedMemory as { mystery: boolean }).mystery,
    true,
  );

  // Memory runs only on request: generation never starts a commit, and in RP unified memory keeps advanced
  // memory and memory recall out of the prompt.
  const generation = readFileSync(
    new URL("../../packages/server/src/routes/generate.routes.ts", import.meta.url),
    "utf8",
  );
  assert(!generation.includes("startCommittedMemory("), "a reply never starts a memory commit");
  assert.match(generation, /advancedMemorySettings\.enabled && !unifiedMemoryEnabled/u);
  assert.match(generation, /!advancedMemoryEnabled &&\s*!unifiedMemoryEnabled &&\s*enableMemoryRecall/u);
  console.log(
    "Memory v2 passed: tolerant reads, guarded writes, tiers and budget, knowledge boundaries, entity slots, namesakes, atomic and idempotent commits, undo and tidy-up.",
  );
} finally {
  await new Promise<void>((resolve) => provider.close(() => resolve()));
  await closeDB();
  rmSync(directory, { recursive: true, force: true });
}
