import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { registeredFamilies } from "../lib/web-fonts";
import { useWebFontSettings } from "./use-web-fonts";

/** Reuse the engine font catalog and the font faces registered by App. */
export function useReaderFonts() {
  return useQuery<{ family: string }[]>({
    queryKey: ["custom-fonts"],
    queryFn: () => api.get("/fonts"),
    staleTime: Infinity,
  });
}

/**
 * Every font a font picker offers: the engine's font folder and the web fonts registered in Settings (web fonts are
 * only a registry; the UI, RP and Convo fonts are chosen where those fonts were always chosen).
 */
export function useFontFamilies() {
  const { data: folderFonts } = useReaderFonts();
  const { data: webFonts } = useWebFontSettings();
  return useMemo(() => {
    const web = webFonts ? registeredFamilies(webFonts.css) : [];
    const folder = [...new Set((folderFonts ?? []).map((font) => font.family.trim()).filter(Boolean))].filter(
      (family) => !web.includes(family),
    );
    return { folder, web };
  }, [folderFonts, webFonts]);
}
