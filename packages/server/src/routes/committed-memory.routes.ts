import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  committedMemoryStatus,
  setCommittedMemoryEnabled,
  startCommittedMemory,
  committedMemoryForPrompt,
} from "../services/committed-memory.js";
import { createChatsStorage } from "../services/storage/chats.storage.js";
export async function registerCommittedMemoryRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>("/:id/committed-memory", async (req, reply) => {
    if (!(await createChatsStorage(app.db).getById(req.params.id)))
      return reply.status(404).send({ error: "Chat not found" });
    return committedMemoryStatus(app.db, req.params.id);
  });
  app.post<{ Params: { id: string } }>("/:id/committed-memory/commit", async (req, reply) => {
    const body = z.object({ debugMode: z.boolean().optional() }).safeParse(req.body ?? {});
    if (!body.success) return reply.status(400).send({ error: "Invalid request" });
    if ((app as unknown as { activeGenerations?: Map<string, unknown> }).activeGenerations?.has(req.params.id))
      return reply.status(409).send({ error: "Wait for the reply to finish before committing memory" });
    return startCommittedMemory(app.db, req.params.id, body.data.debugMode);
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
  app.get<{ Params: { id: string; messageId: string } }>(
    "/:id/committed-memory/source/:messageId",
    async (req, reply) => {
      const m = await createChatsStorage(app.db).getMessage(req.params.messageId);
      if (!m || m.chatId !== req.params.id) return reply.status(404).send({ error: "Source message not found" });
      return { id: m.id, content: m.content, activeSwipeIndex: m.activeSwipeIndex };
    },
  );
}
