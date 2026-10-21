import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { isRemovedFeaturePackage, REMOVED_FEATURE_IDS } from "@marinara-engine/shared";

/** Remove executable package copies only. Package settings, chats and media stay intact. */
export async function removeExcludedPackageCode(
  versionsRoot: string,
  manifests: readonly { id: string; kind?: readonly string[] }[],
): Promise<string[]> {
  const excluded = new Set<string>([
    ...REMOVED_FEATURE_IDS,
    ...manifests.filter(isRemovedFeaturePackage).map((manifest) => manifest.id),
  ]);
  const entries = await readdir(versionsRoot).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const removed: string[] = [];
  for (const id of entries) {
    // Names came from readdir, but retain the manifest folder-name boundary explicitly.
    if (!excluded.has(id) || !/^[a-z0-9][a-z0-9-]*$/u.test(id)) continue;
    await rm(join(versionsRoot, id), { recursive: true, force: true });
    removed.push(id);
  }
  return removed;
}
