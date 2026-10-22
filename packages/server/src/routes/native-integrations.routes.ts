import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { nativeIntegrationsSchema, weatherLocationSchema } from "@marinara-engine/shared";
import {
  readNativeIntegrations,
  saveNativeIntegrations,
  getIntegratedWeather,
  resolveIntegratedPreset,
  mutateNativeIntegrations,
} from "../services/native-integrations.js";
import weatherCore from "../assets/convo-weather-core.mjs";
import { safeFetch } from "../utils/security.js";
import { createChatsStorage } from "../services/storage/chats.storage.js";
import { vaultExists, operateKeyVault } from "../services/connection-key-vault.js";
import { readNovelAiMetadata } from "../services/image/novelai-metadata-import.js";
import { extractTranslationGlossary } from "../services/translation.service.js";

export async function nativeIntegrationsRoutes(app: FastifyInstance) {
  app.get("/vault", () => vaultExists(app.db));
  app.post("/vault", (req) => operateKeyVault(app.db, req.body));
  app.post("/translation/extract", (req) => extractTranslationGlossary(app.db, req.body));
  app.post("/translation/paragraphs", async (req, reply) => {
    const input = z
      .object({
        chatId: z.string().min(1),
        messageId: z.string().min(1),
        swipeIndex: z.number().int().nonnegative(),
        source: z.string().max(50000),
        paragraphs: z.array(z.string().min(1).max(50000)).min(1).max(500),
      })
      .parse(req.body);
    const storage = createChatsStorage(app.db);
    const message = await storage.getMessage(input.messageId);
    if (!message || message.chatId !== input.chatId || input.source.split(/\n{2,}/).length !== input.paragraphs.length)
      return reply.status(409).send({ error: "Translation source changed" });
    const translation = input.paragraphs.join("\n\n");
    if (translation.length > 100000) return reply.status(400).send({ error: "Translation too large" });
    const result = await storage.updateMessageExtraForSwipe(
      input.messageId,
      input.swipeIndex,
      { translation, translationSource: input.source, translationHidden: false },
      input.source,
    );
    if (!result) return reply.status(409).send({ error: "Translation source changed" });
    return result;
  });
  app.post("/nai-metadata", async (req, reply) => {
    const file = await req.file({ limits: { fileSize: 32 * 1024 * 1024 } });
    if (!file) return reply.status(400).send({ error: "No image uploaded" });
    return readNovelAiMetadata(await file.toBuffer());
  });
  app.get("/settings", () => readNativeIntegrations(app.db));
  app.put("/settings", async (req) => saveNativeIntegrations(app.db, nativeIntegrationsSchema.parse(req.body)));
  app.get("/weather/places", async (req) => {
    const { query, worldwide } = z
      .object({ query: z.string().max(100).default(""), worldwide: z.string().optional() })
      .parse(req.query);
    if (!query.trim()) return weatherCore.PRESET_CITIES;
    const response = await safeFetch(weatherCore.buildGeocodingURL(query, worldwide !== "true"), {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Place search ${response.status}`);
    return weatherCore.normalizePlaces(await response.json());
  });
  app.post("/weather/preview", async (req) => ({
    summary: weatherCore.formatSummary(await getIntegratedWeather(weatherLocationSchema.parse(req.body))),
  }));
  app.post("/presets/apply", async (req) => {
    const { chatIds } = z.object({ chatIds: z.array(z.string().min(1)).min(1).max(1000) }).parse(req.body);
    const { result } = await mutateNativeIntegrations(app.db, async (config) => {
      const storage = createChatsStorage(app.db);
      const changes: typeof config.globalPreset.history = [];
      for (const chatId of [...new Set(chatIds)]) {
        const chat = await storage.getById(chatId);
        if (!chat || !config.globalPreset.modes.includes(chat.mode as "roleplay" | "conversation")) continue;
        // Bulk selection is explicit consent to follow; fixed/none room policies survive.
        config.globalPreset.rooms[chatId] ??= { mode: "follow", presetId: null, presetName: "" };
        const next = await resolveIntegratedPreset(app.db, chat, config);
        if (next === chat.promptPresetId) continue;
        await storage.update(chatId, { promptPresetId: next });
        changes.push({
          time: new Date().toISOString(),
          chatId,
          from: chat.promptPresetId ?? null,
          to: next,
          reason: "apply",
        });
      }
      config.globalPreset.history = [...changes, ...config.globalPreset.history].slice(0, 300);
      return { settings: config, result: { changed: changes.length } };
    });
    return result;
  });
}
