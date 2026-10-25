// Unified memory: false beliefs, thread clues and stalled threads, relationship history, the previous scene for
// continuity, and a retry that is told what was rejected.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directory = mkdtempSync(join(tmpdir(), "memory-beliefs-"));
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
const { threadStalled } = await import("../../packages/shared/src/utils/committed-memory-threads.js");
import type { CommittedMemoryBatch, CommittedMemoryFact } from "../../packages/shared/src/types/committed-memory.js";

const fact = (id: string, over: Partial<CommittedMemoryFact> = {}): CommittedMemoryFact => ({
  id,
  kind: "fact",
  key: id,
  content: `${id} content`,
  status: "current",
  audience: "shared",
  sourceIds: [`s-${id}`],
  ...over,
});
const at = (turn: number, facts: CommittedMemoryFact[]): CommittedMemoryBatch => ({
  id: `b${turn}`,
  turn,
  createdAt: "2026-10-25T00:00:00.000Z",
  sources: [{ id: `src${turn}`, fingerprint: `fp${turn}` }],
  summary: "",
  core: "",
  facts,
});
const build = (batches: CommittedMemoryBatch[]) =>
  policy.consolidateCommittedMemory({ version: 3, ownerChatId: "room", enabled: true, batches });
const names = new Map([
  ["mira", "Mira"],
  ["ren", "Ren"],
  ["ari", "Ari"],
]);
const select = (state: ReturnType<typeof build>, query: string, audience: string[]) =>
  policy.selectCommittedMemory(state, query, [], Number.POSITIVE_INFINITY, audience, new Map(), names).text;

try {
  // ── False beliefs ──
  const form = (over: Partial<CommittedMemoryFact>) =>
    fact("form", { kind: "state", entityId: "mira", attribute: "form", keywords: ["Mira"], ...over });
  let state = build([
    at(1, [
      form({
        content: "Mira is a cursed human",
        audience: ["mira"],
        falseBeliefs: [{ who: "ren", believes: "Mira is an ordinary dog" }],
      }),
    ]),
    // A later value keeps the belief without repeating it.
    at(2, [form({ content: "Mira is a cursed human in borzoi form", audience: ["mira"] })]),
  ]);
  let current = state.batches.flatMap((b) => b.facts)[0]!;
  assert.deepEqual(current.falseBeliefs, [{ who: "ren", believes: "Mira is an ordinary dog" }], "beliefs carry over");
  // Ren, written alone, acts on his belief and never sees the truth.
  let prompt = select(state, "Mira runs", ["ren"]);
  assert(prompt.includes("[belief] Ren believes: Mira is an ordinary dog"), prompt);
  assert(!prompt.includes("cursed human"), "the truth stays out of Ren's memory");
  // Ari neither knows nor believes anything about it.
  assert(!select(state, "Mira runs", ["ari"]).includes("Mira"));
  // Mira knows the truth and is told Ren believes otherwise.
  prompt = select(state, "Mira runs", ["mira", "ren"]);
  assert(prompt.includes("<knowledge_boundaries>"));
  assert(prompt.includes("wrongly believed: Ren believes Mira is an ordinary dog"), prompt);
  assert(prompt.includes("not known by: Ren"));
  // Learning the truth ends the belief.
  state = build([
    ...state.batches,
    at(3, [form({ content: "Mira is a cursed human in borzoi form", audience: ["mira", "ren"] })]),
  ]);
  current = state.batches.flatMap((b) => b.facts).find((f) => f.id === "form")!;
  assert.equal(current.falseBeliefs, undefined, "a belief ends when its holder learns the truth");
  assert(!select(state, "Mira runs", ["ren"]).includes("[belief]"));
  // An explicit empty list clears beliefs; a shared record keeps its believers marked for the narrator.
  state = build([
    at(1, [fact("rumor", { keywords: ["bell"], falseBeliefs: [{ who: "ari", believes: "the bell is haunted" }] })]),
  ]);
  assert(select(state, "the bell", []).includes("(wrongly believed: Ari believes the bell is haunted)"));
  state = build([...state.batches, at(2, [fact("rumor", { keywords: ["bell"], falseBeliefs: [] })])]);
  assert(!select(state, "the bell", []).includes("wrongly believed"));

  // ── Threads: clues add up, the newest development wins, stalled after five quiet batches ──
  const letter = (over: Partial<CommittedMemoryFact>) =>
    fact("letter", {
      kind: "thread",
      content: "Who sent the unsigned letter?",
      entityId: "letter",
      attribute: "sender",
      keywords: ["letter"],
      ...over,
    });
  const quiet = (turns: number[]) => turns.map((turn) => at(turn, [fact(`q${turn}`)]));
  state = build([
    at(1, [letter({ clues: [{ text: "violet wax seal", turn: 1 }], latest: "A letter arrives" })]),
    at(2, [
      letter({
        clues: [
          { text: "smells of cedar", turn: 2 },
          { text: "violet wax seal", turn: 2 },
        ],
        latest: "Ren sniffs it",
      }),
    ]),
    ...quiet([3, 4, 5, 6]),
  ]);
  current = state.batches.flatMap((b) => b.facts).find((f) => f.id === "letter")!;
  assert.deepEqual(
    current.clues?.map((c) => c.text),
    ["violet wax seal", "smells of cedar"],
    "clues add up and a repeated one stays once",
  );
  assert.equal(current.latest, "Ren sniffs it");
  prompt = select(state, "the letter", []);
  assert(
    prompt.includes(
      "Who sent the unsigned letter? (latest: Ren sniffs it) (clues: violet wax seal [message 2]; smells of cedar [message 2]) (last development at message 2)",
    ),
    prompt,
  );
  const turnsAfter = (s: ReturnType<typeof build>) => s.batches.map((b) => b.turn);
  assert.equal(threadStalled(current, 2, turnsAfter(state)), false, "four quiet batches are not yet stalled");
  state = build([...state.batches, ...quiet([7])]);
  assert(select(state, "the letter", []).includes("(stalled since message 2)"));
  // A new clue alone moves it again.
  state = build([...state.batches, at(8, [letter({ clues: [{ text: "a cedar box", turn: 8 }] })])]);
  current = state.batches.flatMap((b) => b.facts).find((f) => f.id === "letter")!;
  assert.equal(current.clues?.length, 3);
  assert.equal(current.latest, "Ren sniffs it", "no new development keeps the last one");
  assert(select(state, "the letter", []).includes("(last development at message 8)"));

  // ── Relationship history ──
  const bond = (content: string) =>
    fact("bond", { kind: "relationship", entityId: "ren", attribute: "relationship:mira", content, keywords: ["Ren"] });
  state = build([
    at(1, [bond("Ren distrusts Mira")]),
    at(2, [bond("Ren trusts Mira")]),
    at(3, [bond("Ren loves Mira")]),
  ]);
  assert(
    select(state, "Ren", []).includes(
      "[relationship] Ren loves Mira (changed at message 3. Before: Ren trusts Mira (message 2) ← Ren distrusts Mira (message 1))",
    ),
  );

  // ── Extraction: clue strings, beliefs only for characters of this room who do not know ──
  const parsed = memory.parseCommittedMemoryOutput(
    JSON.stringify({
      summary: "요약",
      core: "핵심",
      facts: [
        {
          kind: "thread",
          key: "편지",
          content: "누가 편지를 보냈나",
          status: "current",
          audience: "shared",
          sourceIds: ["m1"],
          clues: ["보라색 봉랍", { text: "삼나무 향" }, 7],
          latest: "편지가 도착했다",
          falseBeliefs: [{ who: "ren", believes: "아리가 보냈다" }, { who: 3 }],
        },
      ],
    }),
    [{ id: "m1", role: "assistant", content: "편지가 도착했다." }],
  );
  assert.deepEqual(
    parsed.facts[0]!.clues?.map((c) => c.text),
    ["보라색 봉랍", "삼나무 향"],
  );
  assert.equal(parsed.facts[0]!.falseBeliefs?.length, 1);

  // ── Through the service: the retry hears what was rejected; the previous scene goes with the next batch ──
  const requests: string[] = [];
  let rejectFirst = true;
  const provider = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const request = JSON.parse(Buffer.concat(chunks).toString());
    const system = request.messages[0].content as string;
    requests.push(system);
    const transcript = JSON.parse(request.messages[1].content) as Array<{ id: string; content: string }>;
    const message = transcript[0]!;
    const body = rejectFirst
      ? { summary: "x", core: "x", facts: [{ kind: "fact" }] }
      : {
          summary: message.content,
          core: message.content,
          facts: [],
          scenes: [
            {
              when: "밤",
              where: "숲",
              participants: ["미라", "렌"],
              event: message.content,
              changes: ["미라: 인간 → 보르조이"],
              audience: "shared",
              sourceIds: [message.id],
            },
          ],
        };
    rejectFirst = false;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: JSON.stringify(body) }, finish_reason: "stop" }],
      }),
    );
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const db = await getDB();
  try {
    const address = provider.address();
    assert(address && typeof address === "object");
    await createConnectionsStorage(db).create({
      name: "Beliefs fixture",
      provider: "custom",
      model: "fixture",
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      apiKey: "fixture",
      isDefault: true,
    });
    const chats = createChatsStorage(db);
    const chat = await chats.create({ name: "Continuity", mode: "roleplay", characterIds: [] });
    assert(chat);
    await chats.patchMetadata(chat.id, { committedMemoryBatchSize: 1 });
    for (const content of ["미라가 숲에서 보르조이가 되었다.", "렌이 미라를 쓰다듬는다."])
      await chats.createMessage({ chatId: chat.id, role: "assistant", characterId: null, content });
    await memory.startCommittedMemory(db, chat.id);
    const until = Date.now() + 15000;
    while ((await memory.committedMemoryStatus(db, chat.id)).state.job?.status === "running") {
      if (Date.now() > until) throw new Error("Memory job timed out");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const status = await memory.committedMemoryStatus(db, chat.id);
    assert.equal(status.state.job?.status, "complete");
    assert.equal(status.state.batches.length, 2);
    assert(requests[1]!.includes("The previous response was rejected: facts.0."), "the retry names the problem");
    assert(requests[1]!.includes("Omit a field instead of writing null"));
    assert(!requests[0]!.includes("Previous scene"), "the first batch has no previous scene");
    const second = requests.at(-1)!;
    assert(second.includes("Previous scene, for continuity only"));
    assert(second.includes('"where":"숲"') && second.includes('"changes":["미라: 인간 → 보르조이"]'), second);
  } finally {
    await new Promise<void>((resolve) => provider.close(() => resolve()));
    await closeDB();
  }
  console.log(
    "Committed memory beliefs passed: false beliefs scoped and ended, clues and stalled threads, relationship history, retry feedback and previous scene.",
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
