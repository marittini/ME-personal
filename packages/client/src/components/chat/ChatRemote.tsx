// ──────────────────────────────────────────────
// Chat remote dock (merged from the "말랑 리모콘" personal extension 1.2.0)
//
// Previous / next message (hold for the first / last), a jump to a message number, and the
// Chat Settings items the UI manager placed on the remote (their minimized windows portal their
// buttons into the slot below). The grip moves the dock up and down and to the other side;
// a double press folds it to the grip.
// ──────────────────────────────────────────────
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, GripVertical, Hash } from "lucide-react";
import { toast } from "sonner";
import { useUIStore } from "../../stores/ui.store";
import { useChatStore } from "../../stores/chat.store";
import { nextMessageIndex, setChatRemoteSlot, transcriptMessages } from "../../lib/chat-remote";
import { copyToClipboard } from "../../lib/utils";

const HOLD_MS = 500;

function visibleTranscript(): HTMLElement | null {
  return (
    Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-chat-mode="roleplay"] [data-chat-scroll], [data-chat-mode="conversation"] [data-chat-scroll]',
      ),
    ).find((node) => node.getClientRects().length > 0) ?? null
  );
}

function scrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

export function ChatRemote({ chatId }: { chatId: string }) {
  const { t } = useTranslation();
  const remote = useUIStore((state) => state.chatRemote);
  const setRemote = useUIStore((state) => state.setChatRemote);
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; startY: number; startTop: number; moved: boolean } | null>(null);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpValue, setJumpValue] = useState("");
  const slotRef = useCallback((node: HTMLDivElement | null) => setChatRemoteSlot(node), []);
  useEffect(() => () => setChatRemoteSlot(null), []);

  // y is a share of the free height, so the dock keeps its place when the window or the dock resizes.
  useLayoutEffect(() => {
    const node = root.current;
    if (!node || !remote.enabled) return;
    const place = () => {
      if (drag.current?.moved) return;
      const free = Math.max(0, window.innerHeight - node.offsetHeight - 16);
      node.style.top = `${8 + remote.y * free}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(node);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [remote.enabled, remote.y]);

  const navigate = (direction: -1 | 1, toEdge = false) => {
    const container = visibleTranscript();
    const nodes = container ? transcriptMessages(container) : [];
    if (!container || !nodes.length) return toast(t("chat.remote.noChat"));
    if (toEdge) {
      container.scrollTo({ top: direction < 0 ? 0 : container.scrollHeight, behavior: scrollBehavior() });
      return;
    }
    const viewTop = container.getBoundingClientRect().top + 12;
    const rects = nodes.map((node) => node.getBoundingClientRect());
    const next = nextMessageIndex(
      rects.map((rect) => rect.top),
      viewTop,
      direction,
      rects.map((rect) => rect.bottom),
    );
    if (next < 0 || next >= nodes.length) return toast(t(next < 0 ? "chat.remote.first" : "chat.remote.last"));
    container.scrollTo({ top: container.scrollTop + rects[next]!.top - viewTop, behavior: scrollBehavior() });
  };

  // A press steps one message; holding it goes to the first or last.
  const hold = useRef<{ timer: number; fired: boolean } | null>(null);
  const navProps = (direction: -1 | 1) => ({
    onPointerDown: (event: ReactPointerEvent) => {
      if (event.button !== 0) return;
      const state = { timer: 0, fired: false };
      state.timer = window.setTimeout(() => {
        state.fired = true;
        navigate(direction, true);
      }, HOLD_MS);
      hold.current = state;
    },
    onPointerUp: () => {
      const state = hold.current;
      hold.current = null;
      if (!state) return;
      window.clearTimeout(state.timer);
      if (!state.fired) navigate(direction);
    },
    onPointerLeave: () => {
      if (hold.current) window.clearTimeout(hold.current.timer);
      hold.current = null;
    },
    onKeyDown: (event: ReactKeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      navigate(direction, event.shiftKey);
    },
  });

  const jump = () => {
    const number = Number(jumpValue);
    if (!Number.isInteger(number) || number < 1) return toast(t("chat.remote.jumpInvalid"));
    useChatStore.getState().requestGotoMessage(chatId, number);
    setJumpOpen(false);
    setJumpValue("");
  };

  // The grip drags the dock: up and down, and across the middle to the other side. A double press folds it.
  const lastTap = useRef(0);
  const onGripDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !root.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      id: event.pointerId,
      startY: event.clientY,
      startTop: root.current.getBoundingClientRect().top,
      moved: false,
    };
  };
  const onGripMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    const node = root.current;
    if (!state || state.id !== event.pointerId || !node) return;
    if (!state.moved && Math.abs(event.clientY - state.startY) < 6) return;
    state.moved = true;
    const free = Math.max(1, window.innerHeight - node.offsetHeight - 16);
    node.style.top = `${Math.min(free + 8, Math.max(8, state.startTop + event.clientY - state.startY))}px`;
  };
  const onGripUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    drag.current = null;
    const node = root.current;
    if (!state || !node) return;
    if (state.moved) {
      const free = Math.max(1, window.innerHeight - node.offsetHeight - 16);
      const y = (node.getBoundingClientRect().top - 8) / free;
      const side = event.clientX < window.innerWidth / 2 ? "left" : "right";
      setRemote({ y: Math.min(1, Math.max(0, y)), side });
      return;
    }
    const now = performance.now();
    if (now - lastTap.current < 350) {
      lastTap.current = 0;
      setRemote({ minimal: !remote.minimal });
    } else lastTap.current = now;
  };

  if (!remote.enabled) return null;
  return (
    <div
      ref={root}
      className="mari-chat-remote"
      data-chat-remote=""
      data-side={remote.side}
      data-minimal={remote.minimal || undefined}
      data-list={remote.list || undefined}
      role="toolbar"
      aria-label={t("chat.remote.title")}
    >
      <button
        type="button"
        className="mari-chat-remote__grip"
        aria-label={remote.minimal ? t("chat.remote.unfold") : t("chat.remote.grip")}
        title={t("chat.remote.gripHelp")}
        onPointerDown={onGripDown}
        onPointerMove={onGripMove}
        onPointerUp={onGripUp}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setRemote({ minimal: !remote.minimal });
          } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            setRemote({ y: Math.min(1, Math.max(0, remote.y + (event.key === "ArrowUp" ? -0.05 : 0.05))) });
          } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            setRemote({ side: event.key === "ArrowLeft" ? "left" : "right" });
          }
        }}
      >
        <GripVertical size="0.875rem" />
      </button>
      <div className="mari-chat-remote__body" hidden={remote.minimal}>
        <button
          type="button"
          className="mari-chat-remote__item"
          aria-label={t("chat.remote.prev")}
          title={t("chat.remote.prevHelp")}
          {...navProps(-1)}
        >
          <span className="mari-chat-remote__icon" aria-hidden="true">
            <ChevronUp size="1rem" />
          </span>
          <span className="mari-chat-remote__label">{t("chat.remote.prev")}</span>
        </button>
        <button
          type="button"
          className="mari-chat-remote__item"
          aria-label={t("chat.remote.jump")}
          aria-expanded={jumpOpen}
          onClick={() => setJumpOpen((open) => !open)}
        >
          <span className="mari-chat-remote__icon" aria-hidden="true">
            <Hash size="0.9375rem" />
          </span>
          <span className="mari-chat-remote__label">{t("chat.remote.jump")}</span>
        </button>
        {jumpOpen && (
          <form
            className="mari-chat-remote__jump"
            onSubmit={(event) => {
              event.preventDefault();
              jump();
            }}
          >
            <input
              autoFocus
              inputMode="numeric"
              pattern="[0-9]*"
              value={jumpValue}
              onChange={(event) => setJumpValue(event.target.value.replace(/\D/g, ""))}
              onKeyDown={(event) => event.key === "Escape" && setJumpOpen(false)}
              aria-label={t("chat.remote.jumpNumber")}
              placeholder={t("chat.remote.jumpNumber")}
              className="mari-chrome-field h-8 w-20 px-2 text-xs"
            />
            <button type="submit" className="mari-chrome-control mari-chrome-control--small text-xs">
              {t("chat.remote.jumpGo")}
            </button>
          </form>
        )}
        <button
          type="button"
          className="mari-chat-remote__item"
          aria-label={t("chat.remote.next")}
          title={t("chat.remote.nextHelp")}
          {...navProps(1)}
        >
          <span className="mari-chat-remote__icon" aria-hidden="true">
            <ChevronDown size="1rem" />
          </span>
          <span className="mari-chat-remote__label">{t("chat.remote.next")}</span>
        </button>
        <div ref={slotRef} className="mari-chat-remote__slot" data-chat-remote-slot="" />
      </div>
    </div>
  );
}

/**
 * Copy buttons on code blocks in chat messages (also from the 말랑 리모콘 extension). Blocks rendered later —
 * new replies, streaming, swipes — get theirs on the next frame.
 */
export function ChatCodeBlockCopy() {
  const { t } = useTranslation();
  useEffect(() => {
    let frame = 0;
    const timers = new Set<number>();
    const attach = () => {
      frame = 0;
      document
        .querySelectorAll<HTMLPreElement>(".mari-message-content pre.mari-md-codeblock:not([data-code-copy])")
        .forEach((block) => {
          block.dataset.codeCopy = "";
          const button = document.createElement("button");
          button.type = "button";
          button.className = "mari-code-copy";
          button.contentEditable = "false";
          button.textContent = t("markdown.copy");
          button.setAttribute("aria-label", t("markdown.copyCode"));
          button.addEventListener("click", async (event) => {
            event.stopPropagation();
            const code = block.querySelector("code") ?? block;
            const text = Array.from(code.childNodes)
              .filter((node) => !(node instanceof HTMLElement && node.classList.contains("mari-code-copy")))
              .map((node) => node.textContent ?? "")
              .join("");
            const copied = await copyToClipboard(text);
            button.textContent = t(copied ? "markdown.copied" : "markdown.copyFailed");
            button.dataset.state = copied ? "done" : "failed";
            const timer = window.setTimeout(() => {
              timers.delete(timer);
              button.textContent = t("markdown.copy");
              delete button.dataset.state;
            }, 1500);
            timers.add(timer);
          });
          block.append(button);
        });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(attach);
    };
    attach();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [t]);
  return null;
}
