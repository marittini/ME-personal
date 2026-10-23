import assert from "node:assert/strict";
import {
  emptyCommittedMemory,
  memoryFingerprint,
  pendingMemoryMessages,
  reconcileCommittedMemory,
  readCommittedMemory,
  selectCommittedMemory,
} from "../../packages/server/src/services/committed-memory-policy.js";
import type { CommittedMemoryState, CommittedMemoryBatch } from "../../packages/shared/src/types/committed-memory.js";
const message = {
  id: "a",
  role: "assistant",
  content: "손수건을 맡겼다",
  activeSwipeIndex: 1,
  memoryRevision: "r1",
  extra: {},
};
const batch: CommittedMemoryBatch = {
  id: "batch",
  turn: 1,
  createdAt: "2026-01-01",
  sources: [{ id: message.id, fingerprint: memoryFingerprint(message) }],
  summary: "상세 대화와 몸짓",
  core: "손수건을 맡겼다",
  facts: [
    {
      id: "promise",
      kind: "promise",
      key: "손수건 반환",
      content: "손수건을 돌려주기로 약속했다",
      status: "current",
      audience: "shared",
      sourceIds: [message.id],
    },
    {
      id: "secret",
      kind: "belief",
      key: "비밀",
      content: "비밀을 안다",
      status: "current",
      audience: ["alice"],
      sourceIds: [message.id],
    },
  ],
};
const state: CommittedMemoryState = { ...emptyCommittedMemory("room"), enabled: true, batches: [batch] };
assert.equal(pendingMemoryMessages(state, [message]).length, 0);
assert.equal(pendingMemoryMessages(state, [message, { ...message, id: "new" }]).length, 1);
assert.equal(
  pendingMemoryMessages(state, [message, { ...message, id: "hidden", extra: { hiddenFromAI: true } }]).length,
  0,
);
for (const changed of [
  { ...message, content: "수정" },
  { ...message, activeSwipeIndex: 0 },
  { ...message, memoryRevision: "r2" },
  { ...message, extra: { hiddenFromAI: true } },
])
  assert(reconcileCommittedMemory(state, [changed]).batches[0]?.invalidated);
assert(reconcileCommittedMemory(state, []).batches[0]?.invalidated);
assert(
  reconcileCommittedMemory(reconcileCommittedMemory(state, [{ ...message, content: "수정" }]), [message]).batches[0]
    ?.invalidated,
);
assert.equal(readCommittedMemory({ committedMemory: state }, "other").batches.length, 0);
assert.equal(selectCommittedMemory(state, "", [message.id]).text, "");
assert(!selectCommittedMemory(state, "비밀").text.includes("비밀을 안다"));
assert(selectCommittedMemory(state, "비밀", [], 8000, ["alice"]).text.includes("비밀을 안다"));
// Several characters written at once: a secret one of them knows comes in as a marked knowledge boundary,
// never as a plain fact, with the fixed instruction to keep it.
const merged = selectCommittedMemory(
  state,
  "비밀",
  [],
  8000,
  ["alice", "bob"],
  new Map(),
  new Map([
    ["alice", "앨리스"],
    ["bob", "밥"],
  ]),
);
assert.match(
  merged.text,
  /<knowledge_boundaries>[\s\S]*비밀을 안다 \(known by: 앨리스; not known by: 밥\)[\s\S]*<\/knowledge_boundaries>/u,
);
assert(merged.text.includes("never notices it by guess or coincidence"));
assert(!/<current_facts_and_obligations>[^<]*비밀을 안다/u.test(merged.text));
assert(
  !selectCommittedMemory(state, "비밀", [], 8000, ["bob"]).text.includes("비밀을 안다"),
  "one character gets only what they know",
);
assert(
  !selectCommittedMemory(state, "비밀", [], 8000, ["bob", "carol"]).text.includes("비밀을 안다"),
  "nobody here knows it",
);
const older = {
  ...state,
  batches: [
    batch,
    {
      ...batch,
      id: "new",
      turn: 100,
      summary: "new scene",
      core: "new core",
      sources: [{ id: "b", fingerprint: "b" }],
      facts: [],
    },
  ],
};
assert(!selectCommittedMemory(older, "손수건").text.includes("몸짓"));
assert(selectCommittedMemory(older, "손수건").text.includes("손수건을 맡겼다"));
assert(selectCommittedMemory(older, "").text.includes("약속했다"));
assert(selectCommittedMemory(older, "", [], 20).usedBytes <= 20);
for (const status of ["resolved", "uncertain"] as const) {
  const updated = {
    ...older,
    batches: [batch, { ...older.batches[1]!, facts: [{ ...batch.facts[0]!, id: "update", status }] }],
  };
  assert(!selectCommittedMemory(updated, "").text.includes("약속했다"));
}
assert(
  selectCommittedMemory(older, "handkerchief", [], 8000, [], new Map([["batch", 0.9]])).text.includes(
    "손수건을 맡겼다",
  ),
);
const laterMessage = { ...message, id: "later", memoryRevision: "r3" };
const laterBatch = {
  ...batch,
  id: "later-batch",
  turn: 50,
  sources: [{ id: laterMessage.id, fingerprint: memoryFingerprint(laterMessage) }],
};
const shifted = reconcileCommittedMemory({ ...state, batches: [batch, laterBatch] }, [laterMessage]);
assert(shifted.batches[0]?.invalidated);
assert.equal(shifted.batches[1]?.turn, 1, "deletion must preserve subsequent narrative ordering");
const withheld = {
  ...older,
  batches: [batch, { ...older.batches[1]!, excluded: true, facts: [{ ...batch.facts[0]!, id: "withheld" }] }],
};
assert(
  !selectCommittedMemory(withheld, "").text.includes("약속했다"),
  "excluding the newest fact must not revive its superseded value",
);
const staleNarrative = {
  ...withheld,
  batches: [{ ...batch, summary: "outdated promise must not leak" }, withheld.batches[1]!],
};
assert(!selectCommittedMemory(staleNarrative, "promise").text.includes("outdated promise"));
const factExcluded = { ...state, batches: [{ ...batch, facts: batch.facts.map((f) => ({ ...f, excluded: true })) }] };
assert.equal(
  selectCommittedMemory(factExcluded, "손수건").text,
  "",
  "excluded facts must not leak through summary/core",
);
const chronology = selectCommittedMemory(
  {
    ...state,
    batches: [
      { ...batch, id: "early", turn: 1, core: "lantern", facts: [] },
      {
        ...batch,
        id: "late",
        turn: 100,
        summary: "lantern shines",
        facts: [],
        sources: [{ id: "late-source", fingerprint: "late" }],
      },
    ],
  },
  "lantern",
);
assert.deepEqual(
  chronology.selected.filter((item) => item.reason !== "current").map((item) => item.id),
  ["early", "late"],
  "priority selection must not scramble chronology",
);
assert(chronology.usedBytes <= chronology.budgetBytes);
console.log(
  "Committed memory policy passed: provenance, ownership, audience intersection, aging, obligations, conflicts, multilingual/semantic ranking and budget.",
);
