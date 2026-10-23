import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import os, { tmpdir } from "node:os";
import { syncBuiltinESMExports } from "node:module";

// Route injection uses no real network. Keep machine identity deterministic in this fixture.
const originalInterfaces = os.networkInterfaces;
os.networkInterfaces = () => ({});
syncBuiltinESMExports();

const data = mkdtempSync(join(tmpdir(), "me-fork-api-"));
process.env.DATA_DIR = data;
process.env.FILE_STORAGE_DIR = join(data, "storage");
process.env.NODE_ENV = "test";
process.env.MARINARA_LITE = "true";
process.env.LOG_LEVEL = "silent";
const { default: Fastify } = await import("../../packages/server/node_modules/fastify/fastify.js");
const { getDB, closeDB } = await import("../../packages/server/src/db/connection.js");
const { chatsRoutes } = await import("../../packages/server/src/routes/chats.routes.js");
const { generateRoutes } = await import("../../packages/server/src/routes/generate.routes.js");
const { createChatsStorage } = await import("../../packages/server/src/services/storage/chats.storage.js");
const db = await getDB();
const app = Fastify();
app.decorate("db", db);
await app.register(chatsRoutes, { prefix: "/api/chats" });
await app.register(generateRoutes, { prefix: "/api/generate" });
try {
  for (const mode of ["conversation", "roleplay"] as const) {
    const made = await app.inject({ method: "POST", url: "/api/chats", payload: { name: mode, mode, characterIds: [] } });
    assert.equal(made.statusCode, 200, made.body);
    const id = made.json().id;
    const read = await app.inject({ method: "GET", url: `/api/chats/${id}` });
    assert.equal(read.statusCode, 200);
    assert.equal(read.json().mode, mode);
  }
  const rejected = await app.inject({ method: "POST", url: "/api/chats", payload: { name: "removed", mode: "game", characterIds: [] } });
  assert.equal(rejected.statusCode, 410, rejected.body);
  // Insert a historical record through storage: it must stay readable and exportable.
  const historical = await createChatsStorage(db).create({ name: "Old Game", mode: "game", characterIds: [] });
  assert.ok(historical);
  assert.equal((await app.inject({ method: "GET", url: `/api/chats/${historical.id}` })).statusCode, 200);
  const generated = await app.inject({ method: "POST", url: "/api/generate", payload: { chatId: historical.id, userMessage: "continue" } });
  assert.equal(generated.statusCode, 410, generated.body);
  console.log("Fork API: Conversation/Roleplay creation and read passed; Game creation/generation rejected; historical records retained.");
} finally {
  await app.close();
  await closeDB();
  os.networkInterfaces = originalInterfaces;
  syncBuiltinESMExports();
  rmSync(data, { recursive: true, force: true });
}
