// ──────────────────────────────────────────────
// Chat remote (merged from the "말랑 리모콘" personal extension 1.2.0)
//
// A small dock at the side of a chat: previous / next message (hold for the first / last),
// a jump to a message number, and the Chat Settings items the UI manager placed on it. Its
// settings live in the UI store; the open state of each item stays with the floating windows.
// ──────────────────────────────────────────────
import { useSyncExternalStore } from "react";

export type ChatRemoteSide = "left" | "right";

export interface ChatRemoteSettings {
  enabled: boolean;
  side: ChatRemoteSide;
  /** Vertical position of the dock, 0 (top) to 1 (bottom) of the free space. */
  y: number;
  /** Folded to its grip. */
  minimal: boolean;
  /** Items show their names beside their icons. */
  list: boolean;
  /** Floating window IDs (Chat Settings drawers) that show on the remote instead of as top bubbles. */
  windows: string[];
}

export const DEFAULT_CHAT_REMOTE: ChatRemoteSettings = {
  enabled: false,
  side: "right",
  y: 0.4,
  minimal: false,
  list: false,
  windows: [],
};

const SAFE_ID = /^[a-z0-9][a-z0-9:_.-]{0,160}$/i;

export function normalizeChatRemote(value: unknown): ChatRemoteSettings {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const y = typeof source.y === "number" && Number.isFinite(source.y) ? Math.min(1, Math.max(0, source.y)) : 0.4;
  return {
    enabled: source.enabled === true,
    side: source.side === "left" ? "left" : "right",
    y,
    minimal: source.minimal === true,
    list: source.list === true,
    windows: Array.isArray(source.windows)
      ? [...new Set(source.windows.filter((id): id is string => typeof id === "string" && SAFE_ID.test(id)))].slice(
          0,
          60,
        )
      : [],
  };
}

// The dock's item slot. A minimized window placed on the remote portals its button here.
let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();
export function setChatRemoteSlot(element: HTMLElement | null) {
  if (slot === element) return;
  slot = element;
  for (const listener of listeners) listener();
}
export function useChatRemoteSlot() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => slot,
    () => null,
  );
}

/** Top-level messages of a transcript that are on screen (nested quotes are skipped), in order. */
export function transcriptMessages(container: Element): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-message-id]")).filter(
    (node) => !node.parentElement?.closest("[data-message-id]") && node.getClientRects().length > 0,
  );
}

/**
 * Index of the message to scroll to for a step of `direction` from the one at the top of the view.
 * Returns -1 / `messages.length` past either end.
 */
export function nextMessageIndex(tops: number[], viewTop: number, direction: -1 | 1, bottoms = tops): number {
  if (!tops.length) return -1;
  let index = bottoms.findIndex((bottom) => bottom > viewTop + 2);
  if (index < 0) index = tops.length - 1;
  // A message cut off at the top counts as "current": going back first shows its own start.
  if (direction < 0 && tops[index]! < viewTop - 20) return index;
  return index + direction;
}
