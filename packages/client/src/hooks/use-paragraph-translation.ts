import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { useTranslationStore } from "../stores/translation.store";

export function useTranslateParagraph(chatId: string) {
  return useMutation({
    mutationFn: async (text: string) => {
      const config = { ...useTranslationStore.getState().config };
      return api.post<{ translatedText: string }>("/translate", {
        chatId,
        text,
        provider: config.provider,
        targetLanguage: config.outputTargetLanguage,
        connectionId: config.connectionId,
        systemPrompt: config.outputSystemPrompt,
        deeplApiKey: config.deeplApiKey,
        deeplxUrl: config.deeplxUrl,
      });
    },
  });
}
export function useSaveParagraphTranslation(chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { messageId: string; source: string; swipeIndex: number; paragraphs: string[] }) =>
      api.post("/native-integrations/translation/paragraphs", { ...body, chatId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chats", "messages", chatId] }),
  });
}
