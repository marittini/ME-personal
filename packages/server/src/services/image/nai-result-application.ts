import { mkdirSync, readFileSync, writeFileSync, renameSync, linkSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { NaiImageDestination } from "@marinara-engine/shared";
import { buildChatImageGenerationRecord } from "@marinara-engine/shared";
import type { DB } from "../../db/connection.js";
import { and, eq } from "../../db/file-query.js";
import {
  chats,
  messages,
  messageSwipes,
  chatImages,
  characterImages,
  personaImages,
  characters,
  personas,
} from "../../db/schema/index.js";
import { DATA_DIR } from "../../utils/data-dir.js";
import { isAllowedImageBuffer, assertInsideDir } from "../../utils/security.js";
import { newId, now } from "../../utils/id-generator.js";
import { createCharactersStorage } from "../storage/characters.storage.js";
import { createChatsStorage, withMessageExtraPatchQueue } from "../storage/chats.storage.js";
import { withGalleryFileLifecycleLock, decodeSafePathSegment } from "./gallery-file-lifecycle.js";
import type { NaiJob } from "./nai-request-guard.js";

export function retainedPortraitHash(path: string): string | null {
  return existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null;
}
const conflict = () => new Error("NAI_DESTINATION_CONFLICT");

/** Capture the immutable swipe ID: an index can be reused after deleting a swipe. */
export async function captureNaiChatDestination(
  db: DB,
  chatId: string,
  messageId?: string | null,
  swipeIndex = 0,
  extra: {
    characterIds?: string[];
    personaIds?: string[];
    provider?: string;
    characterName?: string;
    roleplayCommandIndex?: number;
  } = {},
): Promise<Extract<NaiImageDestination, { kind: "chat" }>> {
  if (!messageId) return { kind: "chat", chatId, ...extra };
  const storage = createChatsStorage(db);
  const message = await storage.getMessage(messageId);
  const swipe = (await storage.getSwipes(messageId)).find((row) => row.index === swipeIndex);
  // Preserve ordinary callers that finish before their swipe is persisted; an
  // orphaned result with no captured row must remain a conflict on replay.
  return { kind: "chat", chatId, messageId, swipeId: message?.chatId === chatId ? swipe?.id : undefined, ...extra };
}

/** Freeze only references that existed when regeneration was requested. */
export async function captureNaiGalleryReplacement(
  db: DB,
  chatId: string,
  galleryId: string,
): Promise<Extract<NaiImageDestination, { kind: "chat" }>> {
  const storage = createChatsStorage(db);
  const rows = await storage.listMessages(chatId);
  const swipes = await storage.listSwipesByMessageIds(rows.map((row) => row.id));
  const hasImage = (raw: unknown) => {
    const extra = typeof raw === "string" ? JSON.parse(raw) : (raw ?? {});
    return (
      Array.isArray(extra.attachments) &&
      extra.attachments.some((item: Record<string, unknown>) => item?.galleryId === galleryId)
    );
  };
  return {
    kind: "chat",
    chatId,
    replacement: {
      galleryId,
      messages: rows
        .filter((row) => hasImage(row.extra))
        .map((row) => ({
          id: row.id,
          swipeIndex: row.activeSwipeIndex ?? 0,
          swipeId: swipes.find((swipe) => swipe.messageId === row.id && swipe.index === (row.activeSwipeIndex ?? 0))
            ?.id,
        })),
      swipes: swipes.filter((row) => hasImage(row.extra)).map((row) => ({ id: row.id, messageId: row.messageId })),
    },
  };
}

function replaceOnce(raw: unknown, oldId: string, patch: Record<string, unknown>) {
  const extra = typeof raw === "string" ? JSON.parse(raw) : (raw ?? {});
  if (
    !Array.isArray(extra.attachments) ||
    !extra.attachments.some((item: Record<string, unknown>) => item?.galleryId === oldId)
  )
    throw conflict();
  return JSON.stringify({
    ...extra,
    attachments: extra.attachments.map((item: Record<string, unknown>) =>
      item?.galleryId === oldId ? { ...item, ...patch } : item,
    ),
  });
}

function appendOnce(raw: unknown, attachment: Record<string, unknown>) {
  const extra = typeof raw === "string" ? JSON.parse(raw) : (raw ?? {});
  const attachments = Array.isArray(extra.attachments) ? extra.attachments : [];
  if (attachments.some((item: Record<string, unknown>) => item?.naiJobId === attachment.naiJobId))
    return JSON.stringify(extra);
  return JSON.stringify({ ...extra, attachments: [...attachments, attachment] });
}

/** Apply only saved bytes. Stable paths/IDs and one DB transaction make retry after a crash idempotent. */
export function createNaiResultApplier(db: DB) {
  return async (job: NaiJob, resultFile: string) => {
    const destination = job.request.naiDestination;
    if (!destination) return;
    const bytes = readFileSync(resultFile);
    const image = isAllowedImageBuffer(bytes);
    if (!image || !/^[a-f0-9-]{36}$/.test(job.id)) throw new Error("Invalid retained image");
    const filename = `nai-${job.id}.${image.ext}`;
    const write = (directory: string) => {
      mkdirSync(directory, { recursive: true });
      const path = join(directory, filename);
      try {
        linkSync(resultFile, `${path}.tmp`);
      } catch {
        writeFileSync(`${path}.tmp`, bytes, { mode: 0o600 });
      }
      renameSync(`${path}.tmp`, path);
    };
    if (destination.kind === "npc") {
      if (
        decodeSafePathSegment(destination.chatId) !== destination.chatId ||
        decodeSafePathSegment(destination.safeName) !== destination.safeName
      )
        throw conflict();
      if (!(await db.select().from(chats).where(eq(chats.id, destination.chatId)))[0]) throw conflict();
      const root = join(DATA_DIR, "avatars", "npc");
      const directory = assertInsideDir(root, join(root, destination.chatId));
      const path = assertInsideDir(directory, join(directory, `${destination.safeName}.png`));
      const currentHash = retainedPortraitHash(path);
      const resultHash = createHash("sha256").update(bytes).digest("hex");
      if (currentHash === resultHash) return;
      if (currentHash !== destination.expectedHash) throw conflict();
      // Comparison and atomic replacement are synchronous: another upload cannot
      // interleave between them. Keep the established portrait URL and sniffed MIME.
      mkdirSync(directory, { recursive: true });
      writeFileSync(`${path}.tmp`, bytes, { mode: 0o600 });
      renameSync(`${path}.tmp`, path);
      return;
    }
    if (destination.kind === "profile") {
      const storage = createCharactersStorage(db);
      write(join(DATA_DIR, "avatars"));
      const path = `/api/avatars/file/${filename}`;
      const result =
        destination.entity === "character"
          ? await storage.updateAvatar(destination.id, path, destination.expectedAvatarPath)
          : await storage.updatePersona(
              destination.id,
              { avatarPath: path },
              {
                expectedAvatarPath: destination.expectedAvatarPath,
                versionSource: "nai-resume",
                versionReason: "Resumed image generation",
              },
            );
      if (!result) throw conflict();
      return;
    }
    const filePath = `shared/${filename}`;
    const apply = () =>
      withGalleryFileLifecycleLock(filePath, async () => {
        write(join(DATA_DIR, "gallery", "shared"));
        await db.transaction(async (tx) => {
          // The gallery ID is the durable application receipt. Never append an attachment twice.
          const receipt = (
            await tx
              .select()
              .from(chatImages)
              .where(and(eq(chatImages.chatId, destination.chatId), eq(chatImages.id, job.id)))
          )[0];
          if (receipt) return;
          if (!(await tx.select().from(chats).where(eq(chats.id, destination.chatId)))[0]) throw conflict();
          const message = destination.messageId
            ? (await tx.select().from(messages).where(eq(messages.id, destination.messageId)))[0]
            : null;
          const swipe =
            destination.swipeId && destination.messageId
              ? (
                  await tx
                    .select()
                    .from(messageSwipes)
                    .where(
                      and(
                        eq(messageSwipes.messageId, destination.messageId),
                        eq(messageSwipes.id, destination.swipeId),
                      ),
                    )
                )[0]
              : null;
          if (destination.messageId && (!message || message.chatId !== destination.chatId || !swipe)) throw conflict();
          const request = job.request;
          await tx.insert(chatImages).values({
            id: job.id,
            chatId: destination.chatId,
            filePath,
            prompt: request.prompt,
            provider: destination.provider ?? "image_generation",
            model: request.model ?? "unknown",
            width: request.width ?? null,
            height: request.height ?? null,
            createdAt: now(),
            generation: JSON.stringify(
              destination.generation ??
                buildChatImageGenerationRecord({
                  prompt: request.prompt,
                  connectionId: job.connectionId,
                  negativePrompt: request.negativePrompt,
                  characterPrompts: request.characterPrompts,
                }),
            ),
          });
          // Entity memberships are committed with the chat image, so partial retries
          // cannot duplicate entries or lose the original auto-save selection.
          const metadata = {
            sourceChatImageId: job.id,
            filePath,
            prompt: request.prompt,
            provider: destination.provider ?? "image_generation",
            model: request.model ?? "unknown",
            width: request.width ?? null,
            height: request.height ?? null,
            createdAt: now(),
          };
          for (const id of new Set(destination.characterIds ?? [])) {
            if ((await tx.select().from(characters).where(eq(characters.id, id)))[0])
              await tx.insert(characterImages).values({ id: newId(), characterId: id, ...metadata });
          }
          for (const id of new Set(destination.personaIds ?? [])) {
            if ((await tx.select().from(personas).where(eq(personas.id, id)))[0])
              await tx.insert(personaImages).values({ id: newId(), personaId: id, ...metadata });
          }
          if (destination.replacement) {
            const replacement = destination.replacement;
            if (
              !(
                await tx
                  .select()
                  .from(chatImages)
                  .where(and(eq(chatImages.chatId, destination.chatId), eq(chatImages.id, replacement.galleryId)))
              )[0]
            )
              throw conflict();
            const patch = {
              url: `/api/gallery/file/${destination.chatId}/${filename}`,
              prompt: request.prompt,
              galleryId: job.id,
              naiJobId: job.id,
            };
            for (const { id, swipeIndex, swipeId } of replacement.messages) {
              const row = (await tx.select().from(messages).where(eq(messages.id, id)))[0];
              if (!row || row.chatId !== destination.chatId) throw conflict();
              // A user may have opened another swipe after requesting regeneration.
              // Only the original swipe gets replaced; leave its current mirror alone.
              const originalSwipe = swipeId
                ? (
                    await tx
                      .select()
                      .from(messageSwipes)
                      .where(and(eq(messageSwipes.messageId, id), eq(messageSwipes.id, swipeId)))
                  )[0]
                : null;
              if (swipeId && !originalSwipe) throw conflict();
              if ((row.activeSwipeIndex ?? 0) !== (originalSwipe?.index ?? swipeIndex)) continue;
              await tx
                .update(messages)
                .set({ extra: replaceOnce(row.extra, replacement.galleryId, patch) })
                .where(eq(messages.id, id));
            }
            for (const { id, messageId } of replacement.swipes) {
              const row = (
                await tx
                  .select()
                  .from(messageSwipes)
                  .where(and(eq(messageSwipes.messageId, messageId), eq(messageSwipes.id, id)))
              )[0];
              if (!row) throw conflict();
              const parent = (await tx.select().from(messages).where(eq(messages.id, row.messageId)))[0];
              if (!parent || parent.chatId !== destination.chatId) throw conflict();
              await tx
                .update(messageSwipes)
                .set({ extra: replaceOnce(row.extra, replacement.galleryId, patch) })
                .where(and(eq(messageSwipes.messageId, row.messageId), eq(messageSwipes.id, id)));
            }
          }
          if (message && swipe) {
            const attachment = {
              type: "image",
              url: `/api/gallery/file/${destination.chatId}/${filename}`,
              filename,
              prompt: request.prompt,
              galleryId: job.id,
              naiJobId: job.id,
              ...(destination.characterName ? { characterName: destination.characterName } : {}),
              ...(destination.roleplayCommandIndex !== undefined
                ? { roleplayCommandIndex: destination.roleplayCommandIndex }
                : {}),
            };
            await tx
              .update(messageSwipes)
              .set({ extra: appendOnce(swipe.extra, attachment) })
              .where(and(eq(messageSwipes.messageId, message.id), eq(messageSwipes.id, swipe.id)));
            if ((message.activeSwipeIndex ?? 0) === swipe.index)
              await tx
                .update(messages)
                .set({ extra: appendOnce(message.extra, attachment) })
                .where(eq(messages.id, message.id));
          }
        });
      });
    const ids = [
      ...new Set([
        ...(destination.replacement?.messages.map((row) => row.id) ?? []),
        ...(destination.replacement?.swipes.map((row) => row.messageId) ?? []),
        ...(destination.messageId ? [destination.messageId] : []),
      ]),
    ].sort();
    const locked = (index: number): Promise<void> =>
      index === ids.length ? apply() : withMessageExtraPatchQueue(ids[index]!, () => locked(index + 1));
    await locked(0);
  };
}
