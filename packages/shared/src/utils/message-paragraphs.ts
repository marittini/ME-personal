/** Display boundaries only. Never rewrite persisted messages or speaker/reaction indexes. */
export function splitMessageParagraphs(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const result: string[] = [];
  let current: string[] = [];
  let htmlBlock: string | null = null;
  let fence: { marker: string; length: number } | null = null;
  const flush = () => {
    const value = current.join("\n").replace(/^\n+|\n+$/g, "");
    if (value.trim()) result.push(value);
    current = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!fence) {
      if (!htmlBlock)
        htmlBlock = line.match(/^\s*<(div|table|details|pre|script|style)(?:\s|>)/i)?.[1]?.toLowerCase() ?? null;
      if (htmlBlock) {
        current.push(line);
        if (new RegExp(`</${htmlBlock}\\s*>`, "i").test(line)) htmlBlock = null;
        continue;
      }
    }
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = { marker: marker[1]![0]!, length: marker[1]!.length };
      else if (
        marker[1]![0] === fence.marker &&
        marker[1]!.length >= fence.length &&
        /^\s{0,3}(?:`+|~+)\s*$/.test(line)
      )
        fence = null;
      current.push(line);
      continue;
    }
    if (!fence && !line.trim()) {
      const previous = [...current].reverse().find((value) => value.trim()) ?? "";
      const next = lines.slice(i + 1).find((value) => value.trim()) ?? "";
      // Loose lists, nested list continuation and quote blocks remain one markdown block.
      const inList = current.some((value) => /^\s*(?:[-+*]|\d+[.)])\s/.test(value));
      if (
        (/^\s*>/.test(previous) && /^\s*>/.test(next)) ||
        (/^(?: {4}|\t)\S/.test(previous) && /^(?: {4}|\t)\S/.test(next)) ||
        (inList && /^\s*(?:[-+*]\s|\d+[.)]\s| {2,}\S|\t\S)/.test(next))
      )
        current.push(line);
      else flush();
    } else current.push(line);
  }
  flush();
  return result;
}

/** A count mismatch must fall back to the original whole translation, never a guessed alignment. */
export function matchParagraphTranslations(source: readonly string[], translated?: string | null): string[] | null {
  if (!translated) return null;
  const paragraphs = splitMessageParagraphs(translated);
  return paragraphs.length === source.length ? paragraphs : null;
}
