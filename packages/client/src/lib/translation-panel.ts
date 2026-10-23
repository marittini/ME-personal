import type { NativeIntegrations } from "@marinara-engine/shared";

/** File kind of the translation extension's backups (v1.6.4), which this panel reads and writes. */
export const TRANSLATION_BACKUP_KIND = "translation-presets-glossary.backup";

type Glossary = NativeIntegrations["translation"]["defaults"]["glossary"];
export type VoiceRow = { name: string; style: string };

/** Voice notes are "[Name]" blocks; text outside blocks (for everyone) stays at the top, as in the extension. */
export function parseVoice(raw: string) {
  const head: string[] = [];
  const blocks: Array<{ name: string; lines: string[] }> = [];
  let current: (typeof blocks)[number] | null = null;
  for (const line of raw.split(/\r?\n/u)) {
    const match = /^\s*\[([^\]\n]+)\]\s*$/u.exec(line);
    if (match) {
      current = { name: match[1]!.trim(), lines: [] };
      blocks.push(current);
    } else (current ? current.lines : head).push(line);
  }
  return {
    head: head.join("\n").trim(),
    blocks: blocks.map((block) => ({ name: block.name, style: block.lines.join("\n").trim() })),
  };
}

/** Editor rows back to the stored text; a row without a name applies to everyone, rows without notes are left out. */
export function writeVoice(rows: VoiceRow[]) {
  return [
    ...rows.filter((row) => !row.name.trim() && row.style.trim()).map((row) => row.style.trim()),
    ...rows
      .filter((row) => row.name.trim() && row.style.trim())
      .map((row) => `[${row.name.trim()}]\n${row.style.trim()}`),
  ].join("\n\n");
}

export function voiceRows(raw: string): VoiceRow[] {
  const voice = parseVoice(raw);
  return [...(voice.head ? [{ name: "", style: voice.head }] : []), ...voice.blocks];
}

/** Same name replaces its block; new names are appended. */
export function mergeVoice(raw: string, entries: VoiceRow[]) {
  const parsed = parseVoice(raw);
  for (const entry of entries) {
    const block = parsed.blocks.find((candidate) => candidate.name === entry.name);
    if (block) block.style = entry.style;
    else parsed.blocks.push({ ...entry });
  }
  return [parsed.head, ...parsed.blocks.map((block) => `[${block.name}]\n${block.style}`)].filter(Boolean).join("\n\n");
}

/** A term on either side of an existing pair replaces that pair; others are appended. */
export function mergeGlossary(glossary: Glossary, pairs: Array<{ source: string; target: string }>): Glossary {
  const next = [...glossary];
  for (const pair of pairs) {
    const index = next.findIndex((row) => row.source === pair.source || row.target === pair.source);
    const row = { source: pair.source, target: pair.target, notes: index >= 0 ? next[index]!.notes : "" };
    if (index >= 0) next[index] = row;
    else next.push(row);
  }
  return next;
}
