import type { ReaderPosition } from "../stores/ui.store";

/** Keep device-local reading history bounded, newest first. Never store message text. */
export function updateReaderPositions(
  positions: Record<string, ReaderPosition>,
  chatId: string,
  position: ReaderPosition,
): Record<string, ReaderPosition> {
  return Object.fromEntries(
    Object.entries({ ...positions, [chatId]: position })
      .sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt))
      .slice(0, 200),
  );
}
