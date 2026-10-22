import { useEffect, type RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ReaderExcerpt } from "@marinara-engine/shared";
import { restoreExcerptRange } from "../lib/reader-excerpt-anchors";
/** Paint without inserting wrappers into message DOM, preserving selections and React ownership. */
export function useReaderHighlights(root: RefObject<HTMLElement | null>, excerpts: ReaderExcerpt[], active: boolean) {
  const client = useQueryClient();
  useEffect(() => {
    if (!active || !root.current || !CSS.highlights || typeof Highlight === "undefined") return;
    const host = root.current;
    let frame = 0;
    const paint = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const ranges = excerpts.flatMap((entry) =>
          entry.anchors.flatMap((anchor) => {
            const range = restoreExcerptRange(host, anchor);
            return range ? [range] : [];
          }),
        );
        CSS.highlights.set("reader-excerpts", new Highlight(...ranges));
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
    };
  }, [root, excerpts, active, client]);
}
