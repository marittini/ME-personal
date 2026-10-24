import { useEffect } from "react";
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

/** Keeps one <style> in the head in step with the saved web-font settings. */
export function useApplyWebFonts() {
  const { data } = useWebFontSettings();
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
