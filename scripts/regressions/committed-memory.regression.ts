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
    provider: "custom",
    model: "fixture",
    apiKey: "fixture",
    baseUrl: `http://127.0.0.1:${addr.port}/v1`,
    maxContext: 32768,
  });
  assert(conn);
  const chat = await chats.create({ name: "Memory", mode: "roleplay", characterIds: [], connectionId: conn.id });
  assert(chat);
  await chats.patchMetadata(chat.id, {
    automaticSummaryEnabled: true,
    enableMemoryRecall: true,
    activeAgentIds: ["long-term-memory", "custom-helper"],
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
  await chats.patchMetadata(smallChat.id, { summaryMaxTokens: 512 });
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
  console.log(
    "Committed memory integration passed: explicit selected-swipe confirmation, duplicate/concurrent clicks, source changes, failed output, snapshot boundary, deletion, hidden messages, history and settings restoration.",
  );
} finally {
  release?.();
  await new Promise<void>((resolve) => provider.close(() => resolve()));
  await closeDB();
  rmSync(dir, { recursive: true, force: true });
}
