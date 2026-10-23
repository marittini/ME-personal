import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  committedMemoryStatus,
  editCommittedMemory,
  committedMemoryConnectionStatus,
  setCommittedMemoryEnabled,
  startCommittedMemory,
  committedMemoryForPrompt,
  resetCommittedMemory,
  cancelCommittedMemory,
  configureCommittedMemory,
  enrichCommittedMemory,
  rebuildCommittedMemoryIndex,
  undoCommittedMemory,
  organizeCommittedMemoryChat,
  mergeCommittedMemoryEntities,
  confirmDistinctCommittedMemoryEntity,
} from "../services/committed-memory.js";
import { createChatsStorage } from "../services/storage/chats.storage.js";
export async function registerCommittedMemoryRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>("/:id/committed-memory", async (req, reply) => {
    if (!(await createChatsStorage(app.db).getById(req.params.id)))
      return reply.status(404).send({ error: "Chat not found" });
    return committedMemoryStatus(app.db, req.params.id);
  });
  app.post<{ Params: { id: string } }>("/:id/committed-memory/commit", async (req, reply) => {
    const body = z
      .object({
        debugMode: z.boolean().optional(),
        batchSize: z.number().int().min(1).max(500).optional(),
        sourceMode: z.enum(["pending", "last", "range"]).optional(),
        contextSize: z.number().int().min(5).max(500).optional(),
        rangeStartIndex: z.number().int().min(1).optional(),
        rangeEndIndex: z.number().int().min(1).optional(),
      })
      .strict()
      .safeParse(req.body ?? {});
    if (!body.success) return reply.status(400).send({ error: "Invalid request" });
    if ((app as unknown as { activeGenerations?: Map<string, unknown> }).activeGenerations?.has(req.params.id))
      return reply.status(409).send({ error: "Wait for the reply to finish before committing memory" });
    return startCommittedMemory(app.db, req.params.id, body.data.debugMode, body.data);
  });
  app.post<{ Params: { id: string } }>("/:id/committed-memory/reset", async (req, reply) => {
    if (
      !z
        .object({ confirm: z.literal(true) })
        .strict()
        .safeParse(req.body).success
    )
      return reply.status(400).send({ error: "Reset confirmation required" });
    if ((app as unknown as { activeGenerations?: Map<string, unknown> }).activeGenerations?.has(req.params.id))
      return reply.status(409).send({ error: "Wait for generation to finish before resetting memory" });
    return resetCommittedMemory(app.db, req.params.id);
  });
  app.post<{ Params: { id: string } }>("/:id/committed-memory/cancel", (req) =>
    cancelCommittedMemory(app.db, req.params.id),
  );
  app.post<{ Params: { id: string } }>("/:id/committed-memory/enrich", (req) =>
    enrichCommittedMemory(app.db, req.params.id),
  );
  app.post<{ Params: { id: string } }>("/:id/committed-memory/rebuild", (req) =>
    rebuildCommittedMemoryIndex(app.db, req.params.id),
  );
  app.get<{ Params: { id: string } }>("/:id/committed-memory/export", async (req, reply) => {
    const status = await committedMemoryStatus(app.db, req.params.id);
    return reply
      .header("Content-Disposition", 'attachment; filename="memory-backup.json"')
      .send({ exportedAt: new Date().toISOString(), state: status.state });
  });
  app.patch<{ Params: { id: string } }>("/:id/committed-memory/config", async (req, reply) => {
    const body = z
      .object({
        tokenBudget: z.number().int().min(256).max(32000).optional(),
        alwaysTokens: z.number().int().min(0).max(32000).optional(),
        recallLimit: z.number().int().min(0).max(100).optional(),
        recentMessages: z.number().int().min(0).max(1000).optional(),
        longTermMessages: z.number().int().min(0).max(10000).optional(),
        topK: z.number().int().min(1).max(100).optional(),
        semanticEnabled: z.boolean().optional(),
      })
      .strict()
      .safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: "Invalid memory configuration" });
    return configureCommittedMemory(app.db, req.params.id, body.data);
  });
  app.patch<{ Params: { id: string } }>("/:id/committed-memory", async (req, reply) => {
    const body = z.object({ enabled: z.boolean() }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: "Invalid request" });
    await setCommittedMemoryEnabled(app.db, req.params.id, body.data.enabled);
    return committedMemoryStatus(app.db, req.params.id);
  });
  app.get<{ Params: { id: string }; Querystring: { query?: string } }>(
    "/:id/committed-memory/preview",
    async (req, reply) => {
      const query = z
        .string()
        .max(12000)
        .safeParse(req.query.query ?? "");
      if (!query.success) return reply.status(400).send({ error: "Query too long" });
      return (
        (await committedMemoryForPrompt(app.db, req.params.id, query.data)) ?? {
          selected: [],
          text: "",
          usedBytes: 0,
          budgetBytes: 8000,
        }
      );
    },
  );
  app.get<{ Params: { id: string } }>("/:id/committed-memory/connection", (req) =>
    committedMemoryConnectionStatus(app.db, req.params.id),
  );
  app.patch<{ Params: { id: string } }>("/:id/committed-memory/record", async (req, reply) => {
    const body = z
      .object({
        batchId: z.string().min(1),
        factId: z.string().min(1).optional(),
        expectedRevision: z.string().min(1),
        content: z.string().trim().min(1).max(1500).optional(),
        summary: z.string().trim().max(12000).optional(),
        core: z.string().trim().max(2500).optional(),
        excluded: z.boolean().optional(),
        status: z.enum(["current", "resolved", "uncertain"]).optional(),
        progress: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
        activation: z.enum(["always", "recall"]).optional(),
        keywords: z.array(z.string().trim().min(1).max(100)).max(24).optional(),
        combos: z
          .array(z.array(z.string().trim().min(1).max(100)).min(1).max(6))
          .max(12)
          .optional(),
      })
      .strict()
      .safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: "Invalid request" });
    return editCommittedMemory(app.db, req.params.id, body.data);
  });
  const busy = (id: string) =>
    (app as unknown as { activeGenerations?: Map<string, unknown> }).activeGenerations?.has(id) ?? false;
  app.post<{ Params: { id: string } }>("/:id/committed-memory/undo", async (req, reply) => {
    const body = z
      .object({ commitId: z.string().min(1) })
      .strict()
      .safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: "Invalid request" });
    if (busy(req.params.id)) return reply.status(409).send({ error: "Wait for the reply to finish first" });
    return undoCommittedMemory(app.db, req.params.id, body.data.commitId);
  });
  app.post<{ Params: { id: string } }>("/:id/committed-memory/organize", async (req, reply) => {
    if (busy(req.params.id)) return reply.status(409).send({ error: "Wait for the reply to finish first" });
    return organizeCommittedMemoryChat(app.db, req.params.id);
  });
  app.post<{ Params: { id: string } }>("/:id/committed-memory/entities/merge", async (req, reply) => {
    const body = z
      .object({ fromId: z.string().min(1), intoId: z.string().min(1) })
      .strict()
      .safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: "Invalid request" });
    if (busy(req.params.id)) return reply.status(409).send({ error: "Wait for the reply to finish first" });
    return mergeCommittedMemoryEntities(app.db, req.params.id, body.data.fromId, body.data.intoId);
  });
  app.post<{ Params: { id: string } }>("/:id/committed-memory/entities/distinct", async (req, reply) => {
    const body = z
      .object({ entityId: z.string().min(1) })
      .strict()
      .safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: "Invalid request" });
    return confirmDistinctCommittedMemoryEntity(app.db, req.params.id, body.data.entityId);
  });
  app.get<{ Params: { id: string; messageId: string } }>(
    "/:id/committed-memory/source/:messageId",
    async (req, reply) => {
      const m = await createChatsStorage(app.db).getMessage(req.params.messageId);
      if (!m || m.chatId !== req.params.id) return reply.status(404).send({ error: "Source message not found" });
      return { id: m.id, content: m.content, activeSwipeIndex: m.activeSwipeIndex };
    },
  );
}
