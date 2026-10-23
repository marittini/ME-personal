import { useEffect, type RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ReaderExcerpt, ReaderHighlight } from "@marinara-engine/shared";
import { restoreExcerptRange } from "../lib/reader-excerpt-anchors";

const NOTE_COLORS = ["y", "g", "p", "b"] as const;
const NOTE_HIGHLIGHTS = [...NOTE_COLORS.map((color) => `reader-note-${color}`), "reader-note-memo"];

/**
 * Highlight colors (excerpt studio colors) and a dotted underline where a private memo exists. Added at runtime
 * because the build's CSS parser (lightningcss) does not know `::highlight()` yet and warns on every build.
 */
const HIGHLIGHT_STYLE = `
::highlight(reader-excerpts) { background: color-mix(in srgb, var(--primary) 24%, transparent); color: inherit; }
::highlight(reader-note-y) { background: color-mix(in srgb, #ffdf7e 50%, transparent); color: inherit; }
::highlight(reader-note-g) { background: color-mix(in srgb, #b9e6b0 50%, transparent); color: inherit; }
::highlight(reader-note-p) { background: color-mix(in srgb, #f9c6d9 55%, transparent); color: inherit; }
::highlight(reader-note-b) { background: color-mix(in srgb, #b4daf7 55%, transparent); color: inherit; }
::highlight(reader-note-memo) {
  text-decoration: underline dotted var(--primary);
  text-decoration-thickness: 2px;
  text-underline-offset: 0.2em;
}`;
function ensureHighlightStyle() {
  if (document.getElementById("reader-highlight-style")) return;
  const style = document.createElement("style");
  style.id = "reader-highlight-style";
  style.textContent = HIGHLIGHT_STYLE;
  document.head.append(style);
}

/** Paint without inserting wrappers into message DOM, preserving selections and React ownership. */
export function useReaderHighlights(
  root: RefObject<HTMLElement | null>,
  excerpts: ReaderExcerpt[],
  active: boolean,
  highlights: ReaderHighlight[] = [],
) {
  const client = useQueryClient();
  useEffect(() => {
    if (!active || !root.current || !CSS.highlights || typeof Highlight === "undefined") return;
    ensureHighlightStyle();
    const host = root.current;
    let frame = 0;
    const ranges = (anchors: ReaderExcerpt["anchors"]) =>
      anchors.flatMap((anchor) => {
        const range = restoreExcerptRange(host, anchor);
        return range ? [range] : [];
      });
    const paint = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        CSS.highlights.set("reader-excerpts", new Highlight(...excerpts.flatMap((entry) => ranges(entry.anchors))));
        for (const color of NOTE_COLORS) {
          const set = new Highlight(
            ...highlights.filter((entry) => entry.color === color).flatMap((entry) => ranges(entry.anchors)),
          );
          // Later highlights paint over earlier ones of another color.
          set.priority = 1;
          CSS.highlights.set(`reader-note-${color}`, set);
        }
        const memos = new Highlight(
          ...highlights.filter((entry) => entry.note.trim()).flatMap((entry) => ranges(entry.anchors)),
        );
        memos.priority = 2;
        CSS.highlights.set("reader-note-memo", memos);
      });
    };
    paint();
    const unsubscribe = client.getQueryCache().subscribe(paint);
    host.addEventListener("scroll", paint, true);
    host.addEventListener("reader-content-rendered", paint);
    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
      host.removeEventListener("scroll", paint, true);
      host.removeEventListener("reader-content-rendered", paint);
      CSS.highlights.delete("reader-excerpts");
      for (const name of NOTE_HIGHLIGHTS) CSS.highlights.delete(name);
    };
  }, [root, excerpts, highlights, active, client]);
}
