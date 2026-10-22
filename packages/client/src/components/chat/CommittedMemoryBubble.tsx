import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useCommittedMemory, useCommitMemory } from "../../hooks/use-committed-memory";
import { useChat } from "../../hooks/use-chats";
import { useChatStore } from "../../stores/chat.store";
import { WindowBubble } from "../ui/WindowBubble";
import { usePhoneBubbleBounds, useWindowBubbleBounds } from "../ui/FloatingWindow";
import { BUBBLE_SNAP_GAP_PX } from "../../lib/window-bubble-snap";
import { useMatchMedia } from "../../hooks/use-match-media";
import {
  getPhoneBubbleSlot,
  getBubbleRowSlot,
  PHONE_BUBBLE_SIZE_PX,
  WINDOW_BUBBLE_SIZE_PX,
} from "../../lib/floating-window-layout";
import {
  useFloatingWindowStore,
  PHONE_BUBBLE_Z_INDEX,
  FLOATING_WINDOW_Z_BASE,
} from "../../stores/floating-window.store";

const ID = "committed-memory-action";
export function CommittedMemoryBubble({ chatId }: { chatId: string }) {
  const { t } = useTranslation();
  const { data: chat } = useChat(chatId);
  const { data } = useCommittedMemory(chatId);
  const commit = useCommitMemory(chatId);
  const streaming = useChatStore((s) => s.streamingChatId === chatId && s.isStreaming);
  const phone = useMatchMedia("(max-width: 767px)");
  const phoneBounds = usePhoneBubbleBounds(phone);
  const desktopBounds = useWindowBubbleBounds(!phone);
  const bounds = phone ? phoneBounds : desktopBounds;
  const saved = useFloatingWindowStore((s) => (phone ? s.phoneBubbles : s.bubbles)[ID]);
  const [size, setSize] = useState(PHONE_BUBBLE_SIZE_PX);
  const metadata = chat?.metadata as Record<string, unknown> | undefined;
  const pending = data?.selectedPending ?? data?.pending ?? 0;
  const busy = commit.isPending || data?.state.job?.status === "running";
  const lastJob = useRef<string | undefined>(undefined);
  useEffect(() => {
    const job = data?.state.job;
    const key = job ? `${job.id}:${job.status}` : undefined;
    if (lastJob.current && key !== lastJob.current && job?.status === "failed")
      toast.error(
        job.error === "MEMORY_OUTPUT_INVALID"
          ? t("chat.committedMemory.outputInvalid")
          : (job.error ?? t("chat.committedMemory.job.failed")),
      );
    if (lastJob.current && key !== lastJob.current && job?.status === "complete")
      toast.success(t("chat.committedMemory.job.complete"));
    lastJob.current = key;
  }, [data?.state.job, t]);
  if (!data?.state.enabled || metadata?.committedMemoryFloatingButton === false) return null;
  const label = busy ? t("chat.committedMemory.processing") : t("chat.committedMemory.commit");
  return (
    <WindowBubble
      id={ID}
      point={
        saved ?? {
          ...(phone
            ? getPhoneBubbleSlot(bounds, 3, size)
            : getBubbleRowSlot(bounds, 3, { size, gap: BUBBLE_SNAP_GAP_PX })),
          automatic: true,
        }
      }
      bounds={bounds}
      size={phone ? PHONE_BUBBLE_SIZE_PX : WINDOW_BUBBLE_SIZE_PX}
      onSizeChange={setSize}
      icon={busy ? <Loader2 size={18} className="motion-safe:animate-spin" /> : <BookCheck size={18} />}
      busy={busy}
      disabled={busy || streaming}
      label={label}
      ariaLabel={`${label} · ${t("chat.committedMemory.pending", { count: pending })}`}
      tooltip={streaming ? t("chat.committedMemory.waitForReply") : label}
      zIndex={phone ? PHONE_BUBBLE_Z_INDEX : FLOATING_WINDOW_Z_BASE}
      attributes={{ "data-memory-commit": true, "data-busy": busy }}
      onMove={(point) => {
        const store = useFloatingWindowStore.getState();
        if (phone) store.savePhoneBubble(ID, point);
        else store.saveBubble(ID, point);
      }}
      onOpen={() => {
        if (busy || streaming) return;
        if (!pending) {
          toast.info(t("chat.committedMemory.upToDate"));
          return;
        }
        commit.mutate(undefined, {
          onError: (e) => toast.error(e.message),
          onSuccess: () => toast.info(t("chat.committedMemory.processing")),
        });
      }}
    >
      {pending > 0 && !busy && (
        <span
          className="pointer-events-none absolute -right-1 -top-1 rounded-full bg-[var(--primary)] px-1 text-[10px] leading-4 text-[var(--primary-foreground)]"
          aria-hidden="true"
        >
          {pending > 99 ? "99+" : pending}
        </span>
      )}
    </WindowBubble>
  );
}
