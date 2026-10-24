import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { isReaderHighlightQueryRelevant } from "../../packages/client/src/lib/reader-highlight-query.ts";

for (const scope of [
  "detail",
  "messages",
  "messageCount",
  "trash",
  "messagePeek",
  "messageSearch",
  "personaAttributions",
  "memories",
  "notes",
]) {
  assert.equal(isReaderHighlightQueryRelevant(["chats", scope, "current"], "current"), true, scope);
  assert.equal(isReaderHighlightQueryRelevant(["chats", scope, "other"], "current"), false, scope);
  assert.equal(isReaderHighlightQueryRelevant(["chats", scope, "other", 20], "current"), false, scope);
  for (const missing of [undefined, null, "", 1])
    assert.equal(isReaderHighlightQueryRelevant(["chats", scope, missing], "current"), true);
}
for (const scope of ["generation-status", "committed-memory"]) {
  assert.equal(isReaderHighlightQueryRelevant([scope, "current"], "current"), true);
  assert.equal(isReaderHighlightQueryRelevant([scope, "other"], "current"), false);
}
// Lists, group queries, future schemas, and render dependencies must not be guessed away.
for (const key of [
  [],
  ["chats"],
  ["chats", "list"],
  ["chats", "group", "other"],
  ["chats", "future", "other"],
  ["characters", "detail", "other"],
  ["presets", "full", "other"],
  ["regex-scripts"],
  ["fonts"],
  ["gallery", "other"],
])
  assert.equal(isReaderHighlightQueryRelevant(key, "current"), true);
assert.equal(isReaderHighlightQueryRelevant(["chats", "messages", "other"], null), true);
// Switching rooms changes which notifications pass; no remembered room or event is retained.
assert.equal(isReaderHighlightQueryRelevant(["chats", "messages", "other"], "other"), true);
let paints = 0;
for (let index = 0; index < 100; index++)
  if (isReaderHighlightQueryRelevant(["chats", "messages", "other"], "current")) paints++;
assert.equal(paints, 0);
// Exercise real QueryCache notifications as well as the key classification.
const clientRequire = createRequire(new URL("../../packages/client/package.json", import.meta.url));
const { QueryClient } = clientRequire("@tanstack/react-query");
const client = new QueryClient();
const unsubscribe = client.getQueryCache().subscribe((event) => {
  if (isReaderHighlightQueryRelevant(event.query.queryKey, "current")) paints++;
});
try {
  for (let index = 0; index < 100; index++) client.setQueryData(["chats", "messages", "other"], index);
  assert.equal(paints, 0, "other-room cache adds and updates do not repaint");
  client.setQueryData(["chats", "messages", "current"], []);
  assert.ok(paints > 0, "current-room cache adds and updates still repaint");
  const beforeInvalidation = paints;
  await client.invalidateQueries({ queryKey: ["chats", "messages", "current"] });
  assert.ok(paints > beforeInvalidation, "current-room invalidation still repaints");
  const beforeOtherRoom = paints;
  await client.invalidateQueries({ queryKey: ["chats", "messages", "other"] });
  assert.equal(paints, beforeOtherRoom);
  client.setQueryData(["presets", "full", "preset"], {});
  assert.ok(paints > beforeOtherRoom, "unclassified render dependencies retain the original behavior");
} finally {
  unsubscribe();
  client.clear();
}
console.info("Reader highlight query filtering regression passed: 100 unrelated room events cause zero paints.");
