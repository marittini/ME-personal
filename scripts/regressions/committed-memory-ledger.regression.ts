// Unified memory ideas from marinara-memory-module: numbered sentences as evidence, rare-word and back-reference
// recall, suspicion and memory strength, the daily-life log and unresolved emotions.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directory = mkdtempSync(join(tmpdir(), "memory-ledger-"));
process.env.DATA_DIR = directory;
process.env.FILE_STORAGE_DIR = join(directory, "storage");
process.env.NODE_ENV = "test";
process.env.MARINARA_LITE = "true";
process.env.LOG_LEVEL = "silent";
const memory = await import("../../packages/server/src/services/committed-memory.js");
const sentences = await import("../../packages/server/src/services/committed-memory-sentences.js");

try {
  // ── Numbered sentences ──
  assert.deepEqual(sentences.memorySentences('Ren blinks. "Wait. You were human," he says.\nMira barks!'), [
    "Ren blinks.",
    '"Wait. You were human," he says.',
    "Mira barks!",
  ]);
  assert.equal(
    sentences.numberedMemoryText("렌이 눈을 깜빡인다. 「잠깐. 너 사람이었잖아.」\n미라가 짖는다.", 2),
    "[2.1] 렌이 눈을 깜빡인다. [2.2] 「잠깐. 너 사람이었잖아.」\n[2.3] 미라가 짖는다.",
    "quotes stay whole and numbering runs through the message",
  );
  assert.equal(sentences.spokenPart('"You were human," he says.'), "You were human,");

  const sources = [
    { id: "m1", role: "assistant", content: "Mira turns into a borzoi." },
    {
      id: "m2",
      role: "assistant",
      content: 'Ren blinks. "You were human a moment ago," he whispers. He skips dinner.',
    },
  ];
  const parse = (body: Record<string, unknown>) =>
    memory.parseCommittedMemoryOutput(
      JSON.stringify({ summary: "요약", core: "핵심", facts: [], scenes: [], ...body }),
      sources,
      [
        {
          id: "secret",
          kind: "fact",
          key: "key",
          content: "The key is under the well",
          status: "current",
          audience: ["ren"],
          sourceIds: ["old"],
          entityId: "key",
          attribute: "location",
        },
      ],
      new Set(["key"]),
    );
  // A line given by sentence number is copied from the transcript, spoken words only.
  let parsed = parse({
    scenes: [
      {
        event: "변신",
        audience: "shared",
        sourceIds: ["1", "2.2"],
        lines: [
          { speaker: "Ren", to: "Mira", ref: "2.2" },
          { speaker: "Ren", ref: "2.2", text: "human a moment" },
          { speaker: "Ren", ref: "9.9" },
        ],
      },
    ],
  });
  assert.deepEqual(
    parsed.scenes[0]!.lines.map((line) => [line.text, line.sourceId]),
    [
      ["You were human a moment ago,", "m2"],
      ["human a moment", "m2"],
    ],
    "the words come from the sentence; a missing sentence is dropped",
  );
  assert.deepEqual(parsed.scenes[0]!.sourceIds, ["m1", "m2"], "message and sentence numbers become message IDs");
  // Evidence by sentence number: the phrase when it is in the sentence, else the whole sentence.
  parsed = parse({
    facts: [
      {
        op: "reveal",
        existingId: "secret",
        kind: "fact",
        key: "key",
        content: "The key is under the well",
        keyKo: "열쇠",
        contentKo: "열쇠는 우물 아래",
        status: "current",
        audience: ["ari"],
        sourceIds: ["2"],
        evidence: { ref: "2.3", q: "skips dinner" },
      },
    ],
  });
  assert.equal(parsed.facts[0]!.evidence, "skips dinner");
  assert.deepEqual(parsed.facts[0]!.audience, ["ren", "ari"]);
  parsed = parse({
    facts: [
      {
        op: "reveal",
        existingId: "secret",
        kind: "fact",
        key: "key",
        content: "x",
        keyKo: "열쇠",
        contentKo: "엑스",
        status: "current",
        audience: ["ari"],
        sourceIds: ["m2"],
        evidence: { ref: "7.1", q: "nothing" },
      },
    ],
  });
  assert.equal(parsed.facts.length, 0, "evidence pointing at no sentence drops the operation");

  console.log("Committed memory ledger ideas passed.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
