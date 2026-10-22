import { Children, cloneElement, isValidElement, type ReactNode } from "react";
import { DIALOGUE_QUOTE_PATTERN_SOURCE } from "./dialogue-quotes";
const quoted = new RegExp(`^(?:${DIALOGUE_QUOTE_PATTERN_SOURCE})$`, "u");
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return isValidElement<{ children?: ReactNode }>(node) ? textOf(node.props.children) : "";
}
/** Add anchors to existing formatted dialogue. Never clone message DOM or touch links/code. */
export function markFormattedDialogue(nodes: ReactNode): ReactNode {
  return Children.map(nodes, (node) => {
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
