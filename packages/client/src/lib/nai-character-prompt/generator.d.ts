export type PromptSource = { description: string; appearance: string };
export type PromptAdapter = { generate: (connectionId: string, messages: Array<{ role: string; content: string }>, signal?: AbortSignal) => Promise<string> };
export function generatePrompt(adapter: PromptAdapter, connectionId: string, source: PromptSource, signal?: AbortSignal): Promise<{ prompt: string; negative: string }>;
