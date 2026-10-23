import { useLayoutEffect, useRef, useState } from "react";
import { Ellipsis } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUIStore } from "../../stores/ui.store";
import { chatUiMode, messageToolId, normalizeChatUiLayout } from "../../lib/chat-ui-layout";
import { MESSAGE_ACTION_ICON_SIZE, MessageActionButton } from "./MessageActionButton";

/**
 * The last item of a message's tool row. It applies the UI manager's choices to the row's own tools (order, hidden,
 * behind "more") without moving or cloning them, and shows the "more" button when some tool sits behind it.
 */
export function MessageToolsLayout({ mode }: { mode: string | null | undefined }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLSpanElement>(null);
  const chatMode = chatUiMode(mode);
  const layout = useUIStore((state) => (chatMode ? state.chatUiLayout[chatMode] : undefined));
  const [expanded, setExpanded] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  useLayoutEffect(() => {
    const row = ref.current?.parentElement;
    if (!row) return;
    const { tools, toolOrder } = normalizeChatUiLayout(layout);
    const apply = () => {
      let more = false;
      for (const child of Array.from(row.children)) {
        if (!(child instanceof HTMLElement) || child === ref.current) continue;
        const id = messageToolId(child);
        if (!id) continue;
        if (child.dataset.chatToolId !== id) child.dataset.chatToolId = id;
        const placement = tools[id] ?? "show";
        const index = toolOrder.indexOf(id);
        const order = index >= 0 ? String(index - toolOrder.length) : "";
        if (child.style.order !== order) child.style.order = order;
        const state = placement === "hidden" ? "hidden" : placement === "more" ? (expanded ? "more-open" : "more") : "";
        if ((child.dataset.chatToolPlacement ?? "") !== state) {
          if (state) child.dataset.chatToolPlacement = state;
          else delete child.dataset.chatToolPlacement;
        }
        if (placement === "more") more = true;
      }
      setHasMore(more);
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(row, { childList: true });
    return () => observer.disconnect();
  }, [layout, expanded]);

  return (
    <span ref={ref} data-message-tools-more="" className="contents">
      {hasMore && (
        <MessageActionButton
          icon={<Ellipsis size={MESSAGE_ACTION_ICON_SIZE} />}
          title={t(expanded ? "chat.uiManager.lessTools" : "chat.uiManager.moreTools")}
          ariaPressed={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="order-[999]"
        />
      )}
    </span>
  );
}
