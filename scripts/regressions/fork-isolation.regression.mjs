import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertForkOrigin, isForkOrigin } from "../check-fork-origin.mjs";
import { getVersionFromReleaseUrl, LATEST_RELEASE_URL } from "../check-launcher-update.mjs";

for (const url of [
  "https://github.com/marittini/ME-personal.git",
  "git@github.com:marittini/ME-personal.git",
  "ssh://git@github.com/marittini/ME-personal.git",
])
  assert.equal(isForkOrigin(url), true);
for (const url of [
  "https://github.com/Pasta-Devs/Marinara-Engine.git",
  "https://github.com/marittini/ME-personal-evil.git",
  "https://github.com.evil/marittini/ME-personal.git",
  "file:///tmp/ME-personal",
])
  assert.equal(isForkOrigin(url), false);
assert.equal(LATEST_RELEASE_URL, "https://github.com/marittini/ME-personal/releases/latest");
assert.equal(getVersionFromReleaseUrl("https://github.com/marittini/ME-personal/releases/tag/v2.5.2"), "2.5.2");
assert.equal(getVersionFromReleaseUrl("https://github.com/Pasta-Devs/Marinara-Engine/releases/tag/v2.5.2"), null);
const fixture = mkdtempSync(join(tmpdir(), "me-personal-origin-"));
try {
  const git = (...args) => execFileSync("git", args, { cwd: fixture, stdio: "pipe" });
  git("init");
  git("remote", "add", "origin", "https://github.com/Pasta-Devs/Marinara-Engine.git");
  assert.throws(() => assertForkOrigin(fixture), /ME-personal updates require origin/);
  git("remote", "set-url", "origin", "https://github.com/marittini/ME-personal.git");
  assert.doesNotThrow(() => assertForkOrigin(fixture));
  git("remote", "set-url", "--add", "origin", "https://github.com/Pasta-Devs/Marinara-Engine.git");
  assert.throws(() => assertForkOrigin(fixture), /ME-personal updates require origin/);
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
const source = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
for (const path of ["start.sh", "start-termux.sh", "start.bat", "packages/server/src/routes/updates.routes.ts"])
  assert.match(source(path), /check-fork-origin\.mjs/);
for (const path of [
  "packages/server/src/routes/updates.routes.ts",
  "win/installer/installer.nsi",
  "win/installer/install.bat",
  "android/app/src/main/java/com/marinara/engine/MainActivity.java",
]) {
  assert.doesNotMatch(source(path), /Pasta-Devs\/Marinara-Engine|pasta-devs\/marinara-engine/);
  assert.match(source(path), /marittini\/ME-personal/);
}
assert.match(source("docker-compose.yml"), /build: \./);
assert.match(source("docker-compose.yml"), /pull_policy: never/);
assert.doesNotMatch(source("docker-compose.yml"), /pasta-devs/);
console.log("ME-personal fork isolation regressions passed.");
