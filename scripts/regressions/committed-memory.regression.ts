import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "committed-memory-"));
process.env.DATA_DIR = dir;
process.env.FILE_STORAGE_DIR = join(dir, "storage");
process.env.NODE_ENV = "test";
process.env.MARINARA_LITE = "true";
process.env.LOG_LEVEL = "silent";
const { getDB, closeDB } = await import("../../packages/server/src/db/connection.js");
const { createChatsStorage } = await import("../../packages/server/src/services/storage/chats.storage.js");
const { createConnectionsStorage } = await import("../../packages/server/src/services/storage/connections.storage.js");
const {
  startCommittedMemory,
  editCommittedMemory,
  committedMemoryConnectionStatus,
  committedMemoryStatus,
  committedMemoryForPrompt,
  compactCommittedHistory,
  parseCommittedMemoryOutput,
  setCommittedMemoryEnabled,
} = await import("../../packages/server/src/services/committed-memory.js");
const { isAutomaticRoleplaySummaryEnabled } =
  await import("../../packages/server/src/services/generation/roleplay-summary-runtime.js");
const db = await getDB();
const chats = createChatsStorage(db);
let calls = 0;
let release: (() => void) | undefined;
let pause = false;
let invalid = false;
const seen: string[] = [];
const provider = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.from(c));
  const body = JSON.parse(Buffer.concat(chunks).toString());
  const source = JSON.parse(body.messages[1].content) as Array<{ id: string; content: string }>;
  calls++;
  seen.push(JSON.stringify(source));
  if (pause)
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  const content = invalid
    ? "broken output"
    : JSON.stringify({
        summary: source.map((m) => m.content).join(" "),
        summaryKo: "한국어 표시용 요약",
        core: "손수건을 맡겼다.",
        facts: [
          {
            kind: "promise",
            key: "손수건 반환",
            content: "손수건을 돌려주기로 약속했다.",
            status: "current",
            audience: "shared",
            sourceIds: [source[0]!.id],
          },
        ],
      });
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }] }));
});
const waitUntil = async (predicate: () => boolean | Promise<boolean>) => {
  const until = Date.now() + 15000;
  while (!(await predicate())) {
    if (Date.now() > until) throw new Error("Timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};
const finished = (id: string) =>
  waitUntil(async () => (await committedMemoryStatus(db, id)).state.job?.status !== "running");
try {
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const addr = provider.address();
  assert(addr && typeof addr === "object");
  const conn = await createConnectionsStorage(db).create({
    name: "Fixture",
    isDefault: true,
    provider: "custom",
    model: "fixture",
    apiKey: "fixture",
    baseUrl: `http://127.0.0.1:${addr.port}/v1`,
    maxContext: 32768,
  });
  assert(conn);
  const connections = createConnectionsStorage(db);
  const { resolveChatSummaryConnection } =
    await import("../../packages/server/src/services/chat-summary/connection-resolution.js");
  const { resolveBaseUrl } = await import("../../packages/server/src/services/generation/connection-base-url.js");
  const resolve = (chatMetadata: Record<string, unknown>, chatConnectionId?: string) =>
    resolveChatSummaryConnection({ chatMetadata, chatConnectionId, connections, resolveBaseUrl });
  const fallback = await resolve({}, "deleted-connection");
  assert(fallback.ok && fallback.connectionId === conn.id && fallback.source === "default");
  for (const provider of ["image_generation", "video_generation", "audio", "decision"] as const) {
    const nonText = await connections.create({
      name: provider,
      provider,
      model: "fixture",
      baseUrl: "http://127.0.0.1:1",
      apiKey: "fixture",
    });
    assert(nonText);
    const result = await resolve({ summaryConnectionId: nonText.id });
    assert(result.ok && result.connectionId === conn.id && result.warnings.length);
  }
  const explicit = await resolve({ summaryConnectionId: conn.id });
  assert(explicit.ok && explicit.source === "summary");
  await connections.update(conn.id, { isDefault: false });
  assert.equal((await resolve({})).ok, false, "do not pick an arbitrary saved connection");
  await connections.update(conn.id, { isDefault: true });
  const subscription = await connections.create({
    name: "Subscription",
    provider: "openai_chatgpt",
    model: "fixture",
    apiKey: "",
  });
  assert(subscription);
  assert((await resolve({ summaryConnectionId: subscription.id })).ok);
  // Real HTTP summary below must work with only the global default configured.
  const chat = await chats.create({ name: "Memory", mode: "roleplay", characterIds: [] });
  assert(chat);
  await chats.patchMetadata(chat.id, {
    automaticSummaryEnabled: true,
    enableMemoryRecall: true,
    activeAgentIds: ["long-term-memory", "custom-helper"],
    // One message per batch: only full batches commit from the pending queue.
    committedMemoryBatchSize: 1,
  });
  const message = await chats.createMessage({
    chatId: chat.id,
    role: "assistant",
    characterId: null,
    content: "거절할 답변",
  });
  assert(message);
  await chats.addSwipe(message.id, "선택한 답변: 손수건을 맡겼다.");
  assert.equal(calls, 0);
  assert.equal((await committedMemoryStatus(db, chat.id)).pending, 1);
  await startCommittedMemory(db, chat.id);
  await finished(chat.id);
  assert.equal((await committedMemoryStatus(db, chat.id)).state.job?.status, "complete");
  assert(!seen[0]!.includes("거절할 답변"));
  await startCommittedMemory(db, chat.id);
  await finished(chat.id);
  assert.equal(calls, 1);
  const meta = JSON.parse((await chats.getById(chat.id))!.metadata);
  assert.equal(meta.automaticSummaryEnabled, false);
  assert.equal(meta.enableMemoryRecall, false);
  assert.equal(isAutomaticRoleplaySummaryEnabled({ ...meta, automaticSummaryEnabled: true }), false);
  assert((await committedMemoryForPrompt(db, chat.id, "손수건"))?.text.includes("약속"));
  assert.equal((await committedMemoryForPrompt(db, chat.id, "손수건", [message.id]))?.text, "");
  assert((await committedMemoryConnectionStatus(db, chat.id)).ok);
  let saved = (await committedMemoryStatus(db, chat.id)).state.batches[0]!;
  const factId = saved.facts[0]!.id;
  const edit = { batchId: saved.id, factId, expectedRevision: saved.revision ?? saved.createdAt, excluded: true };
  await editCommittedMemory(db, chat.id, edit);
  assert.equal(
    (await committedMemoryForPrompt(db, chat.id, "손수건"))?.text,
    "",
    "excluded fact must not leak through its narrative",
  );
  await assert.rejects(editCommittedMemory(db, chat.id, edit), /changed/);
  assert.equal((await committedMemoryStatus(db, chat.id)).pending, 0, "exclusion must not cause automatic recommit");
  saved = (await committedMemoryStatus(db, chat.id)).state.batches[0]!;
  await editCommittedMemory(db, chat.id, { ...edit, expectedRevision: saved.revision!, excluded: false });
  assert((await committedMemoryForPrompt(db, chat.id, "손수건"))?.text.includes("약속"));
  saved = (await committedMemoryStatus(db, chat.id)).state.batches[0]!;
  await editCommittedMemory(db, chat.id, {
    ...edit,
    expectedRevision: saved.revision!,
    excluded: false,
    content: "고친 약속",
    status: "resolved",
  });
  assert.equal((await committedMemoryForPrompt(db, chat.id, "손수건"))?.text, "");
  saved = (await committedMemoryStatus(db, chat.id)).state.batches[0]!;
  assert.equal(saved.sources[0]?.id, message.id, "manual correction preserves source identity");
  await editCommittedMemory(db, chat.id, {
    ...edit,
    expectedRevision: saved.revision!,
    excluded: false,
    status: "current",
  });
  await chats.setActiveSwipe(message.id, 0);
  await chats.setActiveSwipe(message.id, 1);
  assert.equal(
    (await committedMemoryForPrompt(db, chat.id, "손수건"))?.text,
    "",
    "old selection must not revive memory",
  );
  await startCommittedMemory(db, chat.id);
  await finished(chat.id);
  await chats.updateMessageContent(message.id, "수정된 답변");
  assert.equal((await committedMemoryStatus(db, chat.id)).pending, 1);
  pause = true;
  await startCommittedMemory(db, chat.id);
  await waitUntil(() => !!release);
  const beforeCalls = calls;
  await startCommittedMemory(db, chat.id);
  assert.equal(calls, beforeCalls);
  await chats.updateMessageContent(message.id, "요약 중 재수정");
  release!();
  release = undefined;
  pause = false;
  await finished(chat.id);
  assert.equal((await committedMemoryStatus(db, chat.id)).state.job?.status, "failed");
  invalid = true;
  await startCommittedMemory(db, chat.id);
  await finished(chat.id);
  assert.equal((await committedMemoryStatus(db, chat.id)).pending, 1);
  invalid = false;
  pause = true;
  await startCommittedMemory(db, chat.id);
  await waitUntil(() => !!release);
  const extra = await chats.createMessage({
    chatId: chat.id,
    role: "user",
    characterId: null,
    content: "클릭 이후 도착",
  });
  assert(extra);
  const hidden = await chats.createMessage({
    chatId: chat.id,
    role: "user",
    characterId: null,
    content: "숨긴 메시지",
  });
  assert(hidden);
  await chats.updateMessageExtra(hidden.id, { hiddenFromAI: true });
  release!();
  release = undefined;
  pause = false;
  await finished(chat.id);
  assert.equal((await committedMemoryStatus(db, chat.id)).pending, 1);
  const before = await chats.listMessages(chat.id);
  assert.equal((await compactCommittedHistory(db, chat.id, before)).length, before.length);
  assert.throws(() =>
    parseCommittedMemoryOutput(
      '{"summary":"ok","core":"ok","facts":[{"kind":"fact","key":"x","content":"x","status":"current","audience":"shared","sourceIds":["missing"]}]}',
      [],
    ),
  );
  await chats.removeMessage(message.id);
  assert(!(await committedMemoryForPrompt(db, chat.id, "손수건"))?.text);
  await setCommittedMemoryEnabled(db, chat.id, false);
  const restored = JSON.parse((await chats.getById(chat.id))!.metadata);
  assert.equal(restored.automaticSummaryEnabled, true);
  assert.equal(restored.enableMemoryRecall, true);
  assert(restored.activeAgentIds.includes("long-term-memory"));
  assert(restored.activeAgentIds.includes("custom-helper"));
  const smallConnection = await createConnectionsStorage(db).create({
    name: "Small context",
    provider: "custom",
    model: "fixture",
    apiKey: "fixture",
    baseUrl: `http://127.0.0.1:${addr.port}/v1`,
    maxContext: 4096,
  });
  assert(smallConnection);
  const smallChat = await chats.create({
    name: "Automatic splitting",
    mode: "roleplay",
    characterIds: [],
    connectionId: smallConnection.id,
  });
  assert(smallChat);
  await chats.patchMetadata(smallChat.id, { summaryMaxTokens: 512, committedMemoryBatchSize: 12 });
  for (let i = 0; i < 12; i++)
    await chats.createMessage({
      chatId: smallChat.id,
      role: i % 2 ? "assistant" : "user",
      characterId: null,
      content: `Selected ${i}: ` + "a".repeat(2000),
    });
  await startCommittedMemory(db, smallChat.id);
  await finished(smallChat.id);
  const splitStatus = await committedMemoryStatus(db, smallChat.id);
  assert.equal(splitStatus.state.job?.status, "complete");
  assert.equal(splitStatus.pending, 0);
  assert(splitStatus.state.batches.length > 1, "smaller models must split a commit automatically");
  assert.equal(splitStatus.state.job?.total, splitStatus.state.job?.completed);
  const privateChat = await chats.create({ name: "Scoped episode", mode: "roleplay", characterIds: [] });
  assert(privateChat);
  await chats.patchMetadata(privateChat.id, { committedMemoryBatchSize: 1 });
  await chats.createMessage({
    chatId: privateChat.id,
    role: "assistant",
    characterId: null,
    content: "비밀 약속",
    extra: { hiddenFromAICharacterIds: ["bob"] },
  });
  await startCommittedMemory(db, privateChat.id);
  await finished(privateChat.id);
  const privateBatch = (await committedMemoryStatus(db, privateChat.id)).state.batches[0]!;
  assert(privateBatch && !privateBatch.summary && !privateBatch.core);
  await assert.rejects(
    editCommittedMemory(db, privateChat.id, {
      batchId: privateBatch.id,
      expectedRevision: privateBatch.revision ?? privateBatch.createdAt,
      summary: "Publish private material",
    }),
    /Restricted/,
  );
  assert.equal((await committedMemoryForPrompt(db, privateChat.id, "비밀"))?.text, "");
  const Fastify = (await import("../../packages/server/node_modules/fastify/fastify.js")).default;
  const { registerCommittedMemoryRoutes } = await import("../../packages/server/src/routes/committed-memory.routes.js");
  const app = Fastify();
  app.decorate("db", db);
  const activeGenerations = new Map<string, unknown>();
  app.decorate("activeGenerations", activeGenerations);
  await registerCommittedMemoryRoutes(app);
  try {
    const connectionResponse = await app.inject({ method: "GET", url: `/${smallChat.id}/committed-memory/connection` });
    assert.equal(connectionResponse.statusCode, 200);
    const diagnostics = connectionResponse.json();
    assert(diagnostics.ok && diagnostics.model === "fixture");
    assert(!("apiKey" in diagnostics) && !("provider" in diagnostics));
    const savedBatch = splitStatus.state.batches[0]!;
    const payload = {
      batchId: savedBatch.id,
      expectedRevision: savedBatch.revision ?? savedBatch.createdAt,
      excluded: true,
    };
    const url = `/${smallChat.id}/committed-memory/record`;
    assert.equal((await app.inject({ method: "PATCH", url, payload })).statusCode, 200);
    assert.equal((await app.inject({ method: "PATCH", url, payload })).statusCode, 409);
    assert.equal(
      (await app.inject({ method: "PATCH", url, payload: { ...payload, sourceIds: ["forged"] } })).statusCode,
      400,
    );
    assert.equal(
      (await app.inject({ method: "PATCH", url: `/${chat.id}/committed-memory/record`, payload })).statusCode,
      404,
    );
    assert.equal((await app.inject({ method: "GET", url: "/missing/committed-memory/connection" })).statusCode, 404);
    activeGenerations.set(smallChat.id, true);
    assert.equal(
      (await app.inject({ method: "POST", url: `/${smallChat.id}/committed-memory/commit`, payload: {} })).statusCode,
      409,
    );
    activeGenerations.clear();
    await connections.update(conn.id, { isDefault: false });
    const unconfigured = await chats.create({ name: "No connection", mode: "roleplay", characterIds: [] });
    assert(unconfigured);
    await chats.patchMetadata(unconfigured.id, { committedMemoryBatchSize: 1 });
    await chats.createMessage({
      chatId: unconfigured.id,
      role: "assistant",
      characterId: null,
      content: "Needs summary",
    });
    assert.equal(
      (await app.inject({ method: "POST", url: `/${unconfigured.id}/committed-memory/commit`, payload: {} }))
        .statusCode,
      422,
    );
    assert.equal((await committedMemoryStatus(db, unconfigured.id)).state.job, undefined);
  } finally {
    await app.close();
  }
  console.log(
    "Committed memory integration passed: explicit selected-swipe confirmation, duplicate/concurrent clicks, source changes, failed output, snapshot boundary, deletion, hidden messages, history and settings restoration.",
  );
} finally {
  release?.();
  await new Promise<void>((resolve) => provider.close(() => resolve()));
  await closeDB();
  rmSync(dir, { recursive: true, force: true });
}
