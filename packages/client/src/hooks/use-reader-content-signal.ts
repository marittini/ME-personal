import { useEffect, useRef } from "react";
/** Native render notification: repaint annotations after React commits, without DOM observers. */
export function useReaderContentSignal(content: string) {
  const sentinel = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    sentinel.current?.dispatchEvent(new Event("reader-content-rendered", { bubbles: true }));
  }, [content]);
  return sentinel;
}
