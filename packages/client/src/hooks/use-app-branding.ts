import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { setDocumentTitleOverride } from "../localization/i18n";

export interface AppBranding {
  name: string;
  shortName: string;
  effectiveName: string;
  effectiveShortName: string;
  icon: { updatedAt: string; favicon: string; touch: string; large: string } | null;
}

export const appBrandingKey = ["app-branding"] as const;

export function useAppBranding() {
  return useQuery<AppBranding>({ queryKey: appBrandingKey, queryFn: () => api.get("/branding"), staleTime: 60_000 });
}

export function useSaveAppBrandingNames() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (names: { name: string; shortName: string }) => api.put<AppBranding>("/branding", names),
    onSuccess: (status) => queryClient.setQueryData(appBrandingKey, status),
  });
}

export function useUploadAppIcon() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      return api.upload<AppBranding>("/branding/icon", formData);
    },
    onSuccess: (status) => queryClient.setQueryData(appBrandingKey, status),
  });
}

export function useResetAppIcon() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<AppBranding>("/branding/icon"),
    onSuccess: (status) => queryClient.setQueryData(appBrandingKey, status),
  });
}

function setLink(rel: string, href: string) {
  let link = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!link) {
    link = document.createElement("link");
    link.rel = rel;
    document.head.append(link);
  }
  if (link.getAttribute("href") !== href) link.href = href;
}

function setMeta(name: string, content: string) {
  let meta = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = name;
    document.head.append(meta);
  }
  meta.content = content;
}

/** Keeps the tab title, favicon and home-screen icon/name in step with the app branding settings. */
export function useApplyAppBranding() {
  const { data } = useAppBranding();
  useEffect(() => {
    if (!data) return;
    setDocumentTitleOverride(data.name || null);
    setLink("icon", data.icon?.favicon ?? "/favicon.png");
    setLink("apple-touch-icon", data.icon?.touch ?? "/icon-192.png");
    setMeta("apple-mobile-web-app-title", data.effectiveShortName);
    setMeta("application-name", data.effectiveName);
  }, [data]);
}
