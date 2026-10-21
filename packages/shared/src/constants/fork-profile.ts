// ME-personal intentionally ships only Conversation and Roleplay.
// Legacy schemas remain readable so backups and existing records are not destroyed.
export const REMOVED_FEATURE_IDS = [
  "noodle",
  "slurp",
  "gacha-forge",
  "2d-avatars",
  "3d-avatars",
  "storyboard",
  "haptic",
  "echo-chamber",
  "combat",
  "cyoa",
  "uno",
  "chess",
  "poker",
  "eightball",
  "eight-ball",
  "tic-tac-toe",
  "rock-paper-scissors",
] as const;
const removed = new Set<string>(REMOVED_FEATURE_IDS);
export function isRemovedFeatureId(id: string): boolean {
  return removed.has(id);
}
export function isRemovedFeaturePackage(manifest: { id: string; kind?: readonly string[] }): boolean {
  return (
    isRemovedFeatureId(manifest.id) ||
    Boolean(manifest.kind?.some((kind) => kind === "turn-game" || kind === "ruleset"))
  );
}
export const ACTIVE_CHAT_MODES = ["conversation", "roleplay"] as const;
