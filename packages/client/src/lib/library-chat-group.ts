import type { Chat } from "@marinara-engine/shared";

/** Group rooms by their actual cast, never by a display name or only the newest connected pair. */
export function libraryChatGroupKey(chat: Pick<Chat, "id" | "characterIds">): string {
  const cast = [...new Set(chat.characterIds)].sort();
  return cast.length ? `cast:${JSON.stringify(cast)}` : `chat:${chat.id}`;
}
