import { Children, cloneElement, isValidElement, type ReactNode } from "react";
/** Keep parsed inline formatting and whole TTS utterances, while exposing prose paragraph boundaries. */
function splitNodes(nodes: ReactNode): ReactNode[][] {
  const groups: ReactNode[][] = [[]];
  Children.toArray(nodes).forEach((node) => {
    const parts: ReactNode[][] =
      typeof node === "string"
        ? node.split(/(\n(?:[ \t]*\n)+)/).map((part) => [part])
        : isValidElement<{ children?: ReactNode; "data-tts-dialogue"?: string }>(node) &&
            typeof node.type === "string" &&
            !["code", "pre", "a"].includes(node.type) &&
            node.props["data-tts-dialogue"] === undefined
          ? splitNodes(node.props.children).map((part, index) => [
              cloneElement(node, { key: `${node.key ?? "inline"}:${index}` }, ...part),
            ])
          : [[node]];
    parts.forEach((part, index) => {
      if (index > 0) groups.push([]);
      groups[groups.length - 1]!.push(...part);
    });
  });
  return groups;
}
export function renderProseParagraphs(nodes: ReactNode, key: string): ReactNode[] {
  return splitNodes(nodes).map((group, index) => {
    const gap = group.length === 1 && typeof group[0] === "string" && /^\n(?:[ \t]*\n)+$/.test(group[0]);
    return (
      <span key={`${key}:${index}`} data-reader-prose={gap ? undefined : ""} data-reader-gap={gap ? "" : undefined}>
        {group}
      </span>
    );
  });
}
