import { useCallback, useLayoutEffect, useState } from "react";
import type { ChatUiLayout } from "../../lib/chat-ui-layout";

/** Chat Settings is split into four fixed tabs; each section's place comes from its stable section ID. */
export const CHAT_SETTINGS_TABS = ["settings", "context", "memory", "other"] as const;
export type ChatSettingsTab = (typeof CHAT_SETTINGS_TABS)[number];

/** Unknown and future sections land in "other", so nothing ever disappears from every tab. */
export function chatSettingsCategory(sectionId: string | null | undefined): ChatSettingsTab {
  const id = sectionId ?? "";
  if (
    /^(?:settings-profiles|chat-name|connection|advanced-parameters|impersonate|function-calling|conversation-autonomous-messaging)$/.test(
      id,
    ) ||
    /(?:-chat-variables|-connected-chats|-chat-branches|-group-chat)$/.test(id)
  )
    return "settings";
  if (
    /^(?:prompt-preset|conversation-prompt|game-prompt|scene-instructions|lorebooks)$/.test(id) ||
    /(?:-persona|-characters|-author-notes|-active-context|-scoped-regex)$/.test(id)
  )
    return "context";
  if (
    /^(?:conversation-memory-recall|conversation-automatic-summarization)$/.test(id) ||
    /(?:-memory-recall|-chat-summary)$/.test(id)
  )
    return "memory";
  return "other";
}

const STORAGE_KEY = "marinara:chat-settings-tab";

function readTab(): ChatSettingsTab {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return (CHAT_SETTINGS_TABS as readonly string[]).includes(value ?? "") ? (value as ChatSettingsTab) : "settings";
  } catch {
    return "settings";
  }
}

export function sectionIdOf(node: Element) {
  return (
    node.getAttribute("data-chat-settings-section") ??
    node.querySelector("[data-chat-settings-section]")?.getAttribute("data-chat-settings-section") ??
    (node.hasAttribute("data-chat-settings-profiles") ? "settings-profiles" : null)
  );
}

/**
 * Tags every top-level item of the Chat Settings list (and each docked control) with its tab, so CSS shows only the
 * selected tab. React keeps owning the nodes: nothing is moved or cloned, only an attribute is set.
 */
export function useChatSettingsTabs(list: HTMLElement | null, layout?: ChatUiLayout) {
  const [tab, setTabState] = useState<ChatSettingsTab>(readTab);
  const setTab = useCallback((next: ChatSettingsTab) => {
    setTabState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* remembered only while storage works */
    }
  }, []);
  useLayoutEffect(() => {
    if (!list) return;
    const placeItem = (node: Element) => {
      const sectionId = sectionIdOf(node);
      const category = chatSettingsCategory(sectionId);
      if (node.getAttribute("data-chat-settings-category") !== category)
        node.setAttribute("data-chat-settings-category", category);
      if (!(node instanceof HTMLElement)) return;
      // The UI manager's choices: hidden items and a chosen order (React's own order is kept to restore it).
      const hidden = !!sectionId && layout?.placement[sectionId] === "hidden";
      if (hidden !== node.hasAttribute("data-chat-ui-hidden")) node.toggleAttribute("data-chat-ui-hidden", hidden);
      const index = sectionId ? (layout?.order.indexOf(sectionId) ?? -1) : -1;
      if (index >= 0) {
        if (node.dataset.chatUiNativeOrder === undefined) node.dataset.chatUiNativeOrder = node.style.order;
        const order = String(-100000 + index);
        if (node.style.order !== order) node.style.order = order;
      } else if (node.dataset.chatUiNativeOrder !== undefined) {
        node.style.order = node.dataset.chatUiNativeOrder;
        delete node.dataset.chatUiNativeOrder;
      }
    };
    const tag = () => {
      for (const child of Array.from(list.children)) {
        if (child.hasAttribute("data-chat-control-dock")) {
          for (const docked of Array.from(child.children)) placeItem(docked);
          continue;
        }
        placeItem(child);
      }
    };
    tag();
    const observer = new MutationObserver(tag);
    observer.observe(list, { childList: true });
    const dock = list.querySelector(":scope > [data-chat-control-dock]");
    if (dock) observer.observe(dock, { childList: true });
    return () => observer.disconnect();
  }, [list, layout]);
  /** A jump to one section (search, omnibar, a toolbar shortcut) shows that section's tab first. */
  const showSection = useCallback((sectionId: string) => setTab(chatSettingsCategory(sectionId)), [setTab]);
  return { tab, setTab, showSection };
}
