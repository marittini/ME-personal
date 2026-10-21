import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { DATA_DIR } from "../utils/data-dir.js";
import { isAllowedImageBuffer } from "../utils/security.js";
import { logger } from "../lib/logger.js";
import { createConnectionsStorage } from "../services/storage/connections.storage.js";
import { generateImage } from "../services/image/image-generation.js";
import { NaiRequestGuard, naiAccountGroup, setNaiRequestGuard } from "../services/image/nai-request-guard.js";
import { createNaiResultApplier } from "../services/image/nai-result-application.js";
import { migrateStoredPngs } from "../services/image/webp-storage.js";
const selection = z.object({
  items: z
    .array(z.object({ id: z.string().uuid(), revision: z.number().int().positive() }))
    .min(1)
    .max(200),
});
const groupInput = z.object({ groupId: z.string().regex(/^[a-f0-9]{64}$/) });
export async function naiRequestGuardRoutes(app: FastifyInstance) {
  const connections = createConnectionsStorage(app.db);
  const directory = join(DATA_DIR, "image-jobs");
  const guard = new NaiRequestGuard({
    directory,
    apply: createNaiResultApplier(app.db),
    identify: naiAccountGroup,
    connectionForKey: async (key) => {
      for (const row of await connections.list())
        if ((await connections.getWithKey(row.id))?.apiKey === key) return row.id;
      return null;
    },
    keyForConnection: async (id) => (await connections.getWithKey(id))?.apiKey ?? null,
    replay: (job, key, signal) =>
      generateImage(job.source, job.baseUrl, key, job.serviceHint, { ...job.request, signal }),
  });
  setNaiRequestGuard(guard);
  app.addHook("onReady", () => guard.recoverApplications());
  app.addHook("onClose", async () => {
    guard.close();
    setNaiRequestGuard(undefined);
  });
  app.get("/", (req) =>
    guard.list(z.object({ offset: z.coerce.number().int().min(0).default(0) }).parse(req.query).offset),
  );
  app.get<{ Params: { id: string } }>(
    "/jobs/:id",
    (req, reply) => guard.detail(req.params.id) ?? reply.status(404).send({ error: "Job not found" }),
  );
  app.get<{ Params: { id: string } }>("/jobs/:id/result", async (req, reply) => {
    const job = guard.detail(req.params.id);
    if (!job?.resultPath) return reply.status(404).send({ error: "Result not found" });
    const buffer = await readFile(join(directory, job.resultPath));
    const image = isAllowedImageBuffer(buffer);
    if (!image) return reply.status(404).send({ error: "Result not found" });
    return reply
      .header("Content-Disposition", `attachment; filename="${job.resultPath}"`)
      .type(image.mimeType)
      .send(buffer);
  });
  app.post("/run", (req, reply) => {
    try {
      if (req.body && typeof req.body === "object" && "all" in req.body && req.body.all === true) guard.runAll();
      else guard.run(selection.parse(req.body).items);
      return guard.list();
    } catch (error) {
      return reply.status(409).send({ error: error instanceof Error ? error.message : "Queue changed" });
    }
  });
  app.post("/retry-conversion", async (req, reply) => {
    try {
      const item = selection.parse(req.body).items;
      if (item.length !== 1 || !item[0]) return reply.status(400).send({ error: "Select one saved result" });
      await guard.retryConversion(item[0].id, item[0].revision);
      return guard.list();
    } catch (error) {
      return reply.status(409).send({ error: error instanceof Error ? error.message : "Conversion failed" });
    }
  });
  app.post("/retry-application", async (req, reply) => {
    try {
      const items = selection.parse(req.body).items;
      if (items.length !== 1 || !items[0]) return reply.status(400).send({ error: "Select one saved result" });
      await guard.retryApplication(items[0].id, items[0].revision);
      return guard.list();
    } catch (error) {
      return reply.status(409).send({ error: error instanceof Error ? error.message : "Application failed" });
    }
  });
  app.post("/cancel", (req) => {
    guard.cancel(selection.parse(req.body).items);
    return guard.list();
  });
  app.post("/hold", (req) => {
    guard.hold(groupInput.parse(req.body).groupId);
    return guard.list();
  });
  app.post("/automatic", (req, reply) => {
    try {
      guard.automatic(groupInput.parse(req.body).groupId);
      return guard.list();
    } catch (error) {
      return reply.status(409).send({ error: error instanceof Error ? error.message : "Queue changed" });
    }
  });
  let closing = false;
  let migration: Promise<Awaited<ReturnType<typeof migrateStoredPngs>>> | undefined;
  const marker = join(directory, "webp-migration-v1.json");
  const convert = () => {
    migration ??= migrateStoredPngs(DATA_DIR)
      .then(async (result) => {
        await writeFile(marker, JSON.stringify(result), { mode: 0o600 });
        logger.info(result, "[webp] Existing image conversion finished");
        return result;
      })
      .finally(() => {
        migration = undefined;
      });
    return migration;
  };
  app.addHook("onReady", async () => {
    if (!existsSync(marker))
      setImmediate(() => {
        if (closing) return;
        void convert().catch((error) => logger.warn(error, "[webp] Original files retained after migration error"));
      });
  });
  app.addHook("onClose", async () => {
    closing = true;
    await migration;
  });
  app.post("/convert-pngs", convert);
}
