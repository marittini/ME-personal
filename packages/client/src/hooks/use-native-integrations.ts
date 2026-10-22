import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { nativeIntegrationsSchema, type NativeIntegrations, type WeatherLocation } from "@marinara-engine/shared";
import { api } from "../lib/api-client";
const key = ["native-integrations"];
export function useNativeIntegrations() {
  return useQuery({
    queryKey: key,
    queryFn: async () => nativeIntegrationsSchema.parse(await api.get("/native-integrations/settings")),
    staleTime: 60_000,
  });
}
export function useSaveNativeIntegrations() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: NativeIntegrations) => api.put<NativeIntegrations>("/native-integrations/settings", data),
    onSuccess: (data) => qc.setQueryData(key, data),
  });
}
export function useWeatherPlaces(query: string, worldwide: boolean) {
  return useQuery({
    queryKey: ["weather-places", query, worldwide],
    queryFn: () =>
      api.get<WeatherLocation[]>(
        `/native-integrations/weather/places?query=${encodeURIComponent(query)}&worldwide=${worldwide}`,
      ),
    staleTime: 60_000,
  });
}
export function useWeatherPreview() {
  return useMutation({
    mutationFn: (location: WeatherLocation) =>
      api.post<{ summary: string }>("/native-integrations/weather/preview", location),
  });
}
export function useApplyGlobalPreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (chatIds: string[]) => api.post<{ changed: number }>("/native-integrations/presets/apply", { chatIds }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["chats"] });
      void qc.invalidateQueries({ queryKey: key });
    },
  });
}
export type VaultEntry = { id: string; name: string; group: string };
export function useVaultStatus() {
  return useQuery({
    queryKey: ["key-vault-status"],
    queryFn: () => api.get<{ exists: boolean }>("/native-integrations/vault"),
  });
}
export function useKeyVault() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      api.post<{ entries?: VaultEntry[]; exists?: boolean; backup?: unknown; selectedKey?: string }>(
        "/native-integrations/vault",
        input,
      ),
    onSuccess: (_data, input) => {
      void qc.invalidateQueries({ queryKey: ["key-vault-status"] });
      if (input.action === "apply") void qc.invalidateQueries({ queryKey: ["connections"] });
    },
  });
}
export type NovelAiImport = {
  values: Record<string, string | number>;
  omitted: string[];
  modelOptions: string[];
  source: string;
};
export function useReadNovelAiMetadata() {
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api.upload<NovelAiImport>("/native-integrations/nai-metadata", form);
    },
  });
}

export function useExtractTranslationGlossary() {
  return useMutation({
    mutationFn: (input: { chatId: string; text: string }) =>
      api.post<{ entries: NativeIntegrations["translation"]["rooms"][string]["glossary"] }>(
        "/native-integrations/translation/extract",
        input,
      ),
  });
}
