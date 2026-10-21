import { type HudWidget, type HudWidgetConfig, type HudWidgetType } from "@marinara-engine/shared";

export const MAX_GAME_SETUP_WIDGETS = 4;

const DEFAULT_ACCENTS: Record<HudWidgetType, string> = {
  progress_bar: "#a78bfa",
  gauge: "#22c55e",
  relationship_meter: "var(--marinara-chat-chrome-accent)",
  counter: "#38bdf8",
  stat_block: "#f59e0b",
  list: "#14b8a6",
  inventory_grid: "#94a3b8",
  timer: "var(--marinara-chat-chrome-accent)",
};

const DEFAULT_ICONS: Record<HudWidgetType, string> = {
  progress_bar: "◆",
  gauge: "◔",
  relationship_meter: "♥",
  counter: "#",
  stat_block: "▦",
  list: "☰",
  inventory_grid: "▣",
  timer: "◷",
};

interface NormalizeGameHudWidgetsOptions {
  mode?: "persisted" | "draft";
}

function isHudWidgetType(value: unknown): value is HudWidgetType {
  return (
    value === "progress_bar" ||
    value === "gauge" ||
    value === "relationship_meter" ||
    value === "counter" ||
    value === "stat_block" ||
    value === "list" ||
    value === "inventory_grid" ||
    value === "timer"
  );
}

function formatWidgetTypeLabel(type: HudWidgetType) {
  return type
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function slugifyWidgetId(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "widget"
  );
}

function nextWidgetId(base: string, widgets: readonly HudWidget[]) {
  const used = new Set(widgets.map((widget) => widget.id));
  const stem = slugifyWidgetId(base);
  let candidate = stem;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${stem}_${suffix++}`;
  }
  return candidate;
}

function parseNumber(value: unknown, fallback: number, min?: number) {
  const parsed = typeof value === "string" && value.trim() ? Number(value.trim()) : value;
  const numeric = typeof parsed === "number" && Number.isFinite(parsed) ? parsed : fallback;
  return typeof min === "number" ? Math.max(min, numeric) : numeric;
}

function defaultWidgetConfig(type: HudWidgetType): HudWidgetConfig {
  switch (type) {
    case "progress_bar":
      return { startingValue: 100, value: 100, max: 100 };
    case "gauge":
      return { startingValue: 50, value: 50, max: 100, dangerBelow: 25 };
    case "relationship_meter":
      return { startingValue: 50, value: 50, max: 100 };
    case "counter":
      return { count: 0 };
    case "stat_block":
      return { stats: [{ name: "Status", value: "Stable" }] };
    case "list":
      return { items: [] };
    case "inventory_grid":
      return { slots: 8, contents: [] };
    case "timer":
      return { seconds: 60, running: false };
  }
}

function normalizeConfig(
  type: HudWidgetType,
  config: unknown,
  options: NormalizeGameHudWidgetsOptions = {},
): HudWidgetConfig {
  const source = config && typeof config === "object" && !Array.isArray(config) ? (config as HudWidgetConfig) : {};
  const fallback = defaultWidgetConfig(type);
  const draftMode = options.mode === "draft";

  if (type === "progress_bar" || type === "gauge" || type === "relationship_meter") {
    const max = parseNumber(source.max, fallback.max ?? 100, 1);
    const value = Math.max(0, Math.min(max, parseNumber(source.value ?? source.startingValue, fallback.value ?? 0)));
    return {
      ...source,
      max,
      value,
      startingValue: Math.min(max, parseNumber(source.startingValue ?? value, value, 0)),
    };
  }

  if (type === "counter") {
    return { ...source, count: Math.round(parseNumber(source.count, 0)) };
  }

  if (type === "stat_block") {
    const stats = Array.isArray(source.stats)
      ? source.stats
          .map((stat) => {
            const rawValue = (stat as { value?: unknown }).value;
            return {
              name: draftMode
                ? String((stat as { name?: unknown }).name ?? "")
                : String((stat as { name?: unknown }).name ?? "").trim(),
              value: typeof rawValue === "number" || typeof rawValue === "string" ? rawValue : "",
            };
          })
          .filter((stat) => draftMode || stat.name)
      : (fallback.stats ?? []);
    return { ...source, stats };
  }

  if (type === "list") {
    return {
      ...source,
      items: Array.isArray(source.items) ? source.items.map((item) => String(item).trim()).filter(Boolean) : [],
    };
  }

  if (type === "inventory_grid") {
    return {
      ...source,
      slots: Math.round(parseNumber(source.slots, 8, 1)),
      contents: Array.isArray(source.contents) ? source.contents : [],
    };
  }

  return {
    ...source,
    seconds: Math.round(parseNumber(source.seconds, 60, 0)),
    running: source.running === true,
  };
}

export function normalizeGameHudWidgets(value: unknown, options: NormalizeGameHudWidgetsOptions = {}): HudWidget[] {
  if (!Array.isArray(value)) return [];
  const normalized: HudWidget[] = [];
  const usedIds = new Set<string>();
  const draftMode = options.mode === "draft";

  for (const entry of value) {
    if (!entry || typeof entry !== "object" || normalized.length >= MAX_GAME_SETUP_WIDGETS) continue;
    const raw = entry as Partial<HudWidget>;
    const type = isHudWidgetType(raw.type) ? raw.type : "progress_bar";
    const rawLabel = typeof raw.label === "string" ? raw.label : "";
    const label = draftMode ? rawLabel : rawLabel.trim() || formatWidgetTypeLabel(type);
    const preferredId = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : nextWidgetId(label, normalized);
    const id = usedIds.has(preferredId) ? nextWidgetId(label, normalized) : preferredId;
    usedIds.add(id);
    normalized.push({
      id,
      type,
      label,
      icon: typeof raw.icon === "string" ? raw.icon.slice(0, 8) : DEFAULT_ICONS[type],
      position: raw.position === "hud_right" ? "hud_right" : "hud_left",
      accent: typeof raw.accent === "string" && raw.accent.trim() ? raw.accent.trim() : DEFAULT_ACCENTS[type],
      config: normalizeConfig(type, raw.config, options),
    });
  }

  return normalized;
}
