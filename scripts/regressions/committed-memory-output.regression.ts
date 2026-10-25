import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { estimateChatSummaryTokens } from "../../packages/shared/src/utils/chat-summary-entries.js";
const directory = mkdtempSync(join(tmpdir(), "memory-output-"));
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
  parseCommittedMemoryOutput,
  resolveCommittedMemoryBatchSize,
  planCommittedMemoryBatches,
} = await import("../../packages/server/src/services/committed-memory.js");
const { registerCommittedMemoryRoutes } = await import("../../packages/server/src/routes/committed-memory.routes.js");
const Fastify = (await import("../../packages/server/node_modules/fastify/fastify.js")).default;
const db = await getDB();
const chats = createChatsStorage(db);
let mode: "valid" | "malformed-once" | "malformed-always" | "schema-always" | "malformed-after-first" | "truncated" =
  "valid";
const requests: string[][] = [];
function output(ids: string[]) {
  return {
    summary: "세 가지 약속이 완료되었다.",
    core: "약속 완료.",
    facts: [0, 1, 2].map((i) => ({
      kind: "promise",
      key: `완료약속-${ids[0]}-${i}`,
      content: "약속을 이행했다.",
      status: "completed",
      audience: "shared",
      sourceIds: ids,
    })),
  };
}
const provider = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const request = JSON.parse(Buffer.concat(chunks).toString());
  const transcript = JSON.parse(request.messages[1].content) as Array<{ id: string }>;
  const ids = transcript.map((m) => m.id);
  requests.push(ids);
  let content = JSON.stringify(output(ids));
  if (
    mode === "malformed-always" ||
    (mode === "malformed-after-first" && requests.length > 1) ||
    (mode === "malformed-once" && requests.length === 1)
  )
    content = '{"summary":"요약" "core":"핵심","facts":[]}';
  if (mode === "schema-always") content = content.replaceAll('"completed"', '"unknown"');
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      choices: [
        {
          message: { role: "assistant", content },
          finish_reason: mode === "truncated" && ids.length > 2 ? "length" : "stop",
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
async function room(count: number, metadata: Record<string, unknown> = {}) {
  const chat = await chats.create({ name: "Output fixture", mode: "roleplay", characterIds: [] });
  assert(chat);
  await chats.patchMetadata(chat.id, metadata);
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const message = await chats.createMessage({
      chatId: chat.id,
      role: i % 2 ? "assistant" : "user",
      characterId: null,
      content: `대화 ${i + 1}`,
    });
    assert(message);
    ids.push(message.id);
  }
  return { id: chat.id, ids };
}
try {
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();
  assert(address && typeof address === "object");
  await createConnectionsStorage(db).create({
    name: "Output fixture",
    provider: "custom",
    model: "fixture",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: "fixture",
    isDefault: true,
  });
  const source = { id: "source", role: "assistant", content: "약속을 완료했다." };
  const parsed = parseCommittedMemoryOutput(JSON.stringify(output([source.id])), [source]);
  assert.equal(parsed.facts.length, 3);
  assert(parsed.facts.every((f) => f.status === "resolved" && f.progress === "completed"));
  for (const alias of ["pending", "in_progress", "completed", "cancelled"] as const) {
    const raw = output([source.id]);
    raw.facts = raw.facts.slice(0, 1).map((f) => ({ ...f, status: alias }));
    const fact = parseCommittedMemoryOutput(JSON.stringify(raw), [source]).facts[0]!;
    assert.equal(fact.progress, alias);
    assert.equal(fact.status, alias === "completed" || alias === "cancelled" ? "resolved" : "current");
  }
  const uncertain = {
    ...output([source.id]),
    facts: [{ ...output([source.id]).facts[0], status: "uncertain", progress: "completed" }],
  };
  assert.equal(parseCommittedMemoryOutput(JSON.stringify(uncertain), [source]).facts[0]?.status, "uncertain");
  assert.throws(
    () =>
      parseCommittedMemoryOutput(
        JSON.stringify({ ...uncertain, facts: [{ ...uncertain.facts[0], status: "completed", progress: "pending" }] }),
        [source],
      ),
    /invalid_enum_value/,
  );
  assert.throws(
    () => parseCommittedMemoryOutput('{"summary":"요약" "core":"핵심","facts":[]}', [source]),
    SyntaxError,
    "malformed output is never silently repaired",
  );
  assert.equal(resolveCommittedMemoryBatchSize({}), 20);
  const six = Array.from({ length: 6 }, (_, i) => ({ content: `m${i}` }));
  assert.deepEqual(
    planCommittedMemoryBatches(six, 5, true).batches.map((b) => b.length),
    [5],
    "6 pending at size 5 commits 5",
  );
  assert.equal(planCommittedMemoryBatches(six, 5, true).leftover.length, 1);
  assert.deepEqual(
    planCommittedMemoryBatches(six, 5, false).batches.map((b) => b.length),
    [5, 1],
    "an explicit selection commits everything",
  );
  // Two messages of just over 8000 tokens each cannot share a 16000-token batch.
  let text = "가";
  while (estimateChatSummaryTokens(text) <= 8100) text += " 가나다라";
  assert.equal(
    planCommittedMemoryBatches([{ content: text }, { content: text }, { content: text }], 5, true).batches.length,
    2,
    "a batch closed by the input limit counts as full",
  );
  assert.equal(resolveCommittedMemoryBatchSize({ summaryContextSize: 35 }), 35);
  assert.equal(resolveCommittedMemoryBatchSize({ summaryContextSize: 35, committedMemoryBatchSize: 7 }), 7);
  assert.equal(resolveCommittedMemoryBatchSize({ committedMemoryBatchSize: 7 }, { batchSize: 3 }), 3);
  const app = Fastify();
  app.decorate("db", db);
  await registerCommittedMemoryRoutes(app);
  const grouped = await room(25, { committedMemoryBatchSize: 7 });
  requests.length = 0;
  // Pending mode commits full batches only: 25 at size 7 commits 21 and leaves 4 pending.
  let status = await committedMemoryStatus(db, grouped.id);
  assert.equal(status.ready, 21);
  assert.equal(status.batchSize, 7);
  assert.equal(
    (await app.inject({ method: "POST", url: `/${grouped.id}/committed-memory/commit`, payload: {} })).statusCode,
    200,
  );
  status = await finish(grouped.id);
  assert.deepEqual(
    requests.map((r) => r.length),
    [7, 7, 7],
  );
  assert.deepEqual(requests.flat(), grouped.ids.slice(0, 21));
  assert.equal(status.state.batches.length, 3);
  assert.equal(status.pending, 4, "the short tail stays pending");
  assert.equal(status.ready, 0);
  assert(
    status.state.batches.flatMap((b) => b.facts).every((f) => f.status === "resolved" && f.progress === "completed"),
  );
  const custom = await room(12, { committedMemoryBatchSize: 7 });
  requests.length = 0;
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/${custom.id}/committed-memory/commit`,
        payload: { batchSize: 3, sourceMode: "range", rangeStartIndex: 1, rangeEndIndex: 8 },
      })
    ).statusCode,
    200,
  );
  status = await finish(custom.id);
  assert.deepEqual(
    requests.map((r) => r.length),
    [3, 3, 2],
  );
  assert.equal(status.pending, 4);
  const legacy = await room(12, { summaryContextSize: 5 });
  requests.length = 0;
  await startCommittedMemory(db, legacy.id);
  await finish(legacy.id);
  assert.deepEqual(
    requests.map((r) => r.length),
    [5, 5],
    "existing native size is honored for pending mode",
  );
  const large = await room(25, { committedMemoryBatchSize: 25 });
  requests.length = 0;
  await startCommittedMemory(db, large.id);
  status = await finish(large.id);
  assert.deepEqual(
    requests.map((r) => r.length),
    [25],
  );
  assert.equal(status.pending, 0);
  assert.equal(
    status.state.batches[0]?.facts[0]?.sourceIds.length,
    25,
    "valid source lists must not retain the old 20-message cap",
  );
  const recent = await room(12, {
    committedMemoryBatchSize: 2,
    committedMemorySourceMode: "last",
    summaryContextSize: 5,
  });
  requests.length = 0;
  await startCommittedMemory(db, recent.id);
  status = await finish(recent.id);
  assert.deepEqual(
    requests.map((r) => r.length),
    [2, 2, 1],
  );
  assert.deepEqual(requests.flat(), recent.ids.slice(-5));
  assert.equal(status.pending, 7);
  const repaired = await room(4, { committedMemoryBatchSize: 4 });
  requests.length = 0;
  mode = "malformed-once";
  await startCommittedMemory(db, repaired.id);
  status = await finish(repaired.id);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(status.pending, 0);
  assert.equal(status.state.batches.length, 1);
  for (const failureMode of ["malformed-always", "schema-always"] as const) {
    const failed = await room(3, { committedMemoryBatchSize: 3 });
    requests.length = 0;
    mode = failureMode;
    await startCommittedMemory(db, failed.id);
    status = await finish(failed.id);
    assert.equal(requests.length, 2, "invalid output has one bounded retry");
    assert.equal(status.state.job?.error, "MEMORY_OUTPUT_INVALID");
    assert.equal(status.pending, 3);
    assert.equal(status.state.batches.length, 0);
  }
  const partial = await room(4, { committedMemoryBatchSize: 2 });
  requests.length = 0;
  mode = "malformed-after-first";
  await startCommittedMemory(db, partial.id);
  status = await finish(partial.id);
  assert.equal(status.state.batches.length, 1);
  assert.equal(status.pending, 2);
  assert.equal(status.state.job?.completed, 1);
  assert.equal(requests.length, 3);
  mode = "valid";
  requests.length = 0;
  await startCommittedMemory(db, partial.id);
  status = await finish(partial.id);
  assert.deepEqual(requests, [partial.ids.slice(2)]);
  assert.equal(status.pending, 0);
  assert.equal(status.state.batches.length, 2);
  const split = await room(5, { committedMemoryBatchSize: 5 });
  requests.length = 0;
  mode = "truncated";
  await startCommittedMemory(db, split.id);
  status = await finish(split.id);
  assert.equal(requests[0]?.length, 5);
  assert(requests.every((r) => r.length <= 5));
  assert.equal(status.pending, 0);
  assert(status.state.batches.every((b) => b.sources.length <= 2));
  for (const invalid of [0, -1, 501, 1.5, "3"]) {
    const response = await app.inject({
      method: "POST",
      url: `/${split.id}/committed-memory/commit`,
      payload: { batchSize: invalid },
    });
    assert.equal(response.statusCode, 400);
  }
  await app.close();
  console.log(
    "Memory output regression passed: completed/lifecycle aliases, uncertainty/conflict guards, bounded invalid-JSON/schema retry, no failed coverage, configured grouping 7/7/7/4, native fallback, request override, recent/custom ranges, >20 source IDs and capacity splitting.",
  );
} finally {
  provider.closeAllConnections();
  await new Promise<void>((resolve) => provider.close(() => resolve()));
  await closeDB();
  rmSync(directory, { recursive: true, force: true });
}
