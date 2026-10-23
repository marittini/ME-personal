import { Children, cloneElement, Fragment, isValidElement, type ReactNode } from "react";
import { DIALOGUE_QUOTE_PATTERN_SOURCE } from "./dialogue-quotes";
const quoted = new RegExp(`^(?:${DIALOGUE_QUOTE_PATTERN_SOURCE})$`, "u");
const INLINE_MARKDOWN_CONTAINER_RE =
  /\*\*\*[\s\S]+?\*\*\*|\*\*[\s\S]+?\*\*|__[\s\S]+?__|(?<!\*)\*(?!\*)[\s\S]+?(?<!\*)\*(?!\*)|==[\s\S]+?==|~~[\s\S]+?~~|(?<![_\w])_[^_]+?_(?![_\w])/g;

/**
 * Quote pairs in raw text that count as dialogue. Code spans, images and links are protected, and a quote
 * fully inside inline markdown is left to `markFormattedDialogue`, so markdown pairs are never split.
 */
export function findDialogueQuotePairs(text: string): Array<{ start: number; end: number }> {
  const protectedRanges = [...text.matchAll(/`[^`\n]+`|!?\[[^\]]*\]\([^)]+\)/g)].map(
    (m) => [m.index, m.index + m[0].length] as const,
  );
  const markdownRanges = [...text.matchAll(INLINE_MARKDOWN_CONTAINER_RE)].map(
    (m) => [m.index, m.index + m[0].length] as const,
  );
  const pairs: Array<{ start: number; end: number }> = [];
  for (const m of text.matchAll(new RegExp(`(?:${DIALOGUE_QUOTE_PATTERN_SOURCE})`, "g"))) {
    const start = m.index;
    const end = start + m[0].length;
    if (protectedRanges.some(([s, e]) => start >= s && start < e)) continue;
    if (markdownRanges.some(([s, e]) => start > s && end < e)) continue;
    pairs.push({ start, end });
  }
  return pairs;
}

/**
 * Conversation text: give each spoken quote a style-neutral TTS anchor so per-line speech controls can sit
 * beside it. Appearance and text are unchanged; `render` still formats every segment.
 */
export function markQuotedDialogue(
  text: string,
  kp: string,
  render: (text: string, kp: string) => ReactNode,
): ReactNode[] {
  const pairs = findDialogueQuotePairs(text);
  if (!pairs.length) return (markFormattedDialogue(render(text, kp)) ?? []) as ReactNode[];
  const nodes: ReactNode[] = [];
  let last = 0;
  pairs.forEach(({ start, end }, i) => {
    if (start > last)
      nodes.push(<Fragment key={`${kp}t${i}`}>{render(text.slice(last, start), `${kp}t${i}`)}</Fragment>);
    nodes.push(
      <span key={`${kp}d${i}`} data-tts-dialogue="">
        {render(text.slice(start, end), `${kp}d${i}`)}
      </span>,
    );
    last = end;
  });
  if (last < text.length) nodes.push(<Fragment key={`${kp}r`}>{render(text.slice(last), `${kp}r`)}</Fragment>);
  return (markFormattedDialogue(nodes) ?? []) as ReactNode[];
}
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return isValidElement<{ children?: ReactNode }>(node) ? textOf(node.props.children) : "";
}
/** Add anchors to existing formatted dialogue. Never clone message DOM or touch links/code. */
export function markFormattedDialogue(nodes: ReactNode): ReactNode {
  return Children.map(nodes, (node) => {
    if (isValidElement<{ children?: ReactNode }>(node) && node.type === Fragment)
      return cloneElement(node, {}, markFormattedDialogue(node.props.children));
    if (
      !isValidElement<{ children?: ReactNode; "data-tts-dialogue"?: string }>(node) ||
      typeof node.type !== "string" ||
      ["code", "pre", "a", "button", "style"].includes(node.type) ||
      node.props["data-tts-dialogue"] !== undefined
    )
      return node;
    if (["strong", "em", "b", "i"].includes(node.type) && quoted.test(textOf(node.props.children).trim()))
      return cloneElement(node, { "data-tts-dialogue": "" });
    return cloneElement(node, {}, markFormattedDialogue(node.props.children));
  });
}

/** Mark formatted HTML before mounting; never modify or clone an existing message DOM. */
export function markHtmlDialogue(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  for (const node of document.body.querySelectorAll("strong,em,b,i,span,font")) {
    if (node.closest("code,pre,a,button,[data-tts-dialogue]") || node.querySelector("[data-tts-dialogue]")) continue;
    if (quoted.test((node.textContent ?? "").trim())) node.setAttribute("data-tts-dialogue", "");
  }
  return document.body.innerHTML;
}
