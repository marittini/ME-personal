import { useMutation, useQuery } from "@tanstack/react-query";
import { api, requestTimeoutSignal } from "../lib/api-client";
import { generatePrompt } from "../lib/nai-character-prompt/generator.js";

interface CardRecord {
  id: string;
  name?: string;
  comment?: string;
  data?: string | { name?: string; description?: string; extensions?: { appearance?: string } };
  description?: string;
  appearance?: string;
}
function characterData(record: CardRecord) {
  return typeof record.data === "string"
    ? (JSON.parse(record.data) as Exclude<CardRecord["data"], string>)
    : record.data;
}
export function useNaiPromptSources() {
  return useQuery({
    queryKey: ["nai-prompt-sources"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [characters, personas] = await Promise.all([
        api.get<CardRecord[]>("/characters?includeBuiltIn=true"),
        api.get<CardRecord[]>("/characters/personas/list"),
      ]);
      return [
        ...characters.map((card) => ({
          id: card.id,
          kind: "character" as const,
          name: card.name || characterData(card)?.name || card.id,
          comment: card.comment,
        })),
        ...personas.map((card) => ({
          id: card.id,
          kind: "persona" as const,
          name: card.name || card.id,
          comment: card.comment,
        })),
      ];
    },
  });
}
export function useGenerateNaiPrompt() {
  return useMutation({
    mutationFn: async ({
      id,
      kind,
      connectionId,
      signal,
    }: {
      id: string;
      kind: "character" | "persona";
      connectionId: string;
      signal: AbortSignal;
    }) => {
      const record = await api.get<CardRecord>(
        `${kind === "character" ? "/characters/" : "/characters/personas/"}${encodeURIComponent(id)}`,
        { signal },
      );
      const data = kind === "character" ? characterData(record) : record;
      const source = {
        description: typeof data?.description === "string" ? data.description : "",
        appearance:
          kind === "character"
            ? typeof (data as { extensions?: { appearance?: string } })?.extensions?.appearance === "string"
              ? (data as { extensions: { appearance: string } }).extensions.appearance
              : ""
            : (record.appearance ?? ""),
      };
      return generatePrompt(
        {
          generate: async (connection, messages, upstream) => {
            upstream?.throwIfAborted();
            if (messages.some((message) => message.content.length > 500000))
              throw new Error("Source exceeds generation input limit");
            const requestSignal = requestTimeoutSignal(180_000, upstream);
            const runId = crypto.randomUUID();
            const abort = () => {
              void api
                .post(
                  "/generate/raw/abort",
                  { runId, connectionId: connection },
                  { signal: requestTimeoutSignal(5000) },
                )
                .catch(() => undefined);
            };
            requestSignal.addEventListener("abort", abort, { once: true });
            try {
              const result = await api.post<{ content: string }>(
                "/generate/raw",
                { connectionId: connection, runId, messages, streaming: false, parameters: { maxTokens: 8192 } },
                { signal: requestSignal },
              );
              if (!result.content?.trim()) throw new Error("Empty model response");
              return result.content;
            } finally {
              requestSignal.removeEventListener("abort", abort);
            }
          },
        },
        connectionId,
        source,
        signal,
      );
    },
  });
}
