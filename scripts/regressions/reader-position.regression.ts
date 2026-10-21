import assert from "node:assert/strict";
import { updateReaderPositions } from "../../packages/client/src/lib/reader-position.js";

const position = { messageId: "saved-message", messageNumber: 17, offset: -120, updatedAt: "2026-10-21T10:00:00.000Z" };
const original = { previous: { ...position, updatedAt: "2026-10-20T10:00:00.000Z" } };
const next = updateReaderPositions(original, "current", position);
assert.deepEqual(Object.keys(next), ["current", "previous"]);
assert.deepEqual(Object.keys(original), ["previous"], "saving never mutates a prior store snapshot");
assert.equal(next.current.messageId, "saved-message");
assert.equal(next.current.offset, -120, "preserve a partially read message offset");
const many = Object.fromEntries(
  Array.from({ length: 230 }, (_, index) => [
    String(index),
    { ...position, updatedAt: new Date(index * 1000).toISOString() },
  ]),
);
const bounded = updateReaderPositions(many, "current", position);
assert.equal(Object.keys(bounded).length, 200);
assert.ok(bounded.current);
assert.ok(bounded[229]);
assert.equal(bounded[0], undefined);
assert.deepEqual(updateReaderPositions(next, "current", position), next, "same position is idempotent");
