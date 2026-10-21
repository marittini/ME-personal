import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function isForkOrigin(value) {
  return /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)marittini\/ME-personal(?:\.git)?\/?$/i.test(
    value.trim(),
  );
}

export function assertForkOrigin(cwd = process.cwd()) {
  const urls = execFileSync("git", ["remote", "get-url", "--all", "origin"], {
    cwd,
    encoding: "utf8",
    timeout: 5000,
  })
    .trim()
    .split(/\r?\n/);
  if (!urls.length || !urls.every(isForkOrigin)) {
    throw new Error(
      "ME-personal updates require origin to point to https://github.com/marittini/ME-personal.git. Update skipped; local source is unchanged.",
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assertForkOrigin();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
