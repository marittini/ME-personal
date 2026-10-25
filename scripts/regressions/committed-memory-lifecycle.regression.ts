import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directory = mkdtempSync(join(tmpdir(), "memory-lifecycle-"));
process.env.DATA_DIR = directory;
process.env.FILE_STORAGE_DIR = join(directory, "storage");
process.env.NODE_ENV = "test";
process.env.MARINARA_LITE = "true";
process.env.LOG_LEVEL = "silent";
const { getDB, closeDB } = await import("../../packages/server/src/db/connection.js");
const { createChatsStorage } = await import("../../packages/server/src/services/storage/chats.storage.js");
const { createConnectionsStorage } = await import("../../packages/server/src/services/storage/connections.storage.js");
const {
  startCommittedMemory,
  committedMemoryStatus,
  committedMemoryForPrompt,
  compactCommittedHistory,
  editCommittedMemory,
  parseCommittedMemoryOutput,
} = await import("../../packages/server/src/services/committed-memory.js");
const { summaryHidingPatch } = await import("../../packages/server/src/routes/generate/generate-route-utils.js");
const db = await getDB();
const chats = createChatsStorage(db);
let calls = 0;
let knownId: string | undefined;
let progress: "pending" | "in_progress" | "completed" = "pending";
let privateScope = false;
let omitKorean = false;
let truncateMulti = false;
let truncateSingle = false;
/** Appended to the promise text so successive commits carry new values. */
let contentVariant = "";
const requests: string[][] = [];
const provider = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const request = JSON.parse(Buffer.concat(chunks).toString());
  const transcript = JSON.parse(request.messages[1].content) as Array<{ id: string; content: string }>;
  calls++;
  requests.push(transcript.map((m) => m.id));
  const content = {
    summary: transcript.map((m) => m.content).join(" "),
    core: "The book changes hands.",
    ...(!omitKorean ? { summaryKo: "표시전용: 책에 관한 이야기", coreKo: "표시전용: 책을 건넸다." } : {}),
    facts: [
      {
        kind: "promise",
        key: knownId ? "renamed model key" : "promise:book",
        content:
          (progress === "completed" ? "Alice has returned the book." : "Alice will return the book.") + contentVariant,
        status: "current",
        progress,
        existingId: knownId,
        audience: privateScope ? ["alice"] : "shared",
        sourceIds: [transcript[0]!.id],
        ...(!omitKorean ? { keyKo: "책 반환 약속", contentKo: "표시전용: 앨리스의 책 반환 약속" } : {}),
      },
    ],
  };
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      choices: [
        {
          message: { role: "assistant", content: JSON.stringify(content) },
          finish_reason: truncateSingle || (truncateMulti && transcript.length > 1) ? "length" : "stop",
        },
      ],
    }),
  );
});
async function finish(id: string) {
  const until = Date.now() + 15000;
  while ((await committedMemoryStatus(db, id)).state.job?.status === "running") {
    if (Date.now() > until) throw new Error("Memory job timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return committedMemoryStatus(db, id);
}
try {
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();
  assert(address && typeof address === "object");
  await createConnectionsStorage(db).create({
    name: "Lifecycle fixture",
    provider: "custom",
    model: "fixture",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: "fixture",
    isDefault: true,
  });
  const chat = await chats.create({ name: "Lifecycle", mode: "roleplay", characterIds: ["alice", "bob"] });
  assert(chat);
  await chats.patchMetadata(chat.id, { committedMemoryBatchSize: 1 });
  const first = await chats.createMessage({
    chatId: chat.id,
    role: "assistant",
    characterId: null,
    content: "Alice promises to return a book.",
  });
  assert(first);
  await startCommittedMemory(db, chat.id);
  let status = await finish(chat.id);
  assert.equal(status.state.job?.status, "complete");
  assert.equal(calls, 1, "the initial response contains both languages without a translation call");
  assert(status.state.batches[0]?.summaryKo?.includes("표시전용"));
  knownId = status.state.batches[0]!.facts[0]!.id;
  const known = status.state.batches[0]!.facts[0]!;
  const modelResponse = {
    summary: "A public event.",
    core: "A book promise.",
    summaryKo: "공개된 사건",
    coreKo: "책 반환 약속",
    facts: [{ ...known, existingId: known.id }],
  };
  assert.throws(
    () =>
      parseCommittedMemoryOutput(
        JSON.stringify({ ...modelResponse, facts: [{ ...modelResponse.facts[0], audience: ["alice"] }] }),
        [first],
        [known],
      ),
    /differently scoped/,
  );
  assert.throws(
    () =>
      parseCommittedMemoryOutput(
        JSON.stringify({ ...modelResponse, facts: [{ ...modelResponse.facts[0], existingId: "another-chat-fact" }] }),
        [first],
        [known],
      ),
    /unknown/,
  );

  const mixedLanguage = parseCommittedMemoryOutput(
    JSON.stringify({
      ...modelResponse,
      summary: "Alice met 김철수 at the station.",
      summaryKo: "앨리스가 역에서 김철수를 만났다.",
    }),
    [first],
    [known],
  );
  assert.equal(
    mixedLanguage.summaryKo,
    "앨리스가 역에서 김철수를 만났다.",
    "Korean names must not discard a valid Korean display translation",
  );
  const initialPrompt = await committedMemoryForPrompt(db, chat.id, "책");
  assert(initialPrompt?.text.includes("Alice"));
  assert(!initialPrompt?.text.includes("표시전용"));
  assert(initialPrompt?.selected.some((item) => item.displayKo?.includes("표시전용")));
  assert(initialPrompt?.text.includes("<current_facts_and_obligations>"));
  assert(initialPrompt?.text.includes("<story_chronology>"));
  progress = "in_progress";
  await chats.createMessage({
    chatId: chat.id,
    role: "assistant",
    characterId: null,
    content: "Alice is on her way to return the book.",
  });
  await startCommittedMemory(db, chat.id);
  status = await finish(chat.id);
  assert.equal(status.state.job?.status, "complete");
  let facts = status.state.batches.flatMap((b) => b.facts);
  assert.equal(facts.length, 1, "updates replace the record instead of multiplying it");
  assert.equal(facts[0]?.id, knownId);
  assert.equal(facts[0]?.key, "promise:book", "an explicitly referenced identity survives model key drift");
  assert.equal(facts[0]?.progress, "in_progress");
  assert.equal(facts[0]?.dependencies?.length, 2);
  const ordered = (await committedMemoryForPrompt(db, chat.id, "Alice"))!.selected.filter(
    (i) => i.reason !== "current",
  );
  assert.deepEqual(
    ordered.map((item) => item.id),
    status.state.batches.map((b) => b.id),
  );
  progress = "completed";
  await chats.createMessage({
    chatId: chat.id,
    role: "assistant",
    characterId: null,
    content: "Alice returns the book.",
  });
  await startCommittedMemory(db, chat.id);
  status = await finish(chat.id);
  facts = status.state.batches.flatMap((b) => b.facts);
  assert.equal(facts.length, 1);
  assert.equal(facts[0]?.id, knownId);
  assert.equal(facts[0]?.progress, "completed");
  assert.equal(facts[0]?.status, "resolved");
  assert(!(await committedMemoryForPrompt(db, chat.id, ""))?.selected.some((item) => item.reason === "current"));
  const timeline = await chats.listMessages(chat.id);
  const beforeCompletion = await committedMemoryForPrompt(db, chat.id, "book", [timeline[2]!.id]);
  assert(
    beforeCompletion?.text.includes("[promise:in_progress]"),
    "earlier generation restores the evidence-checked previous value",
  );
  assert(!beforeCompletion?.text.includes("has returned"));
  const beforeProgress = await committedMemoryForPrompt(db, chat.id, "book", [timeline[1]!.id]);
  assert(beforeProgress?.text.includes("[promise:pending]"));
  assert(!beforeProgress?.text.includes("on her way"));
  const holder = status.state.batches.find((batch) => batch.facts.length)!;
  await editCommittedMemory(db, chat.id, {
    batchId: holder.id,
    factId: knownId,
    expectedRevision: holder.revision ?? holder.createdAt,
    progress: "in_progress",
  });
  assert((await committedMemoryForPrompt(db, chat.id, ""))?.selected.some((item) => item.id === knownId));
  await chats.updateMessageContent(first.id, "Alice never made the earlier promise.");
  status = await committedMemoryStatus(db, chat.id);
  assert(status.state.batches.flatMap((b) => b.facts).some((f) => f.id === knownId && f.invalidated));
  assert(!(await committedMemoryForPrompt(db, chat.id, ""))?.selected.some((item) => item.id === knownId));
  assert(status.pending > 1, "dependent ranges become eligible for explicit reconfirmation");
  knownId = undefined;
  privateScope = true;
  progress = "pending";
  const scoped = await chats.createMessage({
    chatId: chat.id,
    role: "assistant",
    characterId: null,
    content: "Only Alice knows a separate promise.",
  });
  assert(scoped);
  await startCommittedMemory(db, chat.id, false, { sourceMode: "range", rangeStartIndex: 4, rangeEndIndex: 4 });
  status = await finish(chat.id);
  assert.equal(status.state.job?.status, "complete");
  const privateFact = status.state.batches.flatMap((b) => b.facts).find((f) => Array.isArray(f.audience));
  assert(privateFact && privateFact.id !== facts[0]?.id, "same property in another knowledge scope must not merge");
  assert(
    !(await committedMemoryForPrompt(db, chat.id, "", [], ["bob"]))?.selected.some(
      (item) => item.id === privateFact.id,
    ),
  );
  assert(
    (await committedMemoryForPrompt(db, chat.id, "", [], ["alice"]))?.selected.some(
      (item) => item.id === privateFact.id,
    ),
  );
  privateScope = false;
  progress = "in_progress";
  await startCommittedMemory(db, chat.id);
  status = await finish(chat.id);
  assert.equal(status.state.job?.status, "complete");
  assert(
    status.state.batches
      .flatMap((b) => b.facts)
      .some((f) => f.audience === "shared" && !f.invalidated && f.progress === "in_progress"),
    "explicit reconfirmation repairs dependent facts",
  );
  const ranged = await chats.create({ name: "Native range", mode: "roleplay", characterIds: [] });
  assert(ranged);
  const messages = [];
  for (let i = 1; i <= 8; i++) {
    const message = await chats.createMessage({
      chatId: ranged.id,
      role: "assistant",
      characterId: null,
      content: `Message ${i}: a public event.`,
    });
    assert(message);
    messages.push(message);
  }
  await chats.patchMetadata(ranged.id, {
    committedMemorySourceMode: "range",
    committedMemoryRangeStart: 3,
    committedMemoryRangeEnd: 4,
    hideSummarisedMessages: true,
    summaryTailMessages: 0,
  });
  assert.equal((await committedMemoryStatus(db, ranged.id)).selectedPending, 2);
  await startCommittedMemory(db, ranged.id);
  assert.equal((await finish(ranged.id)).state.job?.status, "complete");
  assert.deepEqual(requests.at(-1), [messages[2]!.id, messages[3]!.id]);
  const history = await chats.listMessages(ranged.id);
  assert.deepEqual(
    (await compactCommittedHistory(db, ranged.id, history)).map((m) => m.id),
    history.filter((_, i) => i !== 2 && i !== 3).map((m) => m.id),
  );
  assert.equal(
    (await compactCommittedHistory(db, ranged.id, history, messages[3]!.id)).length,
    8,
    "a future-dependent episode cannot hide earlier regeneration context",
  );
  assert.equal(
    (await compactCommittedHistory(db, ranged.id, history.slice(0, 3))).length,
    3,
    "a partially present episode cannot replace raw history",
  );
  await chats.patchMetadata(ranged.id, { summaryTailMessages: 6 });
  assert.equal(
    (await compactCommittedHistory(db, ranged.id, history)).length,
    8,
    "native tail protects visible recent messages",
  );
  await chats.patchMetadata(ranged.id, { hideSummarisedMessages: false });
  assert.equal((await compactCommittedHistory(db, ranged.id, history)).length, 8);
  await chats.patchMetadata(ranged.id, { hideSummarisedMessages: true, summaryTailMessages: 0 });
  await chats.updateMessageContent(messages[2]!.id, "The third message was replaced.");
  assert.equal(
    (await compactCommittedHistory(db, ranged.id, await chats.listMessages(ranged.id))).length,
    8,
    "invalidated summaries restore their original history",
  );
  await assert.rejects(
    startCommittedMemory(db, ranged.id, false, { sourceMode: "range", rangeStartIndex: 1, rangeEndIndex: 999 }),
    /outside|500/,
  );
  const callCount = calls;
  await committedMemoryStatus(db, ranged.id);
  assert.equal(calls, callCount, "opening/polling the vault does not invoke the model");
  let hides = 0;
  assert.deepEqual(
    await summaryHidingPatch(
      {
        listMessages: async () => [],
        bulkSetHiddenFromAI: async () => {
          hides++;
          return [];
        },
      },
      ranged.id,
      {},
      { committedMemory: { enabled: true }, hideSummarisedMessages: true },
    ),
    {},
  );
  assert.equal(hides, 0, "legacy hiding must not mutate unified memory source fingerprints");
  const split = await chats.create({ name: "Truncated bilingual output", mode: "roleplay", characterIds: [] });
  assert(split);
  await chats.patchMetadata(split.id, { committedMemoryBatchSize: 3 });
  for (let i = 0; i < 3; i++)
    await chats.createMessage({
      chatId: split.id,
      role: "assistant",
      characterId: null,
      content: `Event ${i} about a book.`,
    });
  truncateMulti = true;
  const beforeSplitting = calls;
  await startCommittedMemory(db, split.id);
  const splitStatus = await finish(split.id);
  assert.equal(splitStatus.state.job?.status, "complete");
  assert.equal(splitStatus.pending, 0);
  assert.equal(splitStatus.state.batches.length, 3);
  assert.equal(calls - beforeSplitting, 5, "output truncation splits into bounded smaller attempts");
  assert.equal(splitStatus.state.batches.flatMap((batch) => batch.facts).length, 1);
  truncateMulti = false;
  await chats.patchMetadata(split.id, { committedMemoryBatchSize: 1 });
  for (let index = 0; index < 4; index++) {
    await chats.createMessage({
      chatId: split.id,
      role: "assistant",
      characterId: null,
      content: `Book promise update ${index}.`,
    });
    contentVariant = ` (update ${index})`;
    await startCommittedMemory(db, split.id);
    assert.equal((await finish(split.id)).state.job?.status, "complete");
  }
  const bounded = (await committedMemoryStatus(db, split.id)).state.batches.flatMap((batch) => batch.facts);
  assert.equal(bounded.length, 1);
  assert.equal(bounded[0]?.previous?.length, 3, "version history is bounded and never listed as extra memories");
  // The same value again is no change: no new memory and no new history entry.
  await chats.createMessage({
    chatId: split.id,
    role: "assistant",
    characterId: null,
    content: "Book promise repeated.",
  });
  await startCommittedMemory(db, split.id);
  assert.equal((await finish(split.id)).state.job?.status, "complete");
  const repeated = (await committedMemoryStatus(db, split.id)).state.batches.flatMap((batch) => batch.facts);
  assert.equal(repeated.length, 1, "a repeated value creates no new memory");
  assert.equal(repeated[0]?.id, bounded[0]?.id);
  assert.deepEqual(
    repeated[0]?.previous?.map((version) => version.content),
    bounded[0]?.previous?.map((version) => version.content),
    "a repeated value adds no history",
  );
  contentVariant = "";
  await chats.createMessage({ chatId: split.id, role: "assistant", characterId: null, content: "A final new event." });
  truncateSingle = true;
  await startCommittedMemory(db, split.id);
  assert.equal((await finish(split.id)).state.job?.status, "failed");
  assert.equal(
    (await committedMemoryStatus(db, split.id)).pending,
    1,
    "single-message truncation preserves pending sources",
  );
  truncateSingle = false;
  omitKorean = true;
  await startCommittedMemory(db, ranged.id, false, { sourceMode: "last", contextSize: 5 });
  assert.equal(
    (await finish(ranged.id)).state.job?.status,
    "failed",
    "a bilingual extraction cannot silently drop the display half",
  );
  assert((await committedMemoryStatus(db, ranged.id)).selectedPending! > 0);
  console.log(
    "Memory lifecycle passed: first-response bilingual text, original-only structured chronological injection, stable scoped updates, progress, native ranges/tails, invalidation recovery and no background confirmation.",
  );
} finally {
  await new Promise<void>((resolve) => provider.close(() => resolve()));
  await closeDB();
  rmSync(directory, { recursive: true, force: true });
}
