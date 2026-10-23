import { useCallback, useEffect, useRef } from "react";

/** The editor's existing topbar is a table of contents for one scrollable form. */
export function useEditorSections<T extends string>(
  editorKey: string | null,
  ready: boolean,
  initialSection: T,
  onSectionChange: (section: T) => void,
  /**
   * Paged: a tab shows only its own section instead of scrolling a long page. The other sections stay mounted
   * (only hidden), so typed text, unsaved values and errors survive a tab change, and each tab keeps its own
   * scroll position.
   */
  { paged = false }: { paged?: boolean } = {},
) {
  const contentRef = useRef<HTMLDivElement>(null);
  const navigationTargetRef = useRef<HTMLElement | null>(null);
  const activeRef = useRef<T | null>(null);
  const scrollBySection = useRef(new Map<string, number>());

  const showSection = useCallback(
    (section: T) => {
      const root = contentRef.current;
      if (!root) return;
      const previous = activeRef.current;
      if (previous && previous !== section) scrollBySection.current.set(previous, root.scrollTop);
      activeRef.current = section;
      // CSS (globals.css, "Paged editors") shows only the section named here, so a section that remounts
      // later is still shown or hidden correctly.
      root.dataset.editorPaged = section;
      onSectionChange(section);
      // After the tab's own render (its header chip can change height above the sections), so the browser's
      // scroll anchoring does not shift the restored position.
      const top = scrollBySection.current.get(section) ?? 0;
      root.scrollTop = top;
      requestAnimationFrame(() => {
        if (activeRef.current === section) root.scrollTop = top;
      });
    },
    [onSectionChange],
  );

  /** Scroll to an element and keep it anchored while content around it grows, until the user scrolls. */
  const scrollToElement = useCallback((target: HTMLElement, smooth = true) => {
    const root = contentRef.current;
    if (!root?.contains(target)) return;
    navigationTargetRef.current = target;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    root.scrollTo({
      top: root.scrollTop + target.getBoundingClientRect().top - root.getBoundingClientRect().top - 16,
      behavior: smooth && !reducedMotion ? "smooth" : "auto",
    });
  }, []);

  const scrollToSection = useCallback(
    (section: T, smooth = true) => {
      if (paged) return showSection(section);
      const target = contentRef.current?.querySelector<HTMLElement>(`[data-editor-section="${section}"]`);
      if (!target) return;
      onSectionChange(section);
      scrollToElement(target, smooth);
    },
    [onSectionChange, scrollToElement, paged, showSection],
  );

  useEffect(() => {
    const root = contentRef.current;
    if (!root || !ready || !paged) return;
    // A new record starts on its first tab with fresh scroll positions.
    activeRef.current = null;
    scrollBySection.current.clear();
    showSection(initialSection);
    return () => {
      delete root.dataset.editorPaged;
    };
  }, [editorKey, ready, initialSection, paged, showSection]);

  useEffect(() => {
    const root = contentRef.current;
    if (!root || !ready || paged) return;
    let frame = 0;
    const sync = () => {
      frame = 0;
      const sections = Array.from(root.querySelectorAll<HTMLElement>("[data-editor-section]"));
      const threshold = root.getBoundingClientRect().top + Math.min(120, root.clientHeight / 4);
      const atBottom = root.scrollTop > 0 && root.scrollTop + root.clientHeight >= root.scrollHeight - 2;
      const current = atBottom
        ? sections.at(-1)
        : (sections.filter((section) => section.getBoundingClientRect().top <= threshold).at(-1) ?? sections[0]);
      if (current) onSectionChange(current.dataset.editorSection as T);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(sync);
    };
    scrollToSection(initialSection, false);
    sync();
    root.addEventListener("scroll", onScroll, { passive: true });
    // Deferred media sections can grow during a topbar jump. Keep its destination
    // anchored until the user resumes scrolling or editing the form directly.
    const releaseNavigation = () => {
      navigationTargetRef.current = null;
    };
    const gestures = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const gesture of gestures) root.addEventListener(gesture, releaseNavigation, { passive: true });
    const observer = new ResizeObserver(() => {
      const target = navigationTargetRef.current;
      if (target && root.contains(target)) {
        root.scrollTo({
          top: root.scrollTop + target.getBoundingClientRect().top - root.getBoundingClientRect().top - 16,
          behavior: "instant",
        });
      }
      onScroll();
    });
    observer.observe(root);
    if (root.firstElementChild) observer.observe(root.firstElementChild);
    return () => {
      root.removeEventListener("scroll", onScroll);
      for (const gesture of gestures) root.removeEventListener(gesture, releaseNavigation);
      releaseNavigation();
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [editorKey, ready, initialSection, onSectionChange, scrollToSection, paged]);

  return { contentRef, scrollToSection, scrollToElement };
}
