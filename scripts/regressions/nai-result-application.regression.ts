import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { syncBuiltinESMExports } from "node:module";
const directory = mkdtempSync(join(os.tmpdir(), "nai-apply-"));
process.env.DATA_DIR = directory;
process.env.FILE_STORAGE_DIR = join(directory, "storage");
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
const originalInterfaces = os.networkInterfaces;
os.networkInterfaces = () => ({});
syncBuiltinESMExports();
const { NaiRequestGuard, NaiGuardError, NaiOutputConversionError, setNaiRequestGuard } =
  await import("../../packages/server/src/services/image/nai-request-guard.js");
const { createNaiResultApplier, captureNaiChatDestination, captureNaiGalleryReplacement } =
  await import("../../packages/server/src/services/image/nai-result-application.js");
const { getDB, closeDB } = await import("../../packages/server/src/db/connection.js");
const { createChatsStorage } = await import("../../packages/server/src/services/storage/chats.storage.js");
const { createCharactersStorage } = await import("../../packages/server/src/services/storage/characters.storage.js");
const { createGalleryStorage } = await import("../../packages/server/src/services/storage/gallery.storage.js");
const { getSharp } = await import("../../packages/server/src/services/image/sharp-runtime.js");
const { characterDataSchema } = await import("../../packages/shared/src/index.js");
const db = await getDB();
const { default: Fastify } = await import("../../packages/server/node_modules/fastify/fastify.js");
const { galleryRoutes } = await import("../../packages/server/src/routes/gallery.routes.js");
const { avatarsRoutes } = await import("../../packages/server/src/routes/avatars.routes.js");
const app = Fastify();
app.decorate("db", db);
await app.register(galleryRoutes, { prefix: "/api/gallery" });
await app.register(avatarsRoutes, { prefix: "/api/avatars" });

const chats = createChatsStorage(db);
const profiles = createCharactersStorage(db);
const gallery = createGalleryStorage(db);
const { createCharacterGalleryStorage } =
  await import("../../packages/server/src/services/storage/character-gallery.storage.js");
const { createPersonaGalleryStorage } =
  await import("../../packages/server/src/services/storage/persona-gallery.storage.js");
const apply = createNaiResultApplier(db);
let guard: InstanceType<typeof NaiRequestGuard>;
let sends = 0;
let failApply = false;
let failConversion = false;
const attachments = (row: { extra: unknown } | null | undefined) =>
  JSON.parse(String(row?.extra ?? "{}")).attachments ?? [];
const until = async (predicate: () => boolean) => {
  for (let i = 0; i < 400; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Worker timed out");
};
try {
  const sharp = await getSharp();
  const png = await sharp({ create: { width: 12, height: 10, channels: 4, background: "#336699" } })
    .png()
    .toBuffer();
  const webp = await sharp(png).webp({ lossless: true }).toBuffer();
  const result = { base64: webp.toString("base64"), ext: "webp", mimeType: "image/webp" };
  const options = {
    directory: join(directory, "queue"),
    identify: (key: string) => key,
    connectionForKey: async () => "connection",
    keyForConnection: async () => "account",
    delay: () => 0,
    replay: async () => {
      sends++;
      if (failConversion)
        throw new NaiOutputConversionError({ base64: png.toString("base64"), ext: "png", mimeType: "image/png" });
      return result;
    },
    apply: async (...args: Parameters<typeof apply>) => {
      if (failApply) throw new Error("Fixture disk unavailable");
      await apply(...args);
    },
  };
  guard = new NaiRequestGuard(options);
  guard.hold("account");
  const hold = async (naiDestination: import("../../packages/shared/src/index.js").NaiImageDestination) => {
    let id = "";
    try {
      await guard.submit({
        source: "novelai",
        baseUrl: "https://image.novelai.net",
        serviceHint: "novelai",
        apiKey: "account",
        request: { prompt: "resume proof", model: "nai-diffusion-4-5-full", naiDestination },
        task: async () => {
          throw new Error("Orphaned live callback must never run");
        },
      });
    } catch (error) {
      assert.ok(error instanceof NaiGuardError);
      id = error.jobId;
    }
    assert.ok(id);
    return guard.detail(id)!;
  };
  const run = async (job: ReturnType<typeof guard.detail> & {}) => {
    guard.run([{ id: job.id, revision: job.revision }]);
    await until(() => !["QUEUED", "RUNNING", "APPLYING"].includes(job.state));
  };
  const chat = await chats.create({ name: "Original", mode: "roleplay", characterIds: [] });
  assert.ok(chat);
  const message = await chats.createMessage({ chatId: chat.id, role: "assistant", content: "Original reply" });
  assert.ok(message);
  const character = await profiles.create(characterDataSchema.parse({ name: "Character" }));
  const persona = await profiles.createPersona("Persona", "description");
  assert.ok(character && persona);
  const npc = await hold({ kind: "npc", chatId: chat.id, safeName: "npc-proof", expectedHash: null });
  await run(npc);
  assert.equal(npc.state, "SUCCEEDED");
  assert.deepEqual(readFileSync(join(directory, "avatars", "npc", chat.id, "npc-proof.png")), webp);
  const npcConflict = await hold({ kind: "npc", chatId: chat.id, safeName: "new-npc", expectedHash: null });
  const npcPath = join(directory, "avatars", "npc", chat.id, "new-npc.png");
  mkdirSync(join(directory, "avatars", "npc", chat.id), { recursive: true });
  writeFileSync(npcPath, png);
  await run(npcConflict);
  assert.equal(npcConflict.state, "CONFLICT");
  assert.deepEqual(readFileSync(npcPath), png);
  const destination = await captureNaiChatDestination(db, chat.id, message.id, 0, {
    characterIds: [character.id],
    personaIds: [persona.id],
  });
  const chatJob = await hold(destination);
  // User opens a different swipe while held. The saved original must receive the image.
  await chats.addSwipe(message.id, "Different reply");
  await run(chatJob);
  assert.equal(chatJob.state, "SUCCEEDED");
  assert.ok(chatJob.appliedAt);
  assert.equal(
    attachments(await chats.getMessage(message.id)).length,
    0,
    "inactive result cannot leak into active swipe",
  );
  let swipes = await chats.getSwipes(message.id);
  assert.equal(attachments(swipes[0]).length, 1);
  const served = await app.inject({ method: "GET", url: attachments(swipes[0])[0].url });
  assert.equal(served.statusCode, 200, served.body);
  assert.match(String(served.headers["content-type"]), /image\/webp/);
  assert.deepEqual(served.rawPayload, webp, "the original chat URL must serve the retained result");

  assert.equal(attachments(swipes[1]).length, 0);
  await apply(chatJob, join(options.directory, chatJob.resultPath!));
  assert.equal((await gallery.listByChatId(chat.id)).length, 1, "duplicate apply uses gallery receipt");
  assert.equal(attachments((await chats.getSwipes(message.id))[0]).length, 1);
  await chats.setActiveSwipe(message.id, 0);
  assert.equal(attachments(await chats.getMessage(message.id)).length, 1, "switching back restores saved image");
  // Simulate crash after DB commit, before queue receipt: startup retries only local apply.
  guard.close();
  const snapshot = JSON.parse(readFileSync(join(options.directory, "queue.json"), "utf8"));
  snapshot.jobs.find((job: { id: string }) => job.id === chatJob.id).state = "APPLYING";
  writeFileSync(join(options.directory, "queue.json"), JSON.stringify(snapshot));
  guard = new NaiRequestGuard(options);
  const beforeRecovery = sends;
  await guard.recoverApplications();
  assert.equal(sends, beforeRecovery);
  assert.equal(attachments((await chats.getSwipes(message.id))[0]).length, 1);
  assert.equal((await gallery.listByChatId(chat.id)).length, 1);
  assert.equal((await createCharacterGalleryStorage(db).listByCharacterId(character.id)).length, 1);
  assert.equal((await createPersonaGalleryStorage(db).listByPersonaId(persona.id)).length, 1);
  // Deleted swipe and index reuse must conflict, preserving both new swipe and result.
  const deleted = await hold(await captureNaiChatDestination(db, chat.id, message.id, 1));
  await chats.removeSwipe(message.id, 1);
  await chats.addSwipe(message.id, "Reused index");
  await run(deleted);
  assert.equal(deleted.state, "CONFLICT");
  assert.ok(deleted.resultPath);
  assert.equal((await gallery.listByChatId(chat.id)).length, 1, "conflict rolls metadata back");
  // Both kinds of saved profiles apply once, retain version history, and never overwrite newer avatars.
  for (const [entity, row] of [
    ["character", character],
    ["persona", persona],
  ] as const) {
    const job = await hold({ kind: "profile", entity, id: row.id, expectedAvatarPath: row.avatarPath ?? null });
    await run(job);
    assert.equal(job.state, "SUCCEEDED");
    const get = () => (entity === "character" ? profiles.getById(row.id) : profiles.getPersona(row.id));
    const applied = (await get())!;
    assert.match(applied.avatarPath!, new RegExp(job.id));
    const servedAvatar = await app.inject({ method: "GET", url: applied.avatarPath! });
    assert.equal(servedAvatar.statusCode, 200, servedAvatar.body);
    assert.deepEqual(servedAvatar.rawPayload, webp);

    const versions =
      entity === "character" ? await profiles.listVersions(row.id) : await profiles.listPersonaVersions(row.id);
    await apply(job, join(options.directory, job.resultPath!));
    const again =
      entity === "character" ? await profiles.listVersions(row.id) : await profiles.listPersonaVersions(row.id);
    assert.equal(versions.length, again.length, "recovery cannot add a duplicate version");
    const conflicting = await hold({ kind: "profile", entity, id: row.id, expectedAvatarPath: applied.avatarPath });
    if (entity === "character") await profiles.updateAvatar(row.id, "/new-upload.webp");
    else await profiles.updatePersona(row.id, { avatarPath: "/new-upload.webp" });
    await run(conflicting);
    assert.equal(conflicting.state, "CONFLICT");
    assert.equal((await get())?.avatarPath, "/new-upload.webp");
  }
  const removedProfile = await profiles.createPersona("Deleted profile", "proof");
  assert.ok(removedProfile);
  const missingProfile = await hold({
    kind: "profile",
    entity: "persona",
    id: removedProfile.id,
    expectedAvatarPath: null,
  });
  await profiles.removePersona(removedProfile.id);
  await run(missingProfile);
  assert.equal(missingProfile.state, "CONFLICT");
  assert.ok(missingProfile.resultPath);
  const removedChat = await chats.create({ name: "Deleted chat", mode: "roleplay", characterIds: [] });
  assert.ok(removedChat);
  const missingChat = await hold({ kind: "chat", chatId: removedChat.id });
  await chats.remove(removedChat.id);
  await run(missingChat);
  assert.equal(missingChat.state, "CONFLICT");
  const failed = await hold({ kind: "chat", chatId: chat.id });
  failApply = true;
  await run(failed);
  assert.equal(failed.state, "APPLY_FAILED");
  assert.equal(failed.reason, "application_failed");
  const sentBeforeRetry = sends;
  const oldRevision = failed.revision;
  failApply = false;
  await guard.retryApplication(failed.id, failed.revision);
  assert.equal(failed.state, "SUCCEEDED");
  assert.equal(sends, sentBeforeRetry, "application retry never generates");
  await assert.rejects(guard.retryApplication(failed.id, oldRevision), /Queue changed/);
  const conversion = await hold({ kind: "chat", chatId: chat.id });
  failConversion = true;
  await run(conversion);
  failConversion = false;
  assert.equal(conversion.reason, "conversion_failed");
  const beforeConversionRetry = sends;
  await guard.retryConversion(conversion.id, conversion.revision);
  assert.equal(conversion.state, "SUCCEEDED");
  assert.ok(conversion.appliedAt, "conversion retry must also apply to original target");
  assert.equal(sends, beforeConversionRetry);
  // Saved response receipt recovers the write-before-queue crash without another API request.
  guard.close();
  const recoverySnapshot = JSON.parse(readFileSync(join(options.directory, "queue.json"), "utf8"));
  const saved = recoverySnapshot.jobs.find((job: { id: string }) => job.id === failed.id);
  saved.state = "RUNNING";
  delete saved.resultPath;
  writeFileSync(join(options.directory, "queue.json"), JSON.stringify(recoverySnapshot));
  guard = new NaiRequestGuard(options);
  await guard.recoverApplications();
  assert.equal(guard.detail(failed.id)?.state, "SUCCEEDED");
  assert.equal(sends, beforeConversionRetry);
  // Regeneration replaces only original references, once.
  const original = (await gallery.listByChatId(chat.id)).find((row) => row.id === chatJob.id)!;
  await chats.setActiveSwipe(message.id, 0);
  const replacement = await hold(await captureNaiGalleryReplacement(db, chat.id, original.id));
  await chats.setActiveSwipe(message.id, 1);
  await run(replacement);
  assert.equal(replacement.state, "SUCCEEDED");
  assert.equal(
    attachments(await chats.getMessage(message.id)).length,
    0,
    "regeneration cannot overwrite a newly selected swipe",
  );
  assert.equal(attachments((await chats.getSwipes(message.id))[0])[0].galleryId, replacement.id);
  setNaiRequestGuard(guard);
  const { createCapabilityIntegrationHost } =
    await import("../../packages/server/src/services/capability-packages/capability-integrations.service.js");
  const networkOnly = createCapabilityIntegrationHost(["network"]);
  let untrustedJobId = "";
  try {
    await networkOnly.images.generate("novelai", "https://image.novelai.net", "account", "novelai", {
      prompt: "untrusted package",
      model: "nai-diffusion-4-5-full",
      naiDestination: { kind: "profile", entity: "character", id: character.id, expectedAvatarPath: null },
    });
  } catch (error) {
    assert.ok(error instanceof NaiGuardError);
    untrustedJobId = error.jobId;
  }
  assert.ok(untrustedJobId);
  assert.equal(
    guard.detail(untrustedJobId)?.request.naiDestination,
    undefined,
    "network-only packages cannot schedule storage writes",
  );
  console.log(
    "NAI original-destination regression passed: inactive swipes, deletion/index reuse, profiles, conflicts, local retries, crash recovery and idempotence",
  );
} finally {
  guard!?.close();
  setNaiRequestGuard(undefined);
  await app.close();
  await closeDB();
  os.networkInterfaces = originalInterfaces;
  syncBuiltinESMExports();
  rmSync(directory, { recursive: true, force: true });
}
