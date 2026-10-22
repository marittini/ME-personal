import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getFileStorageDir } from "../config/runtime-config.js";
import { createHash } from "node:crypto";
import type { CommittedMemoryState } from "@marinara-engine/shared";

/** Derived data only. Scope, evidence and every searchable field participate in freshness. */
export function committedMemoryDocuments(state: CommittedMemoryState) {
  return state.batches
    .filter((b) => !b.invalidated && !b.excluded)
    .flatMap((b) => {
      const documents = b.core
        ? [
            {
              id: b.id,
              text: [b.core, b.coreKo, ...(b.keywords ?? [])].filter(Boolean).join("\n"),
              evidence: b.sources,
              scope: "shared" as "shared" | string[],
            },
          ]
        : [];
      for (const f of b.facts) {
        if (f.invalidated || f.excluded) continue;
        documents.push({
          id: f.id,
          text: [f.key, f.content, f.keyKo, f.contentKo, ...(f.keywords ?? [])].filter(Boolean).join("\n"),
          evidence: f.dependencies ?? b.sources,
          scope: f.audience,
        });
      }
      return documents.map((d) => ({ ...d, hash: createHash("sha256").update(JSON.stringify(d)).digest("hex") }));
    });
}

export interface CommittedMemoryIndex {
  space: string;
  entries: Array<{ id: string; hash: string; vector: number[] }>;
}
function indexPath(chatId: string) {
  return join(
    getFileStorageDir(),
    "committed-memory-index",
    `${createHash("sha256").update(chatId).digest("hex")}.json`,
  );
}
export async function readCommittedMemoryIndex(chatId: string): Promise<CommittedMemoryIndex | undefined> {
  try {
    const value = JSON.parse(await readFile(indexPath(chatId), "utf8"));
    if (typeof value?.space !== "string" || !Array.isArray(value.entries)) return undefined;
    return {
      space: value.space,
      entries: value.entries
        .filter(
          (e: CommittedMemoryIndex["entries"][number]) =>
            e &&
            typeof e.id === "string" &&
            typeof e.hash === "string" &&
            Array.isArray(e.vector) &&
            e.vector.length > 0 &&
            e.vector.every(Number.isFinite),
        )
        .slice(0, 512),
    };
  } catch {
    return undefined;
  } // Derived data may always be rebuilt from canonical memory.
}
export async function clearCommittedMemoryIndex(chatId: string) {
  try {
    await unlink(indexPath(chatId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
export async function writeCommittedMemoryIndex(chatId: string, index: CommittedMemoryIndex) {
  const path = indexPath(chatId);
  await mkdir(join(getFileStorageDir(), "committed-memory-index"), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(index), { mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
export async function pruneCommittedMemoryIndex(chatId: string, state: CommittedMemoryState) {
  const index = await readCommittedMemoryIndex(chatId);
  if (!index) return;
  const hashes = new Map(committedMemoryDocuments(state).map((d) => [d.id, d.hash]));
  const entries = index.entries.filter((e) => hashes.get(e.id) === e.hash);
  if (entries.length !== index.entries.length) await writeCommittedMemoryIndex(chatId, { ...index, entries });
}
