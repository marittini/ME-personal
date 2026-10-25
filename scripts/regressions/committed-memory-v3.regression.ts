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
import type { CommittedMemoryFact } from "../../packages/shared/src/types/committed-memory.js";

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
  console.log("Committed memory format 3 extraction passed: operations, quotes, scenes and key lines.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
