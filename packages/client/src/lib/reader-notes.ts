import type { ReaderBookmark, ReaderHighlight } from "@marinara-engine/shared";
import { restoreExcerptRange } from "./reader-excerpt-anchors";

/** First message whose body is visible at the top of the reading area, as the reading position uses. */
export function captureReadingBookmark(root: Element): Omit<ReaderBookmark, "id" | "createdAt" | "label"> | null {
  const area = root.querySelector<HTMLElement>("[data-chat-scroll]");
  if (!area) return null;
  const top = area.getBoundingClientRect().top;
  const node = Array.from(area.querySelectorAll<HTMLElement>("[data-message-id][data-message-number]")).find(
    (element) => element.getBoundingClientRect().bottom > top + 64,
  );
  const messageNumber = Number(node?.dataset.messageNumber);
  if (!node?.dataset.messageId || !Number.isInteger(messageNumber) || messageNumber < 1) return null;
  const text = Array.from(node.querySelectorAll(".mari-message-content"))
    .map((element) => element.textContent ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return {
    messageId: node.dataset.messageId,
    messageNumber,
    offset: node.getBoundingClientRect().top - top,
    snippet: text.slice(0, 120),
  };
}

function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  const position = doc.caretPositionFromPoint?.(x, y);
  if (position) return { node: position.offsetNode, offset: position.offset };
  const range = document.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

/** The most recent highlight under a tap, if any (newer highlights paint over older ones). */
export function highlightAtPoint(root: Element, highlights: ReaderHighlight[], x: number, y: number) {
  const caret = caretAt(x, y);
  if (!caret || !root.contains(caret.node)) return null;
  for (const highlight of [...highlights].reverse())
    for (const anchor of highlight.anchors) {
      const range = restoreExcerptRange(root, anchor);
      if (!range) continue;
      try {
        // A caret at the very end belongs to the next character, not this highlight.
        if (range.isPointInRange(caret.node, caret.offset) && range.comparePoint(caret.node, caret.offset) === 0) {
          const end = range.endContainer === caret.node && range.endOffset === caret.offset;
          if (!end) return highlight;
        }
      } catch {
        // A node from another document or a detached range is never a match.
      }
    }
  return null;
}

/** Same selected spans: re-highlighting a sentence changes its color instead of stacking a copy. */
export function sameAnchors(a: ReaderHighlight["anchors"], b: ReaderHighlight["anchors"]) {
  return (
    a.length === b.length &&
    a.every(
      (anchor, i) => anchor.messageId === b[i]!.messageId && anchor.start === b[i]!.start && anchor.end === b[i]!.end,
    )
  );
}
