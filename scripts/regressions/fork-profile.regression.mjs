import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ACTIVE_CHAT_MODES, REMOVED_FEATURE_IDS, isRemovedFeatureId, isRemovedFeaturePackage,
  chatModeSchema, isAgentAvailableInChatMode,
} from "../../packages/shared/dist/index.js";
import { removeExcludedPackageCode } from "../../packages/server/src/services/capability-packages/fork-profile.service.ts";

assert.deepEqual(ACTIVE_CHAT_MODES, ["conversation", "roleplay"]);
for (const id of REMOVED_FEATURE_IDS) {
  assert.equal(isRemovedFeatureId(id), true);
  assert.equal(isRemovedFeaturePackage({ id, kind: ["agent"] }), true);
  assert.equal(isAgentAvailableInChatMode("roleplay", id), false);
}
for (const id of ["illustrator", "expression", "long-term-memory", "spotify", "calls", "world-state"]) {
  assert.equal(isRemovedFeaturePackage({ id, kind: ["agent"] }), false);
}
assert.equal(isRemovedFeaturePackage({ id: "custom-mini-game", kind: ["turn-game"] }), true);
assert.equal(isRemovedFeaturePackage({ id: "custom-rule-system", kind: ["ruleset"] }), true);
assert.equal(chatModeSchema.parse("game"), "game", "Old backups must remain readable");

const fixture = await mkdtemp(join(tmpdir(), "me-fork-trim-"));
try {
  const versions = join(fixture, "capability-packages", "versions");
  assert.deepEqual(await removeExcludedPackageCode(versions, []), []);
  for (const id of ["noodle", "2d-avatars", "3d-avatars", "custom-mini-game", "spotify"]) {
    await mkdir(join(versions, id, "1.0.0"), { recursive: true });
    await writeFile(join(versions, id, "1.0.0", "runtime.js"), "runtime");
  }
  const userData = join(fixture, "capability-packages", "data", "noodle");
  await mkdir(userData, { recursive: true });
  await writeFile(join(userData, "posts.json"), "preserved posts");
  await writeFile(join(fixture, "chats.json"), "preserved chats");
  assert.deepEqual((await removeExcludedPackageCode(versions, [{ id: "custom-mini-game", kind: ["turn-game"] }])).sort(),
    ["2d-avatars", "3d-avatars", "custom-mini-game", "noodle"]);
  await access(join(versions, "spotify", "1.0.0", "runtime.js"));
  assert.equal(await readFile(join(userData, "posts.json"), "utf8"), "preserved posts");
  assert.equal(await readFile(join(fixture, "chats.json"), "utf8"), "preserved chats");
  assert.deepEqual(await removeExcludedPackageCode(versions, []), [], "Cleanup is idempotent");
} finally { await rm(fixture, { recursive: true, force: true }); }

const source = async (file) => readFile(new URL(`../../${file}`, import.meta.url), "utf8");
const routes = await source("packages/server/src/routes/index.ts");
for (const route of ["game.routes", "encounter.routes", "haptic.routes", "avatar-models.routes", "avatar-generation.routes", "turn-games.routes"]) assert.equal(routes.includes(route), false);
for (const route of ["chats.routes", "generate.routes", "tts.routes", "translate.routes", "sprites.routes", "avatars.routes"]) assert.equal(routes.includes(route), true);
assert.equal(/input.mode === "game"\)\s*return reply.status\(410\)/.test(await source("packages/server/src/routes/chats.routes.ts")), true, "Game creation is rejected");
assert.equal(/chat.mode === "game"\)\s*return rejectGenerationOutput\(reply, 410/.test(await source("packages/server/src/routes/generate.routes.ts")), true, "Game generation is rejected");
console.log("Fork profile: removal boundaries, retained agents, legacy reads and safe code cleanup passed.");
