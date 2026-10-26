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
const policy = await import("../../packages/server/src/services/committed-memory-policy.js");
import type { CommittedMemoryBatch, CommittedMemoryScene } from "../../packages/shared/src/types/committed-memory.js";
const scene = (id: string, event: string, over: Partial<CommittedMemoryScene> = {}): CommittedMemoryScene => ({
  id,
  participants: ["Mira", "Ren"],
  event,
  lines: [],
  changes: [],
  audience: "shared",
  sourceIds: [`src-${id}`],
  ...over,
});
const batch = (turn: number, scenes: CommittedMemoryScene[], over: Partial<CommittedMemoryBatch> = {}) => ({
  id: `b${turn}`,
  turn,
  createdAt: "2026-10-26T00:00:00.000Z",
  sources: [{ id: `src${turn}`, fingerprint: `fp${turn}` }],
  summary: `Episode ${turn}`,
  core: `Episode ${turn}`,
  facts: [],
  scenes,
  ...over,
});

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

  // ── Recall: rare words and back-references ──
  const walk = (turn: number, extra = "") =>
    batch(turn, [scene(`s${turn}`, `Mira and Ren walk the road ${extra}`.trim())]);
  const recallState = {
    version: 3 as const,
    ownerChatId: "room",
    enabled: true,
    // Old enough that their summaries are no longer "recent" and must be called up.
    recall: { recentMessages: 1 },
    batches: [
      walk(2, "to the lighthouse"),
      walk(3),
      walk(4, "; a violet umbrella is left behind"),
      walk(5, "past the lighthouse in a storm"),
      walk(6),
      walk(7, "back to the lighthouse in the storm"),
      walk(8),
      walk(9, "and the lighthouse storm again"),
      walk(10),
      walk(11),
      batch(12, [scene("s12", "미라가 등대 앞에 보라색 우산을 두고 갔다")]),
    ],
  };
  const recalled = (query: string) =>
    policy
      .selectCommittedMemory(recallState, query, [], Number.POSITIVE_INFINITY)
      .selected.filter((item) => item.tier === "scene")
      .map((item) => item.id);
  assert(recalled("Where is the violet umbrella?").includes("s4"), "a word said once calls its scene up");
  assert(!recalled("Where is the umbrella of Mira and Ren?").includes("s3"), "words every scene has call nothing");
  assert(recalled("보라색 우산은 어디 있어?").includes("s12"), "Korean words match across endings");
  assert.deepEqual(recalled("the lighthouse storm").sort(), ["s5", "s7", "s9"]);
  assert(
    recalled("그때 말했잖아, the lighthouse storm").includes("s2"),
    "pointing back brings the first scene where it came up",
  );

  console.log("Committed memory ledger ideas passed.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
