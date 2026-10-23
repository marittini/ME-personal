import { useEffect, type RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ReaderExcerpt, ReaderHighlight } from "@marinara-engine/shared";
import { restoreExcerptRange } from "../lib/reader-excerpt-anchors";

const NOTE_COLORS = ["y", "g", "p", "b"] as const;
const NOTE_HIGHLIGHTS = [...NOTE_COLORS.map((color) => `reader-note-${color}`), "reader-note-memo"];

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
