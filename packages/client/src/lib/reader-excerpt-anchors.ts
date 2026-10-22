import type { ReaderExcerptAnchor } from "@marinara-engine/shared";
function nodesIn(message: Element): Text[] {
  const walker = document.createTreeWalker(message, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      return parent?.closest(".mari-message-content") &&
        !parent.closest(
          'button, [data-tts-control-host], [data-dialogue-controls], script, style, textarea, [aria-hidden="true"]',
        )
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) nodes.push(node as Text);
  return nodes;
}
export function excerptFingerprint(text: string) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return `${text.length}:${value >>> 0}`;
}
export function captureExcerptAnchors(root: Element, selection: Selection): ReaderExcerptAnchor[] {
  if (!selection.rangeCount) return [];
  const selected = selection.getRangeAt(0);
  return [...root.querySelectorAll<HTMLElement>("[data-message-id][data-message-number]")]
    .flatMap((message) => {
      const nodes = nodesIn(message);
      let offset = 0;
      let start = -1;
      let end = -1;
      for (const node of nodes) {
        if (selected.intersectsNode(node)) {
          const from = node === selected.startContainer ? selected.startOffset : 0;
          const to = node === selected.endContainer ? selected.endOffset : node.length;
          if (to > from) {
            if (start < 0) start = offset + from;
            end = offset + to;
          }
        }
        offset += node.length;
      }
      const content = nodes.map((node) => node.data).join("");
      const messageNumber = Number(message.dataset.messageNumber);
      return start >= 0 && end > start && Number.isInteger(messageNumber) && messageNumber > 0
        ? [
            {
              messageId: message.dataset.messageId!,
              messageNumber,
              start,
              end,
              fingerprint: excerptFingerprint(content),
              exact: content.slice(start, end),
            },
          ]
        : [];
    })
    .slice(0, 100);
}
/** Exact display fingerprint prevents highlighting a different swipe, translation, or edited message. */
export function restoreExcerptRange(root: Element, anchor: ReaderExcerptAnchor): Range | null {
  const message = root.querySelector(`[data-message-id="${CSS.escape(anchor.messageId)}"]`);
  if (!message) return null;
  const nodes = nodesIn(message);
  const content = nodes.map((node) => node.data).join("");
  if (excerptFingerprint(content) !== anchor.fingerprint || content.slice(anchor.start, anchor.end) !== anchor.exact)
    return null;
  const range = document.createRange();
  let offset = 0;
  let started = false;
  for (const node of nodes) {
    if (!started && anchor.start < offset + node.length) {
      range.setStart(node, anchor.start - offset);
      started = true;
    }
    if (started && anchor.end <= offset + node.length) {
      range.setEnd(node, anchor.end - offset);
      return range;
    }
    offset += node.length;
  }
  return null;
}
