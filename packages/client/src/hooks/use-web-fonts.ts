import { useEffect, useRef } from "react";
import { useUIStore } from "../stores/ui.store";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { buildWebFontStylesheet, parseWebFontSettings, type WebFontSettings } from "../lib/web-fonts";

export const webFontsKey = ["app-settings", "web-fonts"] as const;

export function useWebFontSettings() {
  return useQuery<WebFontSettings>({
    queryKey: webFontsKey,
    queryFn: async () =>
      parseWebFontSettings((await api.get<{ value: string | null }>("/app-settings/web-fonts")).value),
    staleTime: Infinity,
  });
}

export function useSaveWebFontSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (next: WebFontSettings) => {
      await api.put("/app-settings/web-fonts", { value: JSON.stringify(next) });
      return next;
    },
    onSuccess: (next) => queryClient.setQueryData(webFontsKey, next),
  });
}

const STYLE_ID = "marinara-web-fonts";

/**
 * Moves the earlier per-target web-font choices into the app's own font settings, once: UI → the app font (when none
 * is set), RP / CONVO → that mode's reading font, line height and letter spacing, and a chosen size → the chat text
 * size. Then the targets are cleared from the saved web-font settings.
 */
function moveLegacyTargets(settings: WebFontSettings) {
  const ui = useUIStore.getState();
  const { targets } = settings;
  if (targets.ui?.family && !ui.fontFamily) ui.setFontFamily(targets.ui.family);
  let preferences = ui.readerPreferences;
  for (const mode of ["roleplay", "conversation"] as const) {
    const choice = targets[mode];
    if (!choice) continue;
    preferences = {
      ...preferences,
      [mode]: {
        ...preferences[mode],
        ...(choice.family ? { font: `custom:${choice.family}` } : {}),
        ...(choice.height !== undefined ? { lineHeight: Math.min(3, Math.max(1, choice.height)) } : {}),
        ...(choice.spacing !== undefined ? { letterSpacing: Math.min(5, Math.max(-1, choice.spacing)) } : {}),
      },
    };
  }
  useUIStore.setState({ readerPreferences: preferences });
  const size = targets.roleplay?.size ?? targets.conversation?.size;
  if (size !== undefined) ui.setChatFontSize(Math.min(32, Math.max(12, Math.round(size))));
}

/** Keeps one <style> in the head in step with the saved web-font settings. */
export function useApplyWebFonts() {
  const { data } = useWebFontSettings();
  const save = useSaveWebFontSettings();
  const moved = useRef(false);
  useEffect(() => {
    if (!data || moved.current || !Object.keys(data.targets).length) return;
    moved.current = true;
    moveLegacyTargets(data);
    save.mutate({ css: data.css, targets: {} });
  }, [data, save]);
  useEffect(() => {
    if (!data) return;
    const text = buildWebFontStylesheet(data);
    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!text) {
      style?.remove();
      return;
    }
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      document.head.append(style);
    }
    if (style.textContent !== text) style.textContent = text;
  }, [data]);
}
