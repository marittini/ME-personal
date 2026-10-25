// Unified memory format 3: scene records with verbatim key lines, state and thread kinds, and update operations
// whose targets and quotes the server checks.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directory = mkdtempSync(join(tmpdir(), "memory-v3-"));
process.env.DATA_DIR = directory;
process.env.FILE_STORAGE_DIR = join(directory, "storage");
process.env.NODE_ENV = "test";
process.env.MARINARA_LITE = "true";
process.env.LOG_LEVEL = "silent";
const memory = await import("../../packages/server/src/services/committed-memory.js");
const policy = await import("../../packages/server/src/services/committed-memory-policy.js");
import type {
  CommittedMemoryBatch,
  CommittedMemoryFact,
  CommittedMemoryScene,
} from "../../packages/shared/src/types/committed-memory.js";

const sources = [
  { id: "m1", role: "assistant", content: "Mira's body twists, and she becomes a borzoi again." },
  { id: "m2", role: "assistant", content: 'Ren blinks. "You were human a moment ago," he whispers. He skips dinner.' },
  { id: "m3", role: "assistant", content: "Ren finally tells Ari: “The key is under the well.”" },
];
const known: CommittedMemoryFact[] = [
  {
    id: "form",
    kind: "state",
    key: "mira:form",
    content: "Mira is human",
    status: "current",
    audience: "shared",
    sourceIds: ["old"],
    entityId: "mira",
    attribute: "form",
  },
  {
    id: "secret",
    kind: "fact",
    key: "key:location",
    content: "The key is under the well",
    status: "current",
    audience: ["ren"],
    sourceIds: ["old"],
    entityId: "key",
    attribute: "location",
  },
  {
    id: "thread",
    kind: "thread",
    key: "who-sent-letter",
    content: "Who sent the unsigned letter?",
    status: "current",
    audience: "shared",
    sourceIds: ["old"],
    entityId: "letter",
    attribute: "sender",
  },
];
const fact = (over: Record<string, unknown>) => ({
  kind: "fact",
  key: "k",
  content: "c",
  status: "current",
  audience: "shared",
  sourceIds: ["m1"],
  ...over,
});
const output = (facts: unknown[], scenes: unknown[] = []) =>
  JSON.stringify({ summary: "s", core: "c", summaryKo: "요약", coreKo: "핵심", facts, scenes });
const parse = (facts: unknown[], scenes: unknown[] = []) =>
  memory.parseCommittedMemoryOutput(
    output(
      facts.map((f) => ({ keyKo: "키", contentKo: "내용", ...(f as object) })),
      scenes,
    ),
    sources,
    known,
    new Set(["mira", "key", "letter"]),
  );

try {
  // A state change is an update of the same slot.
  let parsed = parse([
    fact({ op: "update", existingId: "form", kind: "state", content: "Mira is a borzoi", attribute: "form" }),
  ]);
  assert.equal(parsed.facts[0]!.op, "update");
  assert.equal(parsed.facts[0]!.entityId, "mira");

  // reveal widens the audience, needs a verbatim quote, and drops without one.
  parsed = parse([
    fact({
      op: "reveal",
      existingId: "secret",
      audience: ["ari"],
      evidence: "the key is under the well",
      sourceIds: ["m3"],
    }),
  ]);
  assert.deepEqual(parsed.facts[0]!.audience, ["ren", "ari"], "reveal adds the new knowers to the old ones");
  assert.equal(parsed.facts[0]!.evidence, "the key is under the well");
  parsed = parse([
    fact({ op: "reveal", existingId: "secret", audience: ["ari"], evidence: "Ren draws a map", sourceIds: ["m3"] }),
  ]);
  assert.equal(parsed.facts.length, 0, "a reveal whose quote is not in the transcript is dropped");
  parsed = parse([fact({ op: "reveal", existingId: "secret", audience: ["ari"], sourceIds: ["m3"] })]);
  assert.equal(parsed.facts.length, 0, "a reveal without a quote is dropped");

  // resolve closes a thread with a quote; archive closes without one; unknown targets are dropped.
  parsed = parse([
    fact({
      op: "resolve",
      existingId: "thread",
      kind: "thread",
      content: "Ren sent the letter",
      evidence: "“The key is under the well.”",
      sourceIds: ["m3"],
    }),
  ]);
  assert.equal(parsed.facts[0]!.status, "resolved");
  assert.deepEqual(parsed.facts[0]!.audience, "shared", "resolve keeps the record's knowledge");
  parsed = parse([fact({ op: "archive", existingId: "form", kind: "fact", content: "no longer" })]);
  assert.equal(parsed.facts[0]!.status, "resolved");
  assert.equal(parsed.facts[0]!.kind, "state", "an operation keeps the target's kind");
  parsed = parse([fact({ op: "resolve", existingId: "missing", evidence: "Ren blinks" })]);
  assert.equal(parsed.facts.length, 0, "an operation on an unknown record is dropped");
  // An update to an unknown record still fails the whole output (it may be a scope error).
  assert.throws(() => parse([fact({ op: "update", existingId: "missing" })]), /unknown/);
  // add with an ID is an update; no op means add or update.
  parsed = parse([fact({ op: "add", existingId: "form", kind: "state", content: "Mira is a borzoi" })]);
  assert.equal(parsed.facts[0]!.op, "update");
  parsed = parse([
    fact({
      kind: "thread",
      key: "the-howl",
      content: "A howl at night",
      endCondition: "its source",
      endConditionKo: "울음의 정체",
    }),
  ]);
  assert.equal(parsed.facts[0]!.op, "add");
  assert.equal(parsed.facts[0]!.kind, "thread");

  // Scenes: key lines are kept only when they appear verbatim in the message they name, at most three.
  parsed = parse(
    [],
    [
      {
        when: "night",
        where: "forest",
        participants: ["Mira", "Ren"],
        event: "Mira turns back into a borzoi in front of Ren; Ren skips dinner.",
        eventKo: "미라가 렌 앞에서 다시 보르조이가 되고, 렌은 저녁을 거른다.",
        lines: [
          { speaker: "Ren", to: "Mira", text: "You were human a moment ago", sourceId: "m2" },
          { speaker: "Ren", text: "You were a wolf all along", sourceId: "m2" },
          { speaker: "Ren", text: "You were human a moment ago", sourceId: "m1" },
        ],
        changes: ["Mira: human → borzoi"],
        audience: "shared",
        sourceIds: ["m1", "m2"],
      },
    ],
  );
  assert.equal(parsed.scenes.length, 1);
  assert.deepEqual(
    parsed.scenes[0]!.lines.map((line) => line.text),
    ["You were human a moment ago"],
    "paraphrased lines and lines attributed to the wrong message are dropped",
  );
  assert.throws(
    () => parse([], [{ event: "x", eventKo: "엑스", audience: "shared", sourceIds: ["elsewhere"] }]),
    /unsupported source/,
  );
  assert.throws(
    () => parse([], [{ event: "An English event", audience: "shared", sourceIds: ["m1"] }]),
    /Korean display/,
    "a scene in another language needs its Korean display text",
  );
  assert.equal(memory.memoryQuoteFound("a", sources), false, "a one-character quote proves nothing");
  // ── Injection ──
  const slot = (id: string, content: string, over: Partial<CommittedMemoryFact> = {}): CommittedMemoryFact => ({
    id,
    kind: "state",
    key: "mira:form",
    content,
    status: "current",
    audience: "shared",
    sourceIds: [`m${id}`],
    entityId: "mira",
    attribute: "form",
    ...over,
  });
  const at = (
    turn: number,
    facts: CommittedMemoryFact[],
    scenes: CommittedMemoryScene[] = [],
  ): CommittedMemoryBatch => ({
    id: `b${turn}`,
    turn,
    createdAt: "2026-10-25T00:00:00.000Z",
    sources: [{ id: `src${turn}`, fingerprint: `fp${turn}` }],
    summary: `Episode ${turn}`,
    core: `Episode ${turn}`,
    facts,
    scenes,
  });
  const thread = (id: string, content: string, over: Partial<CommittedMemoryFact> = {}): CommittedMemoryFact => ({
    id,
    kind: "thread",
    key: id,
    content,
    status: "current",
    audience: "shared",
    sourceIds: [id],
    entityId: id,
    attribute: "open",
    keywords: [id],
    ...over,
  });
  const scene: CommittedMemoryScene = {
    id: "well-scene",
    when: "dawn",
    where: "the old well",
    participants: ["Ren", "Ari"],
    event: "Ren shows Ari where the key is hidden.",
    lines: [{ speaker: "Ren", to: "Ari", text: "The key is under the well.", sourceId: "src5" }],
    changes: ["Ari now knows where the key is"],
    audience: "shared",
    sourceIds: ["src5"],
    keywords: ["well", "key"],
  };
  const state = policy.consolidateCommittedMemory({
    version: 3,
    ownerChatId: "room",
    enabled: true,
    entities: [{ id: "mira", name: "Mira", aliases: ["미라"], kind: "person", createdAt: "2026-10-25" }],
    batches: [
      at(1, [slot("1", "Mira is human")]),
      at(2, [slot("2", "Mira is a borzoi")]),
      at(3, [slot("3", "Mira is human", { audience: ["ren"] })]),
      at(4, [
        slot("4", "Mira is a borzoi"),
        thread("letter", "Who sent the unsigned letter?", { endCondition: "the sender is named" }),
        thread("howl", "Something howls at night"),
        thread("scar", "Ren hides a scar"),
        thread("bell", "The bell rang by itself"),
        {
          ...thread("book", "Alice will return the book"),
          kind: "promise",
          progress: "pending",
          endCondition: "the book is back",
        },
      ]),
      at(5, [], [scene]),
    ],
  });
  const names = new Map([
    ["mira", "Mira"],
    ["ren", "Ren"],
    ["ari", "Ari"],
  ]);
  const select = (query: string, audience: string[] = []) =>
    policy.selectCommittedMemory(state, query, [], Number.POSITIVE_INFINITY, audience, new Map(), names);
  // The borzoi case: the current form comes with its change history and who knew, even when nobody named her.
  let prompt = select("They walk on.", ["mira", "ren"]).text;
  assert(prompt.startsWith(policy.MEMORY_RECENCY_INSTRUCTION), "recent conversation wins over memory");
  assert(prompt.includes(`<scene_state>\n${policy.SCENE_STATE_INSTRUCTION}`));
  assert(
    prompt.includes(
      "[state] Mira is a borzoi (changed at message 4. Before: Mira is human (message 3; known to: Ren) ← Mira is a borzoi (message 2) ← Mira is human (message 1))",
    ),
    prompt,
  );
  assert(
    select("They walk on.", ["ari"]).text.includes(
      "[state] Mira is a borzoi (changed at message 4. Before: Mira is a borzoi (message 2) ← Mira is human (message 1))",
    ),
    "an earlier value only Ren knew stays out of Ari's memory",
  );
  // Threads: the promise is always there; dormant threads take turns, two at a time.
  assert(prompt.includes(`<open_threads>\n${policy.OPEN_THREAD_INSTRUCTION}`));
  assert(prompt.includes("[promise:pending] Alice will return the book (closes when: the book is back)"));
  const dormant = ["unsigned letter", "howls at night", "hides a scar", "rang by itself"];
  const seenThreads = new Set<string>();
  for (let turn = 0; turn < 40; turn++) {
    const text = select(`They walk on. ${turn}`).text;
    const shown = dormant.filter((d) => text.includes(d));
    assert.equal(shown.length, 2, "two dormant threads per turn");
    shown.forEach((d) => seenThreads.add(d));
  }
  assert.equal(seenThreads.size, 4, "every dormant thread comes back in rotation");
  prompt = select("The letter on the table.").text;
  assert(
    prompt.includes("Who sent the unsigned letter? (closes when: the sender is named) (open since message 4)"),
    "a thread the moment calls comes first",
  );
  // Scenes come back with their exact lines when called, and only for those who saw them.
  assert(!select("They walk on.").text.includes("<recalled_scenes>"));
  prompt = select("Ari looks at the well.").text;
  assert(prompt.includes(`<recalled_scenes>\n${policy.RECALLED_SCENE_INSTRUCTION}`));
  assert(
    prompt.includes("[Scene, message 5; dawn; the old well; present: Ren, Ari] Ren shows Ari where the key is hidden."),
  );
  assert(prompt.includes('  Ren → Ari: "The key is under the well."'));
  const privateState = structuredClone(state);
  privateState.batches.at(-1)!.scenes![0]!.audience = ["ren"];
  assert(
    !policy
      .selectCommittedMemory(privateState, "the well", [], Number.POSITIVE_INFINITY, ["ari"], new Map(), names)
      .text.includes("<recalled_scenes>"),
    "a scene stays with those who saw it",
  );
  assert.equal(policy.selectCommittedMemory({ ...state, batches: [] }, "x").text, "", "no memory, no note");
  console.log(
    "Committed memory format 3 passed: operations, quotes, scenes and key lines; state history, thread rotation and scene recall.",
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
