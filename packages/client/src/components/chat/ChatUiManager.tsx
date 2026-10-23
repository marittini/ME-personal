import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Modal } from "../ui/Modal";
import { readFloatingWindowBounds } from "../ui/FloatingWindow";
import { getDrawerWindowId } from "../../lib/floating-window-layout";
import {
  CHAT_SETTINGS_WINDOW_ID,
  isPhoneWindowLayout,
  useFloatingWindowStore,
} from "../../stores/floating-window.store";
import { useUIStore } from "../../stores/ui.store";
import {
  messageToolId,
  messageToolLabel,
  moveInOrder,
  normalizeChatUiLayout,
  type ChatUiLayout,
  type ChatUiMode,
  type ChatUiPlacement,
  type ChatUiToolPlacement,
} from "../../lib/chat-ui-layout";
import { CHAT_SETTINGS_TABS, chatSettingsCategory, sectionIdOf, type ChatSettingsTab } from "./chat-settings-tabs";
import { SETTINGS_ICON_BUTTON_CLASS } from "../panels/settings/SettingControls";

type ManagerTab = "top" | "settings" | "tools";
interface SettingsItem {
  id: string;
  title: string;
  category: ChatSettingsTab;
  placement: ChatUiPlacement;
  /** A drawer can live in its own window (a top bubble); a docked toolbar control cannot from here. */
  canTop: boolean;
}
interface ToolItem {
  id: string;
  label: string;
  placement: ChatUiToolPlacement;
}

const drawerWindowId = (sectionId: string) => getDrawerWindowId(CHAT_SETTINGS_WINDOW_ID, sectionId);

/** Puts one Chat Settings drawer in its own minimized window (a top bubble) or back into Chat Settings. */
export function placeChatSettingsDrawer(sectionId: string, placement: ChatUiPlacement) {
  const windows = useFloatingWindowStore.getState();
  const windowId = drawerWindowId(sectionId);
  const detached = windows.detached[windowId] === true;
  if (placement === "top" && !detached) {
    const bounds = readFloatingWindowBounds();
    windows.detachDrawer(
      windowId,
      {
        x: bounds.left + 16,
        y: bounds.top + 16,
        width: 352,
        height: 352,
        pinned: false,
        locked: false,
        minimized: true,
      },
      { focus: false },
    );
    windows.minimizeWindow(windowId);
  } else if (placement !== "top" && detached) {
    windows.dockDrawer(windowId);
  }
}

/** On a computer, a room of the same mode follows the explicit top/settings choices (phones keep theirs, as before). */
export function applyChatUiPlacements(layout: ChatUiLayout | undefined, list: HTMLElement | null) {
  if (!layout || !list || isPhoneWindowLayout()) return;
  const present = new Set(
    Array.from(list.querySelectorAll("[data-chat-settings-section]")).map((node) =>
      node.getAttribute("data-chat-settings-section"),
    ),
  );
  const detached = useFloatingWindowStore.getState().detached;
  for (const [id, placement] of Object.entries(layout.placement)) {
    if (id.startsWith("control:")) continue;
    if (present.has(id) || detached[drawerWindowId(id)]) placeChatSettingsDrawer(id, placement);
  }
}

function collectSettings(layout: ChatUiLayout): SettingsItem[] {
  const list = document.querySelector<HTMLElement>('[data-window="chat-settings"] [data-chat-settings-tab]');
  if (!list) return [];
  const detached = useFloatingWindowStore.getState().detached;
  const nodes = [
    ...Array.from(list.children).flatMap((child) =>
      child.hasAttribute("data-chat-control-dock") ? Array.from(child.children) : [child],
    ),
    ...Array.from(document.querySelectorAll('.mari-window[data-drawer-host="chat-settings"]')),
  ];
  const seen = new Set<string>();
  const items: SettingsItem[] = [];
  for (const node of nodes) {
    const id = sectionIdOf(node);
    if (!id || seen.has(id) || id === "settings-profiles") continue;
    seen.add(id);
    const title =
      node.querySelector(".mari-drawer__title")?.textContent?.trim() ||
      node.querySelector(".mari-window__title, [data-window-title]")?.textContent?.trim() ||
      id;
    const isControl = node.hasAttribute("data-docked-chat-control");
    items.push({
      id,
      title,
      category: chatSettingsCategory(id),
      canTop: !isControl,
      placement:
        layout.placement[id] === "hidden" ? "hidden" : !isControl && detached[drawerWindowId(id)] ? "top" : "settings",
    });
  }
  const order = (item: SettingsItem) => {
    const chosen = layout.order.indexOf(item.id);
    if (chosen >= 0) return chosen - 10000;
    const node = list
      .querySelector(`[data-chat-settings-section="${CSS.escape(item.id)}"]`)
      ?.closest<HTMLElement>("[data-chat-settings-category]");
    return Number(node?.style.order || 0);
  };
  return items.sort((a, b) => order(a) - order(b));
}

function collectTools(layout: ChatUiLayout): ToolItem[] {
  // The row with the most tools (usually the latest reply) lists everything this room offers.
  const rows = Array.from(document.querySelectorAll(".mari-message-actions"));
  const row = rows.sort((a, b) => b.children.length - a.children.length)[0];
  if (!row) return [];
  const items: ToolItem[] = [];
  for (const child of Array.from(row.children)) {
    if (child.hasAttribute("data-message-tools-more")) continue;
    const id = messageToolId(child);
    if (!id || items.some((item) => item.id === id)) continue;
    items.push({ id, label: messageToolLabel(child) || id, placement: layout.tools[id] ?? "show" });
  }
  const position = (item: ToolItem) => {
    const chosen = layout.toolOrder.indexOf(item.id);
    return chosen >= 0 ? chosen - 1000 : 0;
  };
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => position(a.item) - position(b.item) || a.index - b.index)
    .map(({ item }) => item);
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="mari-ui-manager__segmented">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          disabled={option.disabled}
          onClick={() => value !== option.value && onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** "UI 관리": where Chat Settings items go and how message tools show, kept per chat mode. */
export function ChatUiManager({ open, onClose, mode }: { open: boolean; onClose: () => void; mode: ChatUiMode }) {
  const { t } = useTranslation();
  const stored = useUIStore((state) => state.chatUiLayout[mode]);
  const setLayout = useUIStore((state) => state.setChatUiLayout);
  const detached = useFloatingWindowStore((state) => state.detached);
  const [tab, setTab] = useState<ManagerTab>("settings");
  const [settings, setSettings] = useState<SettingsItem[]>([]);
  const [tools, setTools] = useState<ToolItem[]>([]);
  // Lists come from what this room shows; refreshed when choices change.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      setSettings(collectSettings(normalizeChatUiLayout(stored)));
      setTools(collectTools(normalizeChatUiLayout(stored)));
    });
    return () => cancelAnimationFrame(frame);
  }, [open, stored, detached]);

  const placementLabels: Record<ChatUiPlacement, string> = {
    top: t("chat.uiManager.placement.top"),
    settings: t("chat.uiManager.placement.settings"),
    hidden: t("chat.uiManager.placement.hidden"),
  };
  const setPlacement = (item: SettingsItem, placement: ChatUiPlacement) => {
    setLayout(mode, (current) => ({ ...current, placement: { ...current.placement, [item.id]: placement } }));
    if (item.canTop) placeChatSettingsDrawer(item.id, placement);
  };
  const moveSetting = (item: SettingsItem, step: -1 | 1) => {
    const peers = settings
      .filter((entry) => entry.category === item.category && entry.placement === "settings")
      .map((entry) => entry.id);
    setLayout(mode, (current) => ({ ...current, order: moveInOrder(current.order, peers, item.id, step) }));
  };
  const setTool = (item: ToolItem, placement: ChatUiToolPlacement) =>
    setLayout(mode, (current) => {
      const next = { ...current.tools };
      if (placement === "show") delete next[item.id];
      else next[item.id] = placement;
      return { ...current, tools: next };
    });
  const moveTool = (item: ToolItem, step: -1 | 1) => {
    const peers = tools.filter((entry) => entry.placement === item.placement).map((entry) => entry.id);
    setLayout(mode, (current) => ({ ...current, toolOrder: moveInOrder(current.toolOrder, peers, item.id, step) }));
  };
  const moveButtons = (name: string, peers: string[], id: string, move: (step: -1 | 1) => void) => (
    <span className="flex shrink-0 gap-1">
      <button
        type="button"
        className={SETTINGS_ICON_BUTTON_CLASS}
        aria-label={t("chat.uiManager.moveUp", { name })}
        disabled={peers.indexOf(id) <= 0}
        onClick={() => move(-1)}
      >
        <ArrowUp size="0.75rem" />
      </button>
      <button
        type="button"
        className={SETTINGS_ICON_BUTTON_CLASS}
        aria-label={t("chat.uiManager.moveDown", { name })}
        disabled={peers.indexOf(id) < 0 || peers.indexOf(id) >= peers.length - 1}
        onClick={() => move(1)}
      >
        <ArrowDown size="0.75rem" />
      </button>
    </span>
  );
  const settingsRow = (item: SettingsItem) => {
    const peers = settings
      .filter((entry) => entry.category === item.category && entry.placement === "settings")
      .map((entry) => entry.id);
    return (
      <li key={item.id} className="mari-ui-manager__row" data-ui-manager-item={item.id}>
        <span className="min-w-0 flex-1 truncate">{item.title}</span>
        <Segmented
          label={t("chat.uiManager.placementFor", { name: item.title })}
          value={item.placement}
          options={(["top", "settings", "hidden"] as const).map((value) => ({
            value,
            label: placementLabels[value],
            disabled: value === "top" && !item.canTop,
          }))}
          onChange={(value) => setPlacement(item, value)}
        />
        {item.placement === "settings" && moveButtons(item.title, peers, item.id, (step) => moveSetting(item, step))}
      </li>
    );
  };

  return (
    <Modal open={open} onClose={onClose} title={t("chat.uiManager.title")} width="max-w-lg" mobileFullscreen>
      <div className="mari-ui-manager flex flex-col gap-3 p-4" data-chat-ui-manager="">
        <div role="tablist" aria-label={t("chat.uiManager.title")} className="mari-chat-settings-tabs flex gap-1">
          {(["top", "settings", "tools"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              className="mari-chat-settings-tab"
              onClick={() => setTab(value)}
            >
              {t(`chat.uiManager.tabs.${value}`)}
            </button>
          ))}
        </div>
        <p className="text-xs text-[var(--muted-foreground)]">{t(`chat.uiManager.help.${tab}`)}</p>
        {tab === "top" && (
          <ul className="mari-ui-manager__list">
            {settings.filter((item) => item.placement === "top").map(settingsRow)}
            {!settings.some((item) => item.placement === "top") && (
              <li className="text-xs text-[var(--muted-foreground)]">{t("chat.uiManager.emptyTop")}</li>
            )}
          </ul>
        )}
        {tab === "settings" &&
          CHAT_SETTINGS_TABS.map((category) => {
            const items = settings.filter((item) => item.category === category && item.placement !== "top");
            return items.length ? (
              <section key={category}>
                <h3 className="mari-ui-manager__heading">{t(`chat.settings.tabs.${category}`)}</h3>
                <ul className="mari-ui-manager__list">{items.map(settingsRow)}</ul>
              </section>
            ) : null;
          })}
        {tab === "tools" && (
          <ul className="mari-ui-manager__list">
            {!tools.length && (
              <li className="text-xs text-[var(--muted-foreground)]">{t("chat.uiManager.emptyTools")}</li>
            )}
            {tools.map((item) => (
              <li key={item.id} className="mari-ui-manager__row" data-ui-manager-tool={item.id}>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <Segmented
                  label={t("chat.uiManager.placementFor", { name: item.label })}
                  value={item.placement}
                  options={(["show", "more", "hidden"] as const).map((value) => ({
                    value,
                    label: t(`chat.uiManager.tool.${value}`),
                  }))}
                  onChange={(value) => setTool(item, value)}
                />
                {moveButtons(
                  item.label,
                  tools.filter((entry) => entry.placement === item.placement).map((entry) => entry.id),
                  item.id,
                  (step) => moveTool(item, step),
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
