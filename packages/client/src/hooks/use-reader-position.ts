import { useEffect, type RefObject } from "react";
import { useChatStore } from "../stores/chat.store";
import { useUIStore } from "../stores/ui.store";
import { updateReaderPositions } from "../lib/reader-position";

export function useReaderPosition(chatId: string | null, root: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!chatId || !root.current) return;
    const host = root.current;
    const saved = useUIStore.getState().readerPositions[chatId];
    let interacted = false;
    let restoring = !!saved;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    const scrollArea = () => host.querySelector<HTMLElement>("[data-chat-scroll]");
    const save = () => {
      if (restoring || !interacted) return;
      const area = scrollArea();
      if (!area) return;
      const top = area.getBoundingClientRect().top;
      const node = Array.from(area.querySelectorAll<HTMLElement>("[data-message-id][data-message-number]")).find(
        (element) => element.getBoundingClientRect().bottom > top + 64,
      );
      const messageNumber = Number(node?.dataset.messageNumber);
      if (!node?.dataset.messageId || !Number.isInteger(messageNumber) || messageNumber < 1) return;
      const position = {
        messageId: node.dataset.messageId,
        messageNumber,
        offset: node.getBoundingClientRect().top - top,
        updatedAt: new Date().toISOString(),
      };
      useUIStore.setState((state) => ({
        readerPositions: updateReaderPositions(state.readerPositions, chatId, position),
      }));
    };
    const interact = () => {
      interacted = true;
      restoring = false;
      const request = useChatStore.getState().gotoRequest;
      if (request?.chatId === chatId && request.readingOffset !== undefined) useChatStore.getState().clearGotoRequest();
      clearTimeout(timer);
      timer = setTimeout(save, 450);
    };
    const scroll = () => {
      clearTimeout(timer);
      timer = setTimeout(save, 450);
    };
    if (saved && !useChatStore.getState().gotoRequest) {
      useChatStore.getState().requestGotoMessage(chatId, saved.messageNumber, saved.offset, saved.messageId);
      const deadline = Date.now() + 10000;
      const restore = () => {
        if (!restoring) return;
        const area = scrollArea();
        const node = area?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(saved.messageId)}"]`);
        if (node && !useChatStore.getState().gotoRequest) {
          area!.scrollTop += node.getBoundingClientRect().top - area!.getBoundingClientRect().top - saved.offset;
          restoring = false;
          return;
        }
        if (Date.now() >= deadline) {
          restoring = false;
          return;
        }
        frame = requestAnimationFrame(restore);
      };
      frame = requestAnimationFrame(restore);
    } else restoring = false;
    host.addEventListener("wheel", interact, { passive: true });
    host.addEventListener("pointerdown", interact, { passive: true });
    host.addEventListener("keydown", interact);
    host.addEventListener("scroll", scroll, true);
    window.addEventListener("pagehide", save);
    const unsubscribe = useChatStore.subscribe((state, previous) => {
      if (previous.activeChatId === chatId && state.activeChatId !== chatId) save();
    });
    return () => {
      save();
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      host.removeEventListener("wheel", interact);
      host.removeEventListener("pointerdown", interact);
      host.removeEventListener("keydown", interact);
      host.removeEventListener("scroll", scroll, true);
      window.removeEventListener("pagehide", save);
      unsubscribe();
    };
  }, [chatId, root]);
}
