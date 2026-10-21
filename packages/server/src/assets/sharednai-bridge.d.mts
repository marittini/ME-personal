export function parseCredential(value: string): Record<string, unknown> | null;
export function handleIntercepted(args: { fetchImpl: typeof fetch; init: {body: string | FormData; signal?: AbortSignal}; credential: Record<string, unknown>; origin: string; tokenCache: Map<string, string>; mutexes: Map<string, Promise<unknown>>; logger: unknown }): Promise<Response>;
export function translateNovelAiRequest(body: Record<string, unknown>, refs?: Map<string, Buffer>): Record<string, unknown>;
