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
  assert.deepEqual(
    sentences.memorySentences("「行こう。」とミラが言った。「嫌だ。」とレンが答えた。"),
    ["「行こう。」とミラが言った。", "「嫌だ。」とレンが答えた。"],
    "Japanese sentences split at 。 without a space, never inside 「」",
  );
  assert.equal(
    sentences.spokenPart("“I don’t know,” he says, “maybe tomorrow.”"),
    "I don’t know, maybe tomorrow.",
    "an apostrophe never cuts a line, and every quoted part is kept",
  );
  assert.equal(sentences.spokenPart("「‘미안’이라고 하지 마.」"), "‘미안’이라고 하지 마.");
  // Voice markup and group speaker tags are not part of what the extraction reads.
  assert.equal(
    memory.memorySourceText({
      role: "assistant",
      content:
        '<audio_character id="char-9f2a">[soft laugh] 「行かないで。」</audio_character>と彼女は言った。 <speaker="Ren">"Fine."</speaker>',
    }),
    '「行かないで。」と彼女は言った。 "Fine."',
  );

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
  // A Japanese line inside a voice wrapper keeps its words, not the wrapper's tracking id.
  const tagged = memory.parseCommittedMemoryOutput(
    JSON.stringify({
      summary: "요약",
      core: "핵심",
      facts: [],
      scenes: [
        {
          event: "이별",
          audience: "shared",
          sourceIds: ["1"],
          lines: [{ speaker: "ミラ", ref: "1.1" }],
        },
      ],
    }),
    [
      {
        id: "jp",
        role: "assistant",
        content:
          '<audio_character id="char-9f2a">[soft laugh] 「行かないで。お願い。」</audio_character>と彼女は言った。',
      },
    ],
  );
  assert.equal(tagged.scenes[0]!.lines[0]!.text, "行かないで。お願い。");
  // Lines saved as a tracking id by the earlier bug are hidden on read; real words stay.
  const stored = policy.readCommittedMemory(
    {
      committedMemory: {
        version: 3,
        ownerChatId: "room",
        enabled: true,
        batches: [
          batch(1, [
            scene("old", "이별", {
              lines: [
                { speaker: "ミラ", text: "hb1WIG5AUa7D4-81rBunA", sourceId: "src1" },
                { speaker: "ミラ", text: "char-9f2a", sourceId: "src1" },
                { speaker: "ミラ", text: "行かないで。", sourceId: "src1" },
              ],
            }),
          ]),
        ],
      },
    },
    "room",
  );
  assert.deepEqual(
    stored.batches[0]!.scenes![0]!.lines.map((line) => line.text),
    ["行かないで。"],
  );
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

  // Suspicion, reasons and memory strength come through the extraction schema.
  parsed = parse({
    facts: [
      {
        kind: "fact",
        key: "보물",
        content: "보물은 우물에 있다",
        status: "current",
        audience: ["mira"],
        sourceIds: ["1"],
        unaware: [{ who: "ari", why: "자고 있었음" }, "ren", 5],
        suspects: ["ren"],
      },
    ],
    scenes: [
      {
        event: "잔치",
        audience: "shared",
        sourceIds: ["1"],
        memory: [
          { who: "ren", remembers: "partial", why: "취함" },
          { who: "ari", remembers: "fully" },
        ],
      },
    ],
  });
  assert.deepEqual(parsed.facts[0]!.unaware, [{ who: "ari", why: "자고 있었음" }, { who: "ren" }]);
  assert.deepEqual(parsed.facts[0]!.suspects, [{ who: "ren" }]);
  assert.deepEqual(parsed.scenes[0]!.memory, [{ who: "ren", remembers: "partial", why: "취함" }]);

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

  // ── Knowledge: suspicion, reasons for not knowing, memory strength ──
  const names = new Map([
    ["mira", "Mira"],
    ["ren", "Ren"],
    ["ari", "Ari"],
  ]);
  const knowledge = policy.consolidateCommittedMemory({
    version: 3,
    ownerChatId: "room",
    enabled: true,
    batches: [
      batch(
        1,
        [
          scene("party", "Mira dances on the table at the harvest party", {
            keywords: ["party"],
            memory: [
              { who: "ren", remembers: "partial", why: "drunk" },
              { who: "ari", remembers: "none", why: "asleep" },
            ],
          }),
        ],
        {
          facts: [
            {
              id: "affair",
              kind: "fact",
              key: "letter",
              content: "Mira wrote the unsigned letter",
              status: "current",
              audience: ["mira"],
              sourceIds: ["src1"],
              entityId: "letter",
              attribute: "author",
              keywords: ["letter"],
              suspectedBy: ["ren"],
              unknownTo: ["ari"],
              unknownReasons: { ari: "was away at work" },
            },
          ],
        },
      ),
    ],
  });
  const text = (query: string, audience: string[]) =>
    policy.selectCommittedMemory(knowledge, query, [], Number.POSITIVE_INFINITY, audience, new Map(), names).text;
  assert(
    text("the letter", ["ren"]).includes(
      "[suspicion] Ren suspects, without being sure: Mira wrote the unsigned letter",
    ),
    "Ren written alone only suspects it",
  );
  assert(!text("the letter", ["ari"]).includes("letter"), "Ari neither knows nor suspects it");
  const group = text("the letter", ["mira", "ren", "ari"]);
  assert(group.includes("(only suspected by: Ren)"), group);
  assert(group.includes("not known by: Ren, Ari (was away at work)"), group);
  // A forgotten scene stays out for the one who forgot it; a blurred one comes with that note.
  assert(!text("the party", ["ari"]).includes("harvest party"));
  assert(text("the party", ["ren"]).includes("Memory: Ren remembers it only vaguely (drunk)"));
  assert(
    text("the party", []).includes("Memory: Ren remembers it only vaguely (drunk); Ari does not remember it (asleep)"),
  );
  // Suspicion ends when the suspecter comes to know it.
  const learned = policy.consolidateCommittedMemory({
    ...knowledge,
    batches: [
      ...knowledge.batches,
      batch(2, [], {
        facts: [
          {
            ...knowledge.batches[0]!.facts[0]!,
            id: "affair-2",
            audience: ["mira", "ren"],
            suspectedBy: undefined,
            unknownReasons: undefined,
          },
        ],
      }),
    ],
  });
  const latestFact = learned.batches.flatMap((b) => b.facts).find((f) => f.entityId === "letter")!;
  assert.equal(latestFact.suspectedBy, undefined, "a suspicion ends when its holder knows");
  assert.deepEqual(
    latestFact.unknownReasons,
    { ari: "was away at work" },
    "reasons stay for those who still do not know",
  );

  // ── Daily life ──
  const life = (turn: number, routine: Array<Record<string, unknown>>) =>
    batch(turn, [], {
      routine: routine.map((entry, index) => ({ id: `r${turn}-${index}`, sourceId: `src${turn}`, ...entry })),
    } as Partial<CommittedMemoryBatch>);
  const lifeState = {
    version: 3 as const,
    ownerChatId: "room",
    enabled: true,
    batches: [
      life(1, [
        { who: "Mira", what: "meal", text: "porridge", at: "24-10-18 08:10" },
        { who: "Mira", what: "wash", text: "a bath", at: "24-10-18 09:00" },
      ]),
      life(2, [
        { who: "Mira·Ren", what: "meal", text: "stew", at: "24-10-18 19:00" },
        { who: "Mira", what: "sleep", at: "24-10-18 23:30" },
      ]),
      life(3, [
        { who: "Mira", what: "wake", at: "24-10-19 07:15" },
        { who: "Ren", what: "meal", text: "coffee", substitute: true, at: "24-10-19 07:30", claimed: true },
        { who: "Ren", what: "medicine", text: "painkiller", at: "24-10-19 08:00" },
      ]),
    ],
  };
  const lifeText = policy.selectCommittedMemory(lifeState, "Mira and Ren talk", [], Number.POSITIVE_INFINITY).text;
  assert(lifeText.includes(`<daily_life>\n${policy.DAILY_LIFE_INSTRUCTION}`), lifeText);
  assert(
    lifeText.includes(
      "- Mira: last meal: stew (message 2, 24-10-18 19:00; meal 2 that day) · slept message 2, 24-10-18 23:30 → woke message 3, 24-10-19 07:15 (7.8 h) · washed: a bath (message 1, 24-10-18 09:00)",
    ),
    lifeText,
  );
  assert(
    lifeText.includes(
      "- Ren: last meal: coffee (made do) (message 3, 24-10-19 07:30, said) · medicine: painkiller (message 3, 24-10-19 08:00)",
    ),
    lifeText,
  );
  // A corrected entry leaves the counts.
  lifeState.batches[1]!.routine![0]!.excluded = true;
  assert(
    policy
      .selectCommittedMemory(lifeState, "Mira", [], Number.POSITIVE_INFINITY)
      .text.includes("- Mira: last meal: porridge (message 1, 24-10-18 08:10; meal 1 that day)"),
  );
  // Extraction: drinks are not meals unless they replace one; references become message IDs.
  const lifeParse = parse({
    routine: [
      { who: "Ren", what: "meal", text: "coffee", ref: "2.1" },
      { who: "Ren", what: "meal", text: "coffee", how: "substitute", ref: "2.1" },
      { who: "Mira", what: "sleep", ref: "1.1", at: "밤 11:30" },
      { who: "Mira", what: "dance" },
    ],
  });
  assert.deepEqual(
    lifeParse.routine.map((r) => [r.who, r.what, r.substitute ?? false, r.sourceId]),
    [
      ["Ren", "meal", true, "m2"],
      ["Mira", "sleep", false, "m1"],
    ],
  );

  // ── Unresolved emotions ──
  const emotionParse = parse({
    facts: [
      {
        kind: "emotion",
        key: "렌의 서운함",
        content: "렌은 미라에게 서운하다",
        cause: "미라가 약속을 잊음",
        endCondition: "미라의 사과",
        status: "current",
        audience: "shared",
        sourceIds: ["2"],
      },
      {
        kind: "emotion",
        key: "기쁨",
        content: "렌이 기뻐한다",
        status: "current",
        audience: "shared",
        sourceIds: ["2"],
      },
    ],
  });
  assert.deepEqual(
    emotionParse.facts.map((f) => f.key),
    ["렌의 서운함"],
    "a feeling that cannot say what it needs is not recorded",
  );
  const feelings = policy.consolidateCommittedMemory({
    version: 3,
    ownerChatId: "room",
    enabled: true,
    batches: [
      batch(1, [], {
        facts: [
          {
            id: "hurt",
            kind: "emotion",
            key: "ren hurt",
            content: "Ren is hurt by Mira",
            cause: "Mira forgot the promise",
            endCondition: "an apology from Mira",
            status: "current",
            audience: "shared",
            sourceIds: ["src1"],
            entityId: "ren",
            attribute: "feeling:mira",
          },
        ],
      }),
    ],
  });
  const feelingText = policy.selectCommittedMemory(feelings, "they talk", [], Number.POSITIVE_INFINITY).text;
  assert(
    feelingText.includes(
      "[emotion] Ren is hurt by Mira (cause: Mira forgot the promise) (needs: an apology from Mira) (last development at message 1)",
    ),
    "a dormant feeling comes back with what it needs",
  );

  console.log("Committed memory ledger ideas passed.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
