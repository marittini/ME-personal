import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "committed-writers-"));
process.env.DATA_DIR = dir;
process.env.FILE_STORAGE_DIR = join(dir, "storage");
process.env.NODE_ENV = "test";
process.env.MARINARA_LITE = "false";
process.env.LOG_LEVEL = "silent";
const { getDB, closeDB } = await import("../../packages/server/src/db/connection.js");
const { createChatsStorage } = await import("../../packages/server/src/services/storage/chats.storage.js");
const { chunkAndEmbedMessages, rebuildMemoryChunks } =
  await import("../../packages/server/src/services/memory-recall.js");
const db = await getDB();
const chats = createChatsStorage(db);
let embeddings = 0;
const options = {
  embeddingSource: {
    spaceId: "fixture",
    label: "fixture",
    embed: async (texts: string[]) => {
      embeddings += texts.length;
      return texts.map(() => [1, 0]);
    },
  },
};
try {
  const chat = await chats.create({ name: "Writer gate", mode: "roleplay", characterIds: [] });
  assert(chat);
  for (let i = 0; i < 12; i++)
    await chats.createMessage({
      chatId: chat.id,
      role: i % 2 ? "assistant" : "user",
      characterId: null,
      content: `Unconfirmed message ${i}`,
    });
  await chats.patchMetadata(chat.id, {
    committedMemory: { version: 1, ownerChatId: chat.id, enabled: true, batches: [] },
  });
  await chunkAndEmbedMessages(db, chat.id, { userName: "User", characterNames: {} }, options);
  await rebuildMemoryChunks(db, chat.id, { userName: "User", characterNames: {} }, options);
  assert.equal(embeddings, 0, "legacy writers must never ingest unconfirmed messages in unified mode");
  await chats.patchMetadata(chat.id, {
    committedMemory: { version: 1, ownerChatId: chat.id, enabled: false, batches: [] },
  });
  await chunkAndEmbedMessages(db, chat.id, { userName: "User", characterNames: {} }, options);
  assert(embeddings > 0, "negative control: existing vector writing still works outside unified mode");
  console.log("Committed memory legacy writer gate and ordinary-mode negative control passed.");
} finally {
  await closeDB();
  rmSync(dir, { recursive: true, force: true });
}
