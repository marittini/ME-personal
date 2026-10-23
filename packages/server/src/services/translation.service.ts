// ──────────────────────────────────────────────
// Routes: Translation — multi-provider message translation
// ──────────────────────────────────────────────
import type { DB } from "../db/connection.js";
import { z } from "zod";
import { isDebugAgentsEnabled } from "../config/runtime-config.js";
import { logDebugOverride } from "../lib/logger.js";
import { createConnectionsStorage } from "./storage/connections.storage.js";
import { createChatsStorage } from "./storage/chats.storage.js";
import { parseExtra } from "./generation/prompt-attachments.js";
import { createLLMProvider } from "./llm/provider-registry.js";
import { withConnectionFallbackProvider } from "./llm/connection-fallback-provider.js";
import { resolveStoredChatOptions, resolveStoredMaxTokens } from "./generation/generation-parameters.js";
import {
  DEFAULT_TRANSLATION_SYSTEM_PROMPT,
  PROVIDERS,
  hideTTSAudioCues,
  localAuthProviderBaseUrl,
  buildGameTranslationSource,
  getChatTranslationConfig,
  resolveTranslationSystemPrompt,
  type TranslationConfig,
} from "@marinara-engine/shared";
import { isDeeplxLocalUrlsEnabled } from "../config/runtime-config.js";
import { safeFetch, validateOutboundUrl } from "../utils/security.js";
import { resolveBaseUrl } from "../routes/generate/generate-route-utils.js";
import type { GenerationFallbackNotifier } from "./generation/fallback-notification.js";
import {
  TRANSLATION_SCAN_PROMPTS,
  collectTranslationMaterial,
  integratedTranslationInput,
} from "./native-integrations.js";

const GOOGLE_MAX_LENGTH = 5000;

const translateSchema = z.object({
  chatId: z.string().optional(),
  direction: z.enum(["input", "output"]).default("output"),
  debugMode: z.boolean().optional(),
  text: z.string().min(1).max(50000),
  provider: z.enum(["ai", "deeplx", "deepl", "google"]),
  targetLanguage: z.string().trim().min(1).max(100),
  connectionId: z.string().optional(),
  systemPrompt: z.string().max(100000).optional().nullable(),
  deeplApiKey: z.string().optional(),
  deeplxUrl: z
    .string()
    .url()
    .refine((u) => u.startsWith("http://") || u.startsWith("https://"), {
      message: "DeepLX URL must use http or https",
    })
    .optional(),
});

export async function translateText(db: DB, body: unknown, onFallback?: GenerationFallbackNotifier) {
  const input = await integratedTranslationInput(db, translateSchema.parse(body));
  // A translation is display text: speech always uses the original lines and their audio cues. Sending the
  // audio wrappers and cues would make the model echo them (or fail when it changes them), so strip them.
  if (input.direction !== "input") input.text = hideTTSAudioCues(input.text);
  const connections = createConnectionsStorage(db);
  let result: { translatedText: string };
  switch (input.provider) {
    case "ai":
      result = await translateWithAI(input, connections, onFallback);
      break;
    case "deeplx":
      result = await translateWithDeepLX(input);
      break;
    case "deepl":
      result = await translateWithDeepL(input);
      break;
    case "google":
      result = await translateWithGoogle(input);
      break;
  }
  return { translatedText: result.translatedText };
}

/**
 * The translation extension's "단어장 생성 / 말투 자동 정리 / 세계관 자동 정리": reads the chat's cards, persona,
 * linked lorebooks and recent messages and asks the chat's translation connection for entries to review.
 */
export async function scanTranslationReferences(db: DB, body: unknown) {
  const { chatId, kind } = z
    .object({ chatId: z.string().min(1), kind: z.enum(["glossary", "speech", "world"]) })
    .parse(body);
  const chat = await createChatsStorage(db).getById(chatId);
  if (!chat) throw Object.assign(new Error("Chat not found"), { statusCode: 404 });
  const config = getChatTranslationConfig(chatId, chat.metadata);
  if (!config.connectionId)
    throw Object.assign(new Error("Choose an AI translation connection first"), { statusCode: 400 });
  const target = config.outputTargetLanguage;
  const material = await collectTranslationMaterial(db, chat, kind !== "world");
  if (!material) throw Object.assign(new Error("No character card or conversation to read"), { statusCode: 400 });
  const raw = await completeWithConnection(
    createConnectionsStorage(db),
    config.connectionId,
    TRANSLATION_SCAN_PROMPTS[kind].replaceAll("{{target}}", target),
    `${material}\n\n${kind === "world" ? "Write the notes now." : "Return the JSON now."}`,
    { temperature: kind === "world" ? 0.3 : 0.2, maxTokens: 12000, label: `translation-scan:${kind}` },
  );
  return parseTranslationScan(kind, raw);
}

/** Parsed on its own so the regression can check it without a model. */
export function parseTranslationScan(kind: "glossary" | "speech" | "world", raw: string) {
  if (kind === "world") return { text: raw.replace(/^```[a-z]*\n?|\n?```\s*$/gi, "").trim() };
  const text = raw.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text);
  } catch {
    throw Object.assign(new Error("The model did not return JSON"), { statusCode: 502 });
  }
  const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const list = (value: unknown) => (Array.isArray(value) ? value : []) as Array<Record<string, unknown>>;
  if (kind === "glossary")
    return {
      entries: list(data.glossary)
        .map((row) => ({ source: str(row?.original), target: str(row?.translation) }))
        .filter((row) => row.source && row.target)
        .slice(0, 100),
    };
  return {
    entries: list(data.characters)
      .map((row) => {
        const samples = (Array.isArray(row?.samples) ? row.samples : [row?.samples])
          .map((line) => str(line).replace(/^["“]|["”]$/g, ""))
          .filter(Boolean)
          .map((line) => `"${line}"`)
          .join(" / ");
        const age = str(row?.age);
        const relations = str(row?.relations);
        const speech = str(row?.speech);
        return {
          name: str(row?.character),
          style: [
            age && `- 나이: ${age}`,
            relations && `- 관계: ${relations}`,
            speech,
            samples && `- 대사 예시: ${samples}`,
          ]
            .filter(Boolean)
            .join("\n"),
          speech,
        };
      })
      .filter((row) => row.name && row.speech)
      .map(({ name, style }) => ({ name, style }))
      .slice(0, 20),
  };
}

/** Translate the saved, final swipe so closing the browser cannot skip translation or its persistence. */
export async function translateGeneratedMessage(
  db: DB,
  input: {
    chatId: string;
    messageId: string;
    swipeIndex: number;
    mode: string;
    config: TranslationConfig;
    debugMode?: boolean;
  },
  onFallback?: GenerationFallbackNotifier,
) {
  const chats = createChatsStorage(db);
  const message = await chats.getMessage(input.messageId);
  if (!message || message.chatId !== input.chatId || message.role !== "assistant") return null;
  const swipe = (await chats.getSwipes(message.id)).find((row) => row.index === input.swipeIndex);
  if (!swipe) return null;
  const extra = parseExtra(swipe.extra);
  if (extra.translationHidden === true || extra.hiddenFromUser === true || extra.commandOnly === true) return null;
  // Game shows a saved translation only when its source matches the text the Game screen builds.
  const text =
    input.mode === "game"
      ? buildGameTranslationSource({ id: message.id, role: message.role, content: swipe.content })
      : swipe.content;
  if (!text.trim() || (extra.translationSource === text && typeof extra.translation === "string" && extra.translation))
    return null;
  // Game can backfill older narration in the browser. Mark this source before
  // the provider call so a reconnect cannot start a second automatic attempt.
  if (
    !(await chats.updateMessageExtraForSwipe(
      message.id,
      swipe.index,
      { automaticTranslationSource: swipe.content },
      swipe.content,
    ))
  )
    return null;
  const { config } = input;
  const { translatedText } = await translateText(
    db,
    {
      chatId: input.chatId,
      text,
      provider: config.provider,
      targetLanguage: config.outputTargetLanguage,
      connectionId: config.connectionId,
      systemPrompt: config.outputSystemPrompt,
      deeplApiKey: config.deeplApiKey,
      deeplxUrl: config.deeplxUrl,
      debugMode: input.debugMode,
    },
    onFallback,
  );
  if (!translatedText.trim()) throw new Error("Translation provider returned no text");
  return chats.updateMessageExtraForSwipe(
    message.id,
    swipe.index,
    {
      translation: translatedText,
      translationSource: text,
      translationHidden: false,
    },
    swipe.content,
  );
}

// ── AI Translation (via configured LLM connection) ──
async function translateWithAI(
  input: z.infer<typeof translateSchema>,
  connections: ReturnType<typeof createConnectionsStorage>,
  onFallback?: GenerationFallbackNotifier,
) {
  const systemPrompt = resolveTranslationSystemPrompt(
    input.systemPrompt?.trim() || DEFAULT_TRANSLATION_SYSTEM_PROMPT,
    input.targetLanguage,
  );
  const content = await completeWithConnection(
    connections,
    input.connectionId,
    systemPrompt,
    `Translate the following text to ${input.targetLanguage}:\n\n${input.text}`,
    { debugMode: input.debugMode, temperature: 0.3, label: "translate" },
    onFallback,
  );
  return { translatedText: content };
}

/** One system + user completion on a saved connection (with its fallback), as AI translation uses. */
async function completeWithConnection(
  connections: ReturnType<typeof createConnectionsStorage>,
  connectionId: string | undefined,
  system: string,
  user: string,
  options: { debugMode?: boolean; temperature: number; maxTokens?: number; label: string },
  onFallback?: GenerationFallbackNotifier,
) {
  if (!connectionId) {
    throw Object.assign(new Error("Connection ID is required for AI translation"), { statusCode: 400 });
  }

  const conn = await connections.getWithKey(connectionId);
  if (!conn) {
    throw Object.assign(new Error("API connection not found"), { statusCode: 400 });
  }

  let baseUrl = conn.baseUrl;
  if (!baseUrl) {
    const providerDef = PROVIDERS[conn.provider as keyof typeof PROVIDERS];
    baseUrl = providerDef?.defaultBaseUrl ?? "";
  }
  const localAuthBaseUrl = localAuthProviderBaseUrl(conn.provider);
  if (!baseUrl && localAuthBaseUrl) baseUrl = localAuthBaseUrl;
  if (!baseUrl) {
    throw Object.assign(new Error("No base URL configured for this connection"), { statusCode: 400 });
  }

  const fallbackConnection = await connections.getFallbackForMain();
  const provider = withConnectionFallbackProvider({
    primary: createLLMProvider(
      conn.provider,
      baseUrl,
      conn.apiKey,
      conn.maxContext,
      conn.openrouterProvider,
      conn.maxTokensOverride,
      conn.claudeFastMode === "true",
      conn.treatAsLocalEndpoint === "true",
      conn.defaultParameters,
    ),
    primaryConnectionId: conn.id,
    fallbackConnection,
    fallbackBaseUrl: fallbackConnection ? resolveBaseUrl(fallbackConnection) : "",
    category: "main",
    onFallback,
  });
  const { enabledParameters } = resolveStoredChatOptions(conn.defaultParameters, conn.provider, conn.model);
  logDebugOverride(
    options.debugMode === true || isDebugAgentsEnabled(),
    `[${options.label}] system=%s user=%s`,
    system,
    user,
  );
  const result = await provider.chatComplete(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    {
      model: conn.model,
      debugMode: options.debugMode,
      temperature: options.temperature,
      maxTokens:
        options.maxTokens ?? resolveStoredMaxTokens(conn.defaultParameters, provider.maxTokensOverrideValue ?? 4096),
      enabledParameters: { maxTokens: options.maxTokens ? true : enabledParameters?.maxTokens },
    },
  );

  return (result.content ?? "").trim();
}

// ── DeepLX Translation (self-hosted endpoint) ──
async function translateWithDeepLX(input: z.infer<typeof translateSchema>) {
  if (!input.deeplxUrl) {
    throw Object.assign(new Error("DeepLX URL is required"), { statusCode: 400 });
  }

  let url: URL;
  try {
    url = new URL("/translate", input.deeplxUrl);
  } catch {
    throw Object.assign(new Error("Invalid DeepLX URL"), { statusCode: 400 });
  }

  await validateOutboundUrl(url, {
    allowLocal: isDeeplxLocalUrlsEnabled(),
    allowedProtocols: ["https:", "http:"],
    flagName: "DEEPLX_LOCAL_URLS_ENABLED",
  }).catch((err) => {
    throw Object.assign(new Error(err instanceof Error ? err.message : "DeepLX URL is not allowed"), {
      statusCode: 400,
    });
  });

  const response = await safeFetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: input.text,
      source_lang: "auto",
      target_lang: input.targetLanguage.toUpperCase(),
    }),
    signal: AbortSignal.timeout(15_000),
    policy: {
      allowLocal: isDeeplxLocalUrlsEnabled(),
      allowedProtocols: ["https:", "http:"],
      flagName: "DEEPLX_LOCAL_URLS_ENABLED",
    },
    maxResponseBytes: 1024 * 1024,
  }).catch((err) => {
    if (err.name === "TimeoutError") throw Object.assign(new Error("DeepLX request timed out"), { statusCode: 502 });
    throw err;
  });

  if (!response.ok) {
    throw Object.assign(new Error(`DeepLX returned ${response.status}`), { statusCode: 502 });
  }

  const data = (await response.json()) as { data?: string; alternatives?: string[] };
  const translated = data.data || data.alternatives?.[0] || "";
  return { translatedText: translated };
}

// ── DeepL API Translation (official) ──
async function translateWithDeepL(input: z.infer<typeof translateSchema>) {
  if (!input.deeplApiKey) {
    throw Object.assign(new Error("DeepL API key is required"), { statusCode: 400 });
  }

  const isFree = input.deeplApiKey.endsWith(":fx");
  const apiUrl = isFree ? "https://api-free.deepl.com/v2/translate" : "https://api.deepl.com/v2/translate";

  const response = await safeFetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${input.deeplApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: [input.text],
      target_lang: input.targetLanguage.toUpperCase(),
    }),
    signal: AbortSignal.timeout(15_000),
    maxResponseBytes: 1024 * 1024,
  }).catch((err) => {
    if (err.name === "TimeoutError") throw Object.assign(new Error("DeepL request timed out"), { statusCode: 502 });
    throw err;
  });

  if (!response.ok) {
    throw Object.assign(new Error(`DeepL API returned ${response.status}`), { statusCode: 502 });
  }

  const data = (await response.json()) as { translations?: Array<{ text: string }> };
  return { translatedText: data.translations?.[0]?.text ?? "" };
}

// ── Google Translate (free API) ──
async function translateWithGoogle(input: z.infer<typeof translateSchema>) {
  if (input.text.length > GOOGLE_MAX_LENGTH) {
    throw Object.assign(
      new Error(
        `Text too long for Google Translate (max ${GOOGLE_MAX_LENGTH} characters). Use DeepL or AI provider for longer texts.`,
      ),
      { statusCode: 400 },
    );
  }

  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "auto");
  url.searchParams.set("tl", input.targetLanguage);
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", input.text);

  const response = await safeFetch(url.toString(), {
    signal: AbortSignal.timeout(15_000),
    maxResponseBytes: 1024 * 1024,
  }).catch((err) => {
    if (err.name === "TimeoutError")
      throw Object.assign(new Error("Google Translate request timed out"), { statusCode: 502 });
    throw err;
  });

  if (!response.ok) {
    throw Object.assign(new Error(`Google Translate returned ${response.status}`), { statusCode: 502 });
  }

  const data = (await response.json()) as unknown;

  // Google returns nested arrays: [[["translated text", "original text", ...], ...], ...]
  let translated = "";
  if (Array.isArray(data) && Array.isArray(data[0])) {
    for (const segment of data[0]) {
      if (Array.isArray(segment) && segment[0]) {
        translated += segment[0];
      }
    }
  }

  return { translatedText: translated };
}
