const ROOM_QUERY_SCOPES = new Set([
  "detail",
  "messages",
  "messageCount",
  "trash",
  "messagePeek",
  "messageSearch",
  "personaAttributions",
  "memories",
  "notes",
]);

/** Ignore only queries known to belong to another room; unknown dependencies keep the existing repaint. */
export function isReaderHighlightQueryRelevant(queryKey: readonly unknown[], chatId: string | null): boolean {
  if (!chatId) return true;
  let roomId: unknown;
  if (queryKey[0] === "chats" && typeof queryKey[1] === "string" && ROOM_QUERY_SCOPES.has(queryKey[1]))
    roomId = queryKey[2];
  else if (queryKey[0] === "generation-status" || queryKey[0] === "committed-memory") roomId = queryKey[1];
  return typeof roomId !== "string" || roomId.length === 0 || roomId === chatId;
}
