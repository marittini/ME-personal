import { useRef, useState } from "react";
import { Menu } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { Chat } from "@marinara-engine/shared";
import { useUpdateChatMetadata } from "../../hooks/use-chats";
import { useUIStore } from "../../stores/ui.store";
import { Modal } from "../ui/Modal";
import { INTEGRATION_INPUT as field } from "./IntegrationControls";

/** Pointer capture and fractional coordinates keep a room's handle inside the viewport after rotation. */
export function TTSRoomMenu({ chat }: { chat: Chat }) {
  const { t } = useTranslation();
  const update = useUpdateChatMetadata({ serialize: true });
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(chat.metadata.ttsMenuPosition ?? { x: 1, y: 0.65 });
  const drag = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
    left: number;
    top: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const current = useRef(position);
  const volume = useUIStore((state) => state.ttsLineVolume);
  const save = (data: Record<string, unknown>) =>
    update.mutate({ id: chat.id, ...data }, { onError: () => toast.error(t("reader.speechSaveFailed")) });
  return (
    <>
      <button
        type="button"
        aria-label={t("reader.roomSpeechSettings")}
        className="absolute z-20 flex min-h-11 min-w-11 touch-none items-center justify-center rounded-md border border-[var(--border)] bg-[var(--popover)] text-[var(--popover-foreground)] shadow-sm"
        style={{
          left: `clamp(4px, ${position.x * 100}%, calc(100% - 48px))`,
          top: `clamp(52px, ${position.y * 100}%, calc(100% - 100px))`,
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const box = e.currentTarget.parentElement!.getBoundingClientRect();
          const button = e.currentTarget.getBoundingClientRect();
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            width: box.width,
            height: box.height,
            left: button.left - box.left,
            top: button.top - box.top,
            moved: false,
          };
          suppressClick.current = false;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const start = drag.current;
          if (!start) return;
          if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) start.moved = true;
          if (!start.moved) return;
          const next = {
            x: Math.max(0, Math.min(1, (start.left + e.clientX - start.x) / Math.max(1, start.width))),
            y: Math.max(0, Math.min(1, (start.top + e.clientY - start.y) / Math.max(1, start.height))),
          };
          current.current = next;
          setPosition(next);
        }}
        onPointerUp={(e) => {
          const moved = drag.current?.moved;
          drag.current = null;
          suppressClick.current = !!moved;
          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
          if (moved) save({ ttsMenuPosition: current.current });
        }}
        onPointerCancel={() => {
          drag.current = null;
          suppressClick.current = true;
          setPosition(chat.metadata.ttsMenuPosition ?? { x: 1, y: 0.65 });
        }}
        onClick={() => {
          if (!suppressClick.current) setOpen(true);
          suppressClick.current = false;
        }}
      >
        <Menu size={18} />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={t("reader.roomSpeechSettings")}>
        <div className="space-y-4 p-4">
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
            {t("reader.dialogueButtons")}
            <input
              type="checkbox"
              checked={chat.metadata.ttsDialogueButtonsEnabled !== false}
              disabled={update.isPending}
              onChange={(e) => save({ ttsDialogueButtonsEnabled: e.target.checked })}
            />
          </label>
          <label className="block text-sm">
            {t("reader.speakerMode")}
            <select
              className={field}
              value={chat.metadata.ttsTaggedDialogue === true ? "tagged" : "native"}
              disabled={update.isPending}
              onChange={(e) => save({ ttsTaggedDialogue: e.target.value === "tagged" })}
            >
              <option value="native">{t("reader.nativeSpeaker")}</option>
              <option value="tagged">{t("reader.taggedSpeaker")}</option>
            </select>
          </label>
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
            {t("reader.speechInstructions")}
            <input
              type="checkbox"
              checked={chat.metadata.ttsInstructionsEnabled === true}
              disabled={update.isPending}
              onChange={(e) => save({ ttsInstructionsEnabled: e.target.checked })}
            />
          </label>
          <label className="block text-sm">
            {t("reader.lineVolume", { value: volume })}
            <input
              className="mt-2 w-full"
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(e) => useUIStore.setState({ ttsLineVolume: Number(e.target.value) })}
            />
          </label>
          <p className="text-xs text-[var(--muted-foreground)]">{t("reader.roomSpeechHelp")}</p>
        </div>
      </Modal>
    </>
  );
}
