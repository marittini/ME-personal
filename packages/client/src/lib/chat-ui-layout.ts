/**
 * Chat room UI manager (merged from the "채팅방 UI 관리" personal extension): per chat mode, where each Chat Settings
 * item goes (top bubble, inside Chat Settings, or hidden), the order inside Chat Settings, and how each message tool
 * shows (in the row, behind "more", or hidden) and in which order.
 */
export type ChatUiMode = "roleplay" | "conversation";
/** "remote": a popped-out window shown on the chat remote dock instead of as a top bubble (chat-remote.ts). */
export type ChatUiPlacement = "top" | "remote" | "settings" | "hidden";
export type ChatUiToolPlacement = "show" | "more" | "hidden";

export interface ChatUiLayout {
  /** Only explicit choices are kept; an item without one stays where the engine put it. */
  placement: Record<string, ChatUiPlacement>;
  /** Chat Settings item IDs in the chosen order (items not listed keep their place after these). */
  order: string[];
  tools: Record<string, ChatUiToolPlacement>;
  toolOrder: string[];
}
export type ChatUiLayouts = Partial<Record<ChatUiMode, ChatUiLayout>>;

const SAFE_ID = /^[a-z0-9][a-z0-9:_.-]{0,120}$/i;
const PLACEMENTS = new Set<ChatUiPlacement>(["top", "remote", "settings", "hidden"]);
const TOOL_PLACEMENTS = new Set<ChatUiToolPlacement>(["show", "more", "hidden"]);

function record<T extends string>(value: unknown, allowed: Set<T>): Record<string, T> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, T] => SAFE_ID.test(entry[0]) && allowed.has(entry[1] as T),
    ),
  );
}

function ids(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === "string" && SAFE_ID.test(id)))].slice(0, 200)
    : [];
}

export function normalizeChatUiLayout(value: unknown): ChatUiLayout {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    placement: record(source.placement, PLACEMENTS),
    order: ids(source.order),
    tools: record(source.tools, TOOL_PLACEMENTS),
    toolOrder: ids(source.toolOrder),
  };
}

export function chatUiMode(mode: string | null | undefined): ChatUiMode | null {
  return mode === "roleplay" || mode === "conversation" ? mode : null;
}

/** Moves `id` one step up or down within `visible` (the order shown), keeping every other stored ID. */
export function moveInOrder(stored: string[], visible: string[], id: string, step: -1 | 1) {
  const order = [...visible];
  const index = order.indexOf(id);
  const target = index + step;
  if (index < 0 || target < 0 || target >= order.length) return stored;
  [order[index], order[target]] = [order[target]!, order[index]!];
  return [...order, ...stored.filter((entry) => !order.includes(entry))];
}

/** Moves `id` right before `target` within `visible` (a drag and drop), keeping every other stored ID. */
export function moveBefore(stored: string[], visible: string[], id: string, target: string) {
  const order = visible.filter((entry) => entry !== id);
  const index = order.indexOf(target);
  if (index < 0 || !visible.includes(id)) return stored;
  order.splice(index, 0, id);
  return [...order, ...stored.filter((entry) => !order.includes(entry))];
}

/**
 * A message tool's stable ID: an explicit `data-chat-action-id`, else its Lucide icon (language-independent), else its
 * label. The first ID a button gets is kept, so an icon that changes with state (copy → check) stays one tool.
 */
const toolIds = new WeakMap<Element, string>();
export function messageToolId(node: Element): string | null {
  const known = toolIds.get(node);
  if (known) return known;
  const explicit = node.getAttribute("data-chat-action-id");
  const icon = Array.from(node.querySelector("svg.lucide")?.classList ?? []).find(
    (name) => name.startsWith("lucide-") && name !== "lucide-icon",
  );
  const label = (node.getAttribute("aria-label") ?? node.getAttribute("title") ?? "").trim();
  const id =
    explicit && SAFE_ID.test(explicit)
      ? explicit
      : icon
        ? `icon:${icon.slice("lucide-".length)}`
        : label
          ? `label:${hash(label)}`
          : null;
  if (id) toolIds.set(node, id);
  return id;
}

function hash(text: string) {
  let value = 5381;
  for (let index = 0; index < text.length; index++) value = Math.imul(value, 33) ^ text.charCodeAt(index);
  return (value >>> 0).toString(36);
}

/** A message tool's readable name for the manager list. */
export function messageToolLabel(node: Element) {
  return (
    node.getAttribute("aria-label") ??
    node.getAttribute("title") ??
    node.querySelector("[aria-label]")?.getAttribute("aria-label") ??
    node.querySelector("[title]")?.getAttribute("title") ??
    ""
  ).trim();
}
