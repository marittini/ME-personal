// ──────────────────────────────────────────────
// Web fonts (ported from the "웹폰트 매니저" personal extension 1.0.1)
//
// The owner pastes @font-face or @import code; only HTTPS font files are accepted, imports are
// expanded once at registration so the stored CSS is plain @font-face rules. Registered families
// are offered in the app's font pickers (app font, chat widget font, each mode's reading font).
// `targets` is the earlier per-target choice (UI / RP / CONVO); it is moved once into those
// pickers' settings (use-web-fonts.ts) and then cleared.
// ──────────────────────────────────────────────

export const WEB_FONT_TARGETS = ["ui", "roleplay", "conversation"] as const;
export type WebFontTarget = (typeof WEB_FONT_TARGETS)[number];

export type WebFontChoice = {
  family?: string;
  /** px */
  size?: number;
  /** px */
  spacing?: number;
  /** unitless */
  height?: number;
};

export type WebFontSettings = {
  /** Registered @font-face rules (already expanded and checked). */
  css: string;
  /** Legacy per-target choices, read once for the move into the font pickers. */
  targets: Partial<Record<WebFontTarget, WebFontChoice>>;
};

export const WEB_FONT_METRICS = {
  size: { min: 10, max: 48, step: 1, initial: 16, unit: "px" },
  spacing: { min: -2, max: 6, step: 0.1, initial: 0, unit: "px" },
  height: { min: 1, max: 3, step: 0.05, initial: 1.5, unit: "" },
} as const;
export type WebFontMetric = keyof typeof WEB_FONT_METRICS;

export const EMPTY_WEB_FONT_SETTINGS: WebFontSettings = { css: "", targets: {} };
const MAX_CSS_BYTES = 262_144;
const MAX_IMPORTS = 16;
const URL_PATTERN = /url\(\s*(?:"([^"\\]*)"|'([^'\\]*)'|([^\s)\\]+))\s*\)/gi;

export class WebFontError extends Error {}

function httpsUrl(value: string, base?: string) {
  const url = new URL(value.startsWith("//") ? `https:${value}` : value, base);
  if (url.protocol !== "https:" || url.username || url.password) throw new WebFontError("invalid");
  return url.href;
}

function clampMetric(key: WebFontMetric, value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const metric = WEB_FONT_METRICS[key];
  return Number(Math.min(metric.max, Math.max(metric.min, value)).toFixed(2));
}

/** Reads stored settings defensively; anything malformed falls back to "not set". */
export function parseWebFontSettings(raw: unknown): WebFontSettings {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return EMPTY_WEB_FONT_SETTINGS;
    }
  }
  if (!value || typeof value !== "object") return EMPTY_WEB_FONT_SETTINGS;
  const record = value as { css?: unknown; targets?: unknown };
  const targets: WebFontSettings["targets"] = {};
  const source =
    record.targets && typeof record.targets === "object" ? (record.targets as Record<string, unknown>) : {};
  for (const target of WEB_FONT_TARGETS) {
    const choice = source[target];
    if (!choice || typeof choice !== "object") continue;
    const c = choice as Record<string, unknown>;
    const next: WebFontChoice = {
      family: typeof c.family === "string" && c.family.trim() ? c.family.trim() : undefined,
      size: clampMetric("size", c.size),
      spacing: clampMetric("spacing", c.spacing),
      height: clampMetric("height", c.height),
    };
    if (Object.values(next).some((v) => v !== undefined)) targets[target] = next;
  }
  return { css: typeof record.css === "string" ? record.css : "", targets };
}

/** The @font-face rules in `css` (no other rules), with their family names and HTTPS sources. */
export function parseFontFaces(css: string, base?: string): { family: string; css: string }[] {
  if (!css.trim() || /@import\b/i.test(css) || css.includes("\\")) throw new WebFontError("invalid");
  if (new TextEncoder().encode(css).length > MAX_CSS_BYTES) throw new WebFontError("limit");
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  const faces = Array.from(sheet.cssRules)
    .filter((rule): rule is CSSFontFaceRule => rule instanceof CSSFontFaceRule)
    .map((rule) => {
      const family = rule.style
        .getPropertyValue("font-family")
        .trim()
        .replace(/^(['"])(.*)\1$/, "$2");
      let source = rule.style.getPropertyValue("src");
      const urls = [...source.matchAll(URL_PATTERN)];
      if (!family || !source || source.includes("\\") || !urls.length) throw new WebFontError("invalid");
      if ((source.match(/url\(/gi) ?? []).length !== urls.length) throw new WebFontError("invalid");
      const resolved = urls.map((match) => httpsUrl(match[1] || match[2] || match[3]!, base));
      let index = 0;
      source = source.replace(URL_PATTERN, () => `url(${JSON.stringify(resolved[index++])})`);
      rule.style.setProperty("src", source);
      if (!rule.style.getPropertyValue("font-display")) rule.style.setProperty("font-display", "swap");
      return { family, css: rule.cssText };
    });
  if (!faces.length) throw new WebFontError("invalid");
  return faces;
}

/**
 * Turns pasted code into stored @font-face CSS. `@import url(https://…)` lines are fetched (without
 * credentials) and their @font-face rules kept; nested imports up to four deep, 16 files in all.
 */
export async function resolveWebFontCss(input: string, fetcher: typeof fetch = fetch): Promise<string> {
  let bytes = new TextEncoder().encode(input).length;
  let files = 0;
  if (bytes > MAX_CSS_BYTES) throw new WebFontError("limit");
  async function expand(css: string, base: string | undefined, stack: string[]): Promise<string> {
    if (css.includes("\\")) throw new WebFontError("invalid");
    css = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const imports: string[] = [];
    const own = css.replace(
      /@import\s+(?:url\(\s*(?:"([^"\\]*)"|'([^'\\]*)'|([^\s)\\]+))\s*\)|"([^"\\]*)"|'([^'\\]*)')\s*;/gi,
      (_match, a, b, c, d, e) => {
        imports.push(a || b || c || d || e);
        return "";
      },
    );
    if (/@import\b/i.test(own)) throw new WebFontError("invalid");
    const result: string[] = [];
    for (const value of imports) {
      const url = httpsUrl(value, base);
      files += 1;
      if (files > MAX_IMPORTS || stack.length >= 4 || stack.includes(url)) throw new WebFontError("limit");
      const response = await fetcher(url, { credentials: "omit", referrerPolicy: "no-referrer" });
      if (!response.ok) throw new WebFontError(`HTTP ${response.status}`);
      const text = await response.text();
      bytes += new TextEncoder().encode(text).length;
      if (bytes > MAX_CSS_BYTES) throw new WebFontError("limit");
      result.push(await expand(text, httpsUrl(response.url || url), [...stack, url]));
    }
    if (own.trim())
      result.push(
        parseFontFaces(own, base)
          .map((face) => face.css)
          .join("\n"),
      );
    return result.filter(Boolean).join("\n");
  }
  const css = await expand(input, undefined, []);
  if (!css.trim()) throw new WebFontError("invalid");
  return css;
}

/** Family names in the stored CSS, in order. */
export function registeredFamilies(css: string): string[] {
  if (!css.trim()) return [];
  try {
    return [...new Set(parseFontFaces(css).map((face) => face.family))];
  } catch {
    return [];
  }
}

/** Removes one family's rules from the stored CSS. */
export function removeFamily(css: string, family: string): string {
  return parseFontFaces(css)
    .filter((face) => face.family !== family)
    .map((face) => face.css)
    .join("\n");
}

/** The stylesheet that loads the registered faces. Fonts are chosen in the app's font pickers, not here. */
export function buildWebFontStylesheet(settings: WebFontSettings): string {
  // Stored CSS is checked again here: only @font-face rules with HTTPS sources reach the page.
  if (!settings.css.trim()) return "";
  try {
    return parseFontFaces(settings.css)
      .map((face) => face.css)
      .join("\n");
  } catch {
    return "";
  }
}
