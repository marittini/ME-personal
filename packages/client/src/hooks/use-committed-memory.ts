import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CommittedMemoryStatus, CommittedMemorySelection } from "@marinara-engine/shared";
import { api } from "../lib/api-client";
import { chatKeys } from "./use-chats";
export function useCommittedMemory(chatId: string) {
  return useQuery({
    queryKey: ["committed-memory", chatId],
    queryFn: () => api.get<CommittedMemoryStatus>(`/chats/${chatId}/committed-memory`),
    refetchInterval: 5000,
  });
}
export function useCommitMemory(chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<CommittedMemoryStatus>(`/chats/${chatId}/committed-memory/commit`, {}),
    onSuccess: (data) => {
      qc.setQueryData(["committed-memory", chatId], data);
      void qc.invalidateQueries({ queryKey: chatKeys.detail(chatId) });
    },
  });
}
export function useSetCommittedMemory(chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      api.patch<CommittedMemoryStatus>(`/chats/${chatId}/committed-memory`, { enabled }),
    onSuccess: (data) => {
      qc.setQueryData(["committed-memory", chatId], data);
      void qc.invalidateQueries({ queryKey: chatKeys.detail(chatId) });
    },
  });
}
export function useMemoryPreview(chatId: string, query: string, enabled: boolean) {
  return useQuery({
    queryKey: ["committed-memory-preview", chatId, query],
    queryFn: () =>
      api.get<{ selected: CommittedMemorySelection[]; usedBytes: number; budgetBytes: number }>(
        `/chats/${chatId}/committed-memory/preview?query=${encodeURIComponent(query)}`,
      ),
    enabled,
    refetchInterval: enabled ? 5000 : false,
  });
}
export function useMemorySource(chatId: string, id: string, enabled: boolean) {
  return useQuery({
    queryKey: ["committed-memory-source", chatId, id],
    queryFn: () =>
      api.get<{ content: string; activeSwipeIndex: number }>(`/chats/${chatId}/committed-memory/source/${id}`),
    enabled,
    retry: false,
    staleTime: 0,
  });
}
export function useMemoryConnection(chatId: string) {
  return useQuery({
    queryKey: ["committed-memory-connection", chatId],
    queryFn: () =>
      api.get<import("@marinara-engine/shared").CommittedMemoryConnectionStatus>(
        `/chats/${chatId}/committed-memory/connection`,
      ),
    refetchInterval: 5000,
  });
}
export function useEditMemory(chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (edit: import("@marinara-engine/shared").CommittedMemoryEdit) =>
      api.patch<CommittedMemoryStatus>(`/chats/${chatId}/committed-memory/record`, edit),
    onSuccess: (data) => {
      qc.setQueryData(["committed-memory", chatId], data);
      void qc.invalidateQueries({ queryKey: ["committed-memory-preview", chatId] });
      void qc.invalidateQueries({ queryKey: chatKeys.detail(chatId) });
    },
  });
}
