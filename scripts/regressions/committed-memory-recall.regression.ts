import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { CommittedMemoryBatch, CommittedMemoryState } from "../../packages/shared/src/types/committed-memory.js";
const directory = mkdtempSync(join(tmpdir(), "memory-recall-"));
process.env.DATA_DIR = directory;
process.env.FILE_STORAGE_DIR = join(directory, "storage");
process.env.NODE_ENV = "test";
process.env.MARINARA_LITE = "true";
process.env.LOG_LEVEL = "silent";
const { getDB, closeDB } = await import("../../packages/server/src/db/connection.js");
const { createChatsStorage } = await import("../../packages/server/src/services/storage/chats.storage.js");
const { createConnectionsStorage } = await import("../../packages/server/src/services/storage/connections.storage.js");
const {
  committedMemoryForPrompt,
  committedMemoryStatus,
  startCommittedMemory,
  resetCommittedMemory,
  editCommittedMemory,
  configureCommittedMemory,
  enrichCommittedMemory,
  cancelCommittedMemory,
  rebuildCommittedMemoryIndex,
  loadCommittedMemory,
} = await import("../../packages/server/src/services/committed-memory.js");
const { memoryFingerprint, selectCommittedMemory, reconcileCommittedMemory } =
  await import("../../packages/server/src/services/committed-memory-policy.js");
const { pruneCommittedMemoryIndex, readCommittedMemoryIndex } =
  await import("../../packages/server/src/services/committed-memory-index.js");
const { registerCommittedMemoryRoutes } = await import("../../packages/server/src/routes/committed-memory.routes.js");
const { default: Fastify } = await import("../../packages/server/node_modules/fastify/fastify.js");
const db = await getDB();
const chats = createChatsStorage(db);
let releaseProvider: (() => void) | undefined;
let providerStarted: (() => void) | undefined;
let delayProvider = false;
let malformedDisplay = false;
const provider = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const request = JSON.parse(Buffer.concat(chunks).toString());
  providerStarted?.();
  providerStarted = undefined;
  if (delayProvider)
    await new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
  const input = JSON.parse(request.messages[1].content);
  const output = Array.isArray(input)
    ? {
        summary: "A message is confirmed.",
        summaryKo: "메시지를 확정했다.",
        core: "Confirmed.",
        coreKo: "확정됨.",
        gist: "Done.",
        gistKo: "완료.",
        keywords: ["confirmation", "확정"],
        facts: [],
      }
    : {
        summaryKo: "책을 빌렸다.",
        coreKo: "책 대여.",
        gist: "Book loan.",
        gistKo: "책 대여.",
        keywords: ["book", "도서관"],
        facts: input.facts.map((f: { id: string }) => ({
          id: malformedDisplay ? "unknown" : f.id,
          keyKo: "비밀 약속",
          contentKo: "앨리스만 아는 약속.",
          keywords: ["약속"],
        })),
      };
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      choices: [{ message: { role: "assistant", content: JSON.stringify(output) }, finish_reason: "stop" }],
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
    name: "Recall fixture",
    provider: "custom",
    model: "fixture",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: "fixture",
    isDefault: true,
  });
  const chat = await chats.create({ name: "Recall", mode: "roleplay", characterIds: ["alice", "bob"] });
  assert(chat);
  const first = await chats.createMessage({
    chatId: chat.id,
    role: "assistant",
    characterId: null,
    content: "The library lends a book.",
  });
  assert(first);
  const second = await chats.createMessage({
    chatId: chat.id,
    role: "assistant",
    characterId: null,
    content: "A distant new scene.",
  });
  assert(second);
  const batch: CommittedMemoryBatch = {
    id: "episode",
    createdAt: new Date().toISOString(),
    turn: 1,
    sources: [{ id: first.id, fingerprint: memoryFingerprint(first) }],
    summary: "A long detailed library conversation.",
    core: "The library lends a book.",
    gist: "Book loan.",
    gistKo: "책 대여.",
    keywords: ["도서관", "library"],
    facts: [
      {
        id: "secret",
        kind: "promise",
        key: "secret-promise",
        content: "Alice privately promised a gift.",
        status: "current",
        audience: ["alice"],
        sourceIds: [first.id],
      },
    ],
  };
  const state: CommittedMemoryState = {
    version: 1,
    ownerChatId: chat.id,
    enabled: true,
    batches: [
      batch,
      {
        id: "latest",
        createdAt: new Date().toISOString(),
        turn: 2,
        sources: [{ id: second.id, fingerprint: memoryFingerprint(second) }],
        summary: "New scene.",
        core: "New scene.",
        facts: [],
      },
    ],
  };
  await chats.patchMetadata(chat.id, { committedMemory: state });
  let documents = 0;
  let queryCount = 0;
  const embeddedTexts: string[] = [];
  const source = {
    spaceId: "multilingual-v1",
    cacheIdentity: "fixture-v1",
    label: "Fixture",
    async embed(texts: string[], _signal?: AbortSignal, type?: "query" | "document") {
      if (type === "document") {
        documents += texts.length;
        embeddedTexts.push(...texts);
        await new Promise((resolve) => setTimeout(resolve, 40));
      } else queryCount++;
      return texts.map(() => [1, 0, 0]);
    },
  };
  const start = performance.now();
  let preview = await committedMemoryForPrompt(db, chat.id, "도서관", [], [], { embeddingSource: source });
  const coldMs = performance.now() - start;
  assert(preview?.text.includes("library"));
  assert(!preview?.text.includes("privately"));
  assert(
    !embeddedTexts.some((text) => text.includes("privately")),
    "unauthorized private records must not be sent to vectorizer",
  );
  const initialDocs = documents;
  assert(initialDocs > 0);
  assert((await readCommittedMemoryIndex(chat.id))?.entries.length);
  const warmStart = performance.now();
  await committedMemoryForPrompt(db, chat.id, "도서관", [], [], { embeddingSource: { ...source } });
  const warmMs = performance.now() - warmStart;
  assert.equal(
    documents,
    initialDocs,
    "persisted vectors eliminate repeated document embedding independently of source object identity",
  );
  assert.equal(queryCount, 2);
  assert.equal(
    ((await committedMemoryStatus(db, chat.id)).state as unknown as Record<string, unknown>).recallIndex,
    undefined,
    "UI payload must not expose large vectors",
  );
  await committedMemoryForPrompt(db, chat.id, "gift", [], ["alice"], { embeddingSource: source });
  assert(embeddedTexts.some((text) => text.includes("privately")));
  const oldDocs = documents;
  await editCommittedMemory(db, chat.id, {
    batchId: batch.id,
    expectedRevision: batch.createdAt,
    core: "Library receipt.",
  });
  await committedMemoryForPrompt(db, chat.id, "library", [], [], { embeddingSource: source });
  assert.equal(documents, oldDocs + 1, "one edit only re-embeds its changed document");
  const modelChangeDocs = documents;
  await committedMemoryForPrompt(db, chat.id, "library", [], [], {
    embeddingSource: { ...source, cacheIdentity: "fixture-v2", spaceId: "multilingual-v2" },
  });
  assert.equal(documents, modelChangeDocs + 2, "same-dimensional model change invalidates old space");
  preview = await committedMemoryForPrompt(db, chat.id, "library", [], [], {
    embeddingSource: {
      ...source,
      async embed() {
        throw new Error("unavailable");
      },
    },
  });
  assert(preview && /library/i.test(preview.text), "provider failure retains lexical retrieval");
  await configureCommittedMemory(db, chat.id, { tokenBudget: 256, recentMessages: 0, longTermMessages: 1, topK: 1 });
  preview = await committedMemoryForPrompt(db, chat.id, "도서관", [], [], { embeddingSource: source });
  assert(preview && preview.usedTokens <= 256);
  assert(preview.selected.filter((i) => i.reason !== "current").length <= 1);
  await assert.rejects(configureCommittedMemory(db, chat.id, { recentMessages: 20, longTermMessages: 10 }), /at least/);
  const aged = {
    ...state,
    recall: { recentMessages: 10, longTermMessages: 100, tokenBudget: 300 },
    batches: [batch, { ...state.batches[1]!, turn: 500 }],
  };
  const selection = selectCommittedMemory(aged, "도서관");
  assert(selection.text.includes("Book loan."), "deep aging selects gist");
  assert(!selection.text.includes("long detailed"));
  assert(!selection.text.includes("책 대여"), "display language never enters prompt");
  assert.equal(selection.selected.find((i) => i.id === batch.id)?.stage, "core");
  const scoped = selectCommittedMemory(aged, "gift", [], 8000, ["alice"]);
  assert(scoped.text.includes("privately"), "unresolved promises survive aging");
  assert.deepEqual(
    selectCommittedMemory(aged, "library", [first.id]).selected.filter((i) => i.id === batch.id),
    [],
  );
  const stale = structuredClone((await loadCommittedMemory(db, chat.id)).state);
  await pruneCommittedMemoryIndex(chat.id, { ...stale, batches: stale.batches.map((b) => ({ ...b, excluded: true })) });
  assert.equal((await readCommittedMemoryIndex(chat.id))?.entries.length, 0);
  await committedMemoryForPrompt(db, chat.id, "library", [], [], { embeddingSource: source });
  await pruneCommittedMemoryIndex(
    chat.id,
    reconcileCommittedMemory(stale, [{ ...first, content: "Edited source" }, second]),
  );
  assert(!(await readCommittedMemoryIndex(chat.id))?.entries.some((e) => e.id === batch.id));
  // Bulk enrichment only changes display/derived fields, with identity and source validation.
  const before = structuredClone((await loadCommittedMemory(db, chat.id)).state.batches[0]!);
  await enrichCommittedMemory(db, chat.id);
  assert.equal((await finish(chat.id)).state.job?.status, "complete");
  const after = (await loadCommittedMemory(db, chat.id)).state.batches[0]!;
  assert.equal(after.summary, before.summary);
  assert.equal(after.core, before.core);
  assert.deepEqual(after.sources, before.sources);
  assert.equal(after.facts[0]!.id, before.facts[0]!.id);
  assert(after.summaryKo?.includes("책"));
  // Original messages and per-chat settings survive reset; pending versions become eligible again.
  await chats.updateMessageExtra(first.id, {
    committedMemoryReceipt: [{ id: "old", content: "old", reason: "current", sourceIds: [first.id] }],
  });
  const contents = (await chats.listMessages(chat.id)).map((m) => m.content);
  const app = Fastify();
  app.decorate("db", db);
  await registerCommittedMemoryRoutes(app);
  assert.equal(
    (await app.inject({ method: "POST", url: `/${chat.id}/committed-memory/reset`, payload: {} })).statusCode,
    400,
  );
  assert.equal(
    (await app.inject({ method: "POST", url: `/${chat.id}/committed-memory/reset`, payload: { confirm: true } }))
      .statusCode,
    200,
  );
  assert.equal((await committedMemoryStatus(db, chat.id)).pending, 2);
  assert.equal((await committedMemoryStatus(db, chat.id)).state.batches.length, 0);
  assert.equal(await readCommittedMemoryIndex(chat.id), undefined);
  assert.equal((await committedMemoryStatus(db, chat.id)).lastReceipt, null);
  assert.equal((await committedMemoryStatus(db, chat.id)).state.recall?.tokenBudget, 256);
  assert.deepEqual(
    (await chats.listMessages(chat.id)).map((m) => m.content),
    contents,
  );
  await app.close();
  // Reset/cancel while a provider response is pending must not resurrect records.
  delayProvider = true;
  let started = new Promise<void>((resolve) => {
    providerStarted = resolve;
  });
  await startCommittedMemory(db, chat.id);
  await started;
  await resetCommittedMemory(db, chat.id);
  releaseProvider?.();
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal((await committedMemoryStatus(db, chat.id)).state.batches.length, 0);
  started = new Promise<void>((resolve) => {
    providerStarted = resolve;
  });
  await startCommittedMemory(db, chat.id);
  await started;
  await cancelCommittedMemory(db, chat.id);
  releaseProvider?.();
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal((await committedMemoryStatus(db, chat.id)).state.job?.status, "cancelled");
  assert.equal((await committedMemoryStatus(db, chat.id)).state.batches.length, 0);
  delayProvider = false;
  await startCommittedMemory(db, chat.id);
  assert.equal((await finish(chat.id)).state.job?.status, "complete");
  assert.equal((await committedMemoryStatus(db, chat.id)).pending, 0);
  await rebuildCommittedMemoryIndex(db, chat.id);
  assert.equal(await readCommittedMemoryIndex(chat.id), undefined);
  // Reset while vectorization is awaiting a provider: neither index nor selections may resurrect.
  await resetCommittedMemory(db, chat.id);
  await chats.patchMetadata(chat.id, { committedMemory: state });
  let releaseEmbedding!: () => void;
  let beginEmbedding!: () => void;
  const embeddingStarted = new Promise<void>((resolve) => {
    beginEmbedding = resolve;
  });
  const embeddingGate = new Promise<void>((resolve) => {
    releaseEmbedding = resolve;
  });
  const inflight = committedMemoryForPrompt(db, chat.id, "library", [], [], {
    embeddingSource: {
      ...source,
      async embed(texts: string[]) {
        beginEmbedding();
        await embeddingGate;
        return texts.map(() => [1, 0, 0]);
      },
    },
  });
  await embeddingStarted;
  await resetCommittedMemory(db, chat.id);
  releaseEmbedding();
  const resetPreview = await inflight;
  assert.equal(resetPreview?.selected.length, 0);
  assert.equal((await readCommittedMemoryIndex(chat.id))?.entries.length ?? 0, 0);
  // Refuse mismatched display IDs without corrupting canonical memory.
  await resetCommittedMemory(db, chat.id);
  await chats.patchMetadata(chat.id, { committedMemory: state });
  malformedDisplay = true;
  await enrichCommittedMemory(db, chat.id);
  assert.equal((await finish(chat.id)).state.job?.status, "failed");
  assert.equal((await loadCommittedMemory(db, chat.id)).state.batches[0]!.summary, state.batches[0]!.summary);
  await committedMemoryForPrompt(db, chat.id, "library", [], [], { embeddingSource: source });
  assert((await readCommittedMemoryIndex(chat.id))?.entries.length);
  await chats.remove(chat.id);
  assert.equal(await readCommittedMemoryIndex(chat.id), undefined, "chat deletion clears derived vectors");
  console.log(
    `Recall passed: reset/cancel races, multilingual keywords, persistent scoped vectors, model/edit invalidation, fallback, enrichment identity, token budget and tiered aging. Fixture recall cold=${coldMs.toFixed(1)}ms warm=${warmMs.toFixed(1)}ms; repeat document embeddings ${initialDocs} → 0.`,
  );
} finally {
  releaseProvider?.();
  provider.closeAllConnections();
  await new Promise<void>((resolve) => provider.close(() => resolve()));
  await closeDB();
  rmSync(directory, { recursive: true, force: true });
}
