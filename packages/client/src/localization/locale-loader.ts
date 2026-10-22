import { readerKoreanMessages } from "./reader-ko";
import { committedMemoryKoreanMessages } from "./committed-memory-ko";
import { naiQueueKoreanMessages } from "./nai-queue-ko";
import { normalizeLocaleResource, normalizeUILanguage, UI_LANGUAGE_CODES } from "@marinara-engine/shared";
import { api } from "../lib/api-client";
import { DEFAULT_APP_LANGUAGE, type AppLanguage, type LoadedLocale, type LocaleDescriptor } from "./locale-types";

export { normalizeLocaleResource } from "@marinara-engine/shared";

const bundledAssets = import.meta.env
  ? import.meta.glob<string>("./locales/ko.json", { import: "default", query: "?url" })
  : { "./locales/ko.json": async () => `${new URL(/* @vite-ignore */ ".", import.meta.url).href}locales/ko.json` };

const englishAsset = import.meta.env
  ? import.meta.glob<string>("./locales/en.json", { import: "default", query: "?url" })["./locales/en.json"]!
  : async () => `${new URL(/* @vite-ignore */ ".", import.meta.url).href}locales/en.json`;

function getNativeLanguageName(locale: string): string {
  try {
    const name = new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale;
    return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
  } catch {
    return locale;
  }
}

export const APP_LANGUAGE_OPTIONS: readonly LocaleDescriptor[] = Object.freeze(
  UI_LANGUAGE_CODES.map((id) => ({ id, label: getNativeLanguageName(id) })),
);

export function resolveSupportedLocale(value: unknown): AppLanguage {
  return normalizeUILanguage(value) ?? DEFAULT_APP_LANGUAGE;
}

export async function loadLocaleResource(value: unknown): Promise<LoadedLocale | null> {
  const locale = resolveSupportedLocale(value);
  if (locale !== DEFAULT_APP_LANGUAGE) {
    // Reads local data only. Downloading a pack is an explicit settings action.
    const bundled = bundledAssets[`./locales/${locale}.json`];
    const resource = bundled
      ? await (async () => {
          const response = await fetch(await bundled());
          if (!response.ok) throw new Error(`Localization file ${locale}.json returned HTTP ${response.status}`);
          return response.json();
        })()
      : await api.get<unknown>(`/ui-languages/${encodeURIComponent(locale)}`);
    const loaded = resource === null ? null : normalizeLocaleResource(locale, resource);
    if (loaded && locale === "ko")
      Object.assign(loaded.messages, naiQueueKoreanMessages, committedMemoryKoreanMessages, readerKoreanMessages);
    return loaded;
  }
  const response = await fetch(await englishAsset());
  if (!response.ok) throw new Error(`Localization file en.json returned HTTP ${response.status}`);
  return normalizeLocaleResource(locale, await response.json());
}
