import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createHmac, pbkdf2Sync } from "node:crypto";
import { deflateSync, gzipSync } from "node:zlib";
const directory = mkdtempSync(join(tmpdir(), "me-native-integrations-"));
process.env.DATA_DIR = directory;
process.env.FILE_STORAGE_DIR = join(directory, "storage");
process.env.LOG_LEVEL = "silent";
const requireServer = createRequire(new URL("../../packages/server/package.json", import.meta.url));
const Fastify = requireServer("fastify");
const {
  nativeIntegrationsSchema,
  ttsConfigSchema,
  createChatSchema,
  createPromptPresetSchema,
  createConnectionSchema,
  createMessageSchema,
  BUILTIN_TRANSLATION_PRESETS,
  TRANSLATION_PRESET_V2_UPGRADES,
} = await import("../../packages/shared/src/index.js");
const { createFileNativeDB } = await import("../../packages/server/src/db/file-backed-store.js");
const { createAppSettingsStorage } = await import("../../packages/server/src/services/storage/app-settings.storage.js");
const { createChatsStorage } = await import("../../packages/server/src/services/storage/chats.storage.js");
const { createPromptsStorage } = await import("../../packages/server/src/services/storage/prompts.storage.js");
const { createConnectionsStorage } = await import("../../packages/server/src/services/storage/connections.storage.js");
const { decryptApiKey } = await import("../../packages/server/src/utils/crypto.js");
const {
  readNativeIntegrations,
  saveNativeIntegrations,
  resolveIntegratedPreset,
  integratedTranslationInput,
  fillTranslationPromptMacros,
  weatherInjection,
} = await import("../../packages/server/src/services/native-integrations.js");
const { operateKeyVault } = await import("../../packages/server/src/services/connection-key-vault.js");
const { nativeIntegrationsRoutes } = await import("../../packages/server/src/routes/native-integrations.routes.js");
const { errorHandler } = await import("../../packages/server/src/middleware/error-handler.js");
const { normalizeNovelAiMetadata, readNovelAiMetadata } =
  await import("../../packages/server/src/services/image/novelai-metadata-import.js");
const { crc32Buffer } = await import("../../packages/server/src/utils/crc32.js");
const { getSharp } = await import("../../packages/server/src/services/image/sharp-runtime.js");
const { importNativeIntegrationBackup } = await import("../../packages/client/src/lib/native-integration-import.js");
const { buildDialogueSpeechGroups } = await import("../../packages/client/src/lib/tts-dialogue-groups.js");
const { hideTTSAudioCues, parseTTSAudioLines } = await import("../../packages/client/src/lib/tts-audio-tags.js");
const { remapExcerptMarks } = await import("../../packages/client/src/lib/excerpt-canvas.js");
const db = await createFileNativeDB();
const settings = createAppSettingsStorage(db);
const chats = createChatsStorage(db);
const app = Fastify();
app.decorate("db", db);
app.setErrorHandler(errorHandler);
await app.register(nativeIntegrationsRoutes, { prefix: "/api/native-integrations" });
try {
  const room = await chats.create(
    createChatSchema.parse({ name: "Preserve native", mode: "roleplay", characterIds: [] }),
  );
  assert.ok(room);
  const preset = await createPromptsStorage(db).create(createPromptPresetSchema.parse({ name: "Family v1.0" }));
  assert.ok(preset);
  const own = await createPromptsStorage(db).create(createPromptPresetSchema.parse({ name: "Room choice" }));
  assert.ok(own);
  await chats.update(room.id, { promptPresetId: own.id });
  const initial = await readNativeIntegrations(db);
  const config = await saveNativeIntegrations(
    db,
    nativeIntegrationsSchema.parse({
      ...initial,
      globalPreset: { enabled: true, presetId: preset.id, presetName: preset.name },
    }),
  );
  await assert.rejects(saveNativeIntegrations(db, initial), /Settings changed/);
  assert.equal(
    await resolveIntegratedPreset(db, { ...room, promptPresetId: own.id }),
    own.id,
    "unconfigured room retains wizard/native choice",
  );
  // Global preset extension rules for rooms without a recorded choice.
  assert.equal(
    await resolveIntegratedPreset(db, { ...room, promptPresetId: null }),
    preset.id,
    "empty room follows global",
  );
  assert.equal(
    await resolveIntegratedPreset(db, { ...room, promptPresetId: "deleted-preset" }),
    preset.id,
    "room whose own preset was deleted follows global",
  );
  const presetConnection = await createConnectionsStorage(db).create(
    createConnectionSchema.parse({
      name: "Connection with preset",
      provider: "custom",
      baseUrl: "https://example.com",
      apiKey: "k",
      model: "m",
      promptPresetId: own.id,
    }),
  );
  assert.equal(
    await resolveIntegratedPreset(db, {
      ...room,
      mode: "roleplay",
      promptPresetId: null,
      connectionId: presetConnection!.id,
    }),
    null,
    "a roleplay connection preset wins over the global preset",
  );
  const concurrent = await Promise.allSettled([saveNativeIntegrations(db, config), saveNativeIntegrations(db, config)]);
  assert.equal(concurrent.filter((r) => r.status === "fulfilled").length, 1, "CAS prevents lost settings updates");
  const apply = await app.inject({
    method: "POST",
    url: "/api/native-integrations/presets/apply",
    payload: { chatIds: [room.id, room.id] },
  });
  assert.equal(apply.statusCode, 200, apply.body);
  assert.equal(apply.json().changed, 1);
  assert.equal((await chats.getById(room.id))?.promptPresetId, preset.id);

  // Paragraph translations use the reader's boundaries: a fenced block with a blank line is one paragraph.
  const fencedSource = "Intro line.\n\n```js\na()\n\nb()\n```\n\nLast line.";
  const fencedMessage = await chats.createMessage(
    createMessageSchema.parse({ chatId: room.id, role: "assistant", content: fencedSource }),
  );
  const saveParagraphs = (paragraphs: string[]) =>
    app.inject({
      method: "POST",
      url: "/api/native-integrations/translation/paragraphs",
      payload: { chatId: room.id, messageId: fencedMessage!.id, swipeIndex: 0, source: fencedSource, paragraphs },
    });
  assert.equal((await saveParagraphs(["A", "B", "C", "D"])).statusCode, 409);
  const savedParagraphs = await saveParagraphs(["소개.", "```js\na()\n\nb()\n```", "끝."]);
  assert.equal(savedParagraphs.statusCode, 200, savedParagraphs.body);
  const latest = await readNativeIntegrations(db);
  assert.equal(latest.globalPreset.history.length, 1);
  latest.globalPreset.rooms[room.id] = { mode: "none", presetId: null, presetName: "" };
  await saveNativeIntegrations(db, latest);
  assert.equal(await resolveIntegratedPreset(db, room), null);
  assert.equal(
    await weatherInjection(db, { id: room.id, mode: "conversation" }),
    null,
    "disabled weather makes no network request",
  );
  const translated = await readNativeIntegrations(db);
  translated.translation.presets = [
    { id: "out", name: "Out", prompt: "Outgoing {{targetLanguage}}", replace: true, targetLanguage: "English" },
    { id: "in", name: "In", prompt: "Incoming {{targetLanguage}}", replace: true, targetLanguage: "Korean" },
  ];
  translated.translation.defaults = {
    ...translated.translation.defaults,
    presetId: "in",
    outgoingPresetId: "out",
    glossary: [
      { source: "Alice", target: "앨리스", notes: "" },
      { source: "unrelated", target: "무관", notes: "" },
    ],
  };
  await saveNativeIntegrations(db, translated);
  const output = await integratedTranslationInput(db, {
    chatId: room.id,
    text: "Alice arrived",
    provider: "ai",
    targetLanguage: "Japanese",
    direction: "output",
  });
  assert.equal(output.targetLanguage, "Korean");
  assert.match(output.systemPrompt!, /앨리스/);
  assert.doesNotMatch(output.systemPrompt!, /무관/);
  assert.equal(
    (
      await integratedTranslationInput(db, {
        chatId: room.id,
        text: "Alice",
        provider: "ai",
        targetLanguage: "Korean",
        direction: "input",
      })
    ).targetLanguage,
    "English",
  );
  // Built-in presets resolve by id, fill {{voice}}/{{vocab}} in place and keep the chat's language.
  assert.equal(BUILTIN_TRANSLATION_PRESETS.length, 16);
  assert.equal(new Set(BUILTIN_TRANSLATION_PRESETS.map((preset) => preset.id)).size, 16);
  const roleplayPreset = BUILTIN_TRANSLATION_PRESETS.find((preset) => preset.id === "builtin-roleplay")!;
  await saveNativeIntegrations(db, {
    ...(await readNativeIntegrations(db)),
    translation: {
      ...translated.translation,
      defaults: { ...translated.translation.defaults, presetId: "builtin-roleplay", style: "Alice speaks curtly." },
    },
  });
  const builtinOutput = await integratedTranslationInput(db, {
    chatId: room.id,
    text: "Alice arrived",
    provider: "ai",
    targetLanguage: "Japanese",
    systemPrompt: "Chat prompt",
    direction: "output",
  });
  assert.equal(builtinOutput.targetLanguage, "Japanese");
  assert.ok(builtinOutput.systemPrompt!.startsWith(roleplayPreset.prompt.slice(0, 60)));
  assert.doesNotMatch(builtinOutput.systemPrompt!, /\{\{\s*(?:voice|vocab)\s*\}\}|Chat prompt/);
  assert.equal(builtinOutput.systemPrompt!.match(/앨리스/g)?.length, 1);
  assert.equal(builtinOutput.systemPrompt!.match(/Alice speaks curtly/g)?.length, 1);
  await saveNativeIntegrations(db, {
    ...(await readNativeIntegrations(db)),
    translation: {
      ...translated.translation,
      defaults: { ...translated.translation.defaults, presetId: "builtin-inherit", glossary: [] },
    },
  });
  const inherited = await integratedTranslationInput(db, {
    chatId: room.id,
    text: "Alice arrived",
    provider: "ai",
    targetLanguage: "Japanese",
    systemPrompt: "Chat prompt",
    direction: "output",
  });
  assert.equal(inherited.systemPrompt, "Chat prompt");
  assert.deepEqual(fillTranslationPromptMacros("A\n{{voice}}\nB {{vocab}}", { voice: "", vocab: "V" }), {
    text: "A\nB V",
    used: { voice: true, vocab: true },
  });
  await saveNativeIntegrations(db, { ...(await readNativeIntegrations(db)), translation: translated.translation });
  const connection = await createConnectionsStorage(db).create(
    createConnectionSchema.parse({
      name: "Vault target",
      provider: "custom",
      baseUrl: "https://example.com",
      apiKey: "old-key",
      model: "demo",
    }),
  );
  assert.ok(connection);
  const run = (action: string, more = {}, password = "test-master") =>
    operateKeyVault(db, { action, password, ...more });
  assert.deepEqual((await run("list")).entries, []);
  const saved = await run("save", { name: "Primary", group: "AI", key: "sk-native-secret" });
  const keyId = saved.entries![0]!.id;
  assert.ok(!JSON.stringify(saved).includes("sk-native-secret"));
  assert.ok(!(await settings.get("connection-key-vault"))?.includes("sk-native-secret"));
  await assert.rejects(run("list", {}, "wrong-password"), /unlock/);
  assert.equal((await run("select", { id: keyId })).selectedKey, "sk-native-secret");
  await run("apply", { id: keyId, connectionId: connection.id });
  assert.equal(
    decryptApiKey((await createConnectionsStorage(db).getById(connection.id))!.apiKeyEncrypted),
    "sk-native-secret",
  );
  const backup = (await run("export")).backup;
  assert.ok(backup);
  const legacyEntries = { keys: { NAI: [{ id: "legacy", name: "Legacy", key: "legacy-secret" }] } };
  const salt = Buffer.alloc(16, 7),
    iv = Buffer.alloc(16, 3),
    master = pbkdf2Sync("legacy-pass", salt, 10000, 32, "sha256");
  const hmac = (key: Buffer, bytes: Buffer | string) => createHmac("sha256", key).update(bytes).digest();
  const plain = Buffer.from(JSON.stringify(legacyEntries)),
    encrypted = Buffer.alloc(plain.length);
  for (let off = 0, i = 0; off < plain.length; off += 32, i++) {
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(i);
    const block = hmac(hmac(master, "akl-enc"), Buffer.concat([iv, counter]));
    for (let j = 0; j < 32 && off + j < plain.length; j++) encrypted[off + j] = plain[off + j]! ^ block[j]!;
  }
  const vault = {
    v: 1,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    iter: 10000,
    data: encrypted.toString("base64"),
    tag: hmac(hmac(master, "akl-mac"), Buffer.concat([iv, encrypted])).toString("base64"),
  };
  await run("import", { backup: { vault }, newPassword: "legacy-pass" });
  assert.equal((await run("select", { id: "legacy" })).selectedKey, "legacy-secret");
  await assert.rejects(
    run("import", {
      backup: { vault: { ...vault, tag: Buffer.alloc(32).toString("base64") } },
      newPassword: "legacy-pass",
    }),
  );
  await run("changePassword", { newPassword: "new-master" });
  await assert.rejects(run("list"), /unlock/);
  assert.equal((await run("list", {}, "new-master")).entries?.length, 2);
  const source = '<audio_persona id="p">"[low, restrained voice] Hello"</audio_persona> and `[note]`';
  const participants = [
    { kind: "character" as const, id: "alice", name: "Alice" },
    { kind: "persona" as const, id: "p", name: "P" },
  ];
  assert.equal(
    parseTTSAudioLines('<audio_character id=**alice**>"Hello"</audio_character> <p>"Yes"</p>', participants).length,
    2,
  );
  assert.equal(
    hideTTSAudioCues(
      'A [chapter note], "[soft chuckle] Hi [low, trembling voice] there" `[whispers]` [link](https://example.com)',
    ),
    'A [chapter note], "Hi there" `[whispers]` [link](https://example.com)',
  );
  const tts = ttsConfigSchema.parse({
    enabled: true,
    source: "elevenlabs",
    connectionId: "audio-a",
    voice: "default",
    voiceAssignments: [{ characterId: "alice", characterName: "Alice", voice: "alice-voice" }],
    personaVoiceAssignments: [{ personaId: "p", personaName: "P", voice: "p-voice" }],
  });
  const identity = {
    chatId: room.id,
    messageId: "m",
    swipeIndex: 0,
    characterId: "alice",
    speaker: "Alice",
    tagged: false,
    conversation: false,
    participants,
  };
  const repeated = buildDialogueSpeechGroups('"Same." "Same."', tts, identity);
  assert.equal(repeated.length, 2);
  assert.notEqual(repeated[0]!.requests[0]!.cacheKey, repeated[1]!.requests[0]!.cacheKey);
  const tagged = buildDialogueSpeechGroups(source, tts, { ...identity, tagged: true });
  assert.equal(tagged[0]!.requests[0]!.voice, "p-voice");
  assert.match(tagged[0]!.requests[0]!.text, /low, restrained/);
  assert.throws(
    () => buildDialogueSpeechGroups(source, { ...tts, personaVoiceAssignments: [] }, { ...identity, tagged: true }),
    /missingVoice/,
  );
  assert.notEqual(
    buildDialogueSpeechGroups('"Same."', { ...tts, connectionId: "audio-b" }, identity)[0]!.requests[0]!.cacheKey,
    repeated[0]!.requests[0]!.cacheKey,
  );
  const imported = importNativeIntegrationBackup(
    {
      kind: "translation-presets-glossary.backup",
      v: 1,
      type: "chat",
      presets: [],
      scope: { glossary: "Alice=앨리스", freeContextEnabled: true, freeContext: "World" },
    },
    translated,
    room.id,
  );
  assert.equal(imported.translation.rooms[room.id]!.freeContext, "World");
  // Extension backups keep built-in choices, map a saved v2 prompt copy to its built-in and keep context defaults.
  const v2Upgrade = TRANSLATION_PRESET_V2_UPGRADES[0]!;
  const v2Builtin = BUILTIN_TRANSLATION_PRESETS.find((preset) => preset.id === v2Upgrade.id)!;
  const restored = importNativeIntegrationBackup(
    {
      kind: "translation-presets-glossary.backup",
      v: 1,
      type: "all",
      presets: [
        { id: v2Upgrade.sourceId, name: v2Builtin.name, prompt: v2Builtin.prompt },
        { id: "custom-mine", name: "Mine", prompt: "Mine {{vocab}}" },
        { id: "builtin-roleplay", name: "Spoofed", prompt: "Spoofed" },
      ],
      defaults: { incomingPresetId: "builtin-literary-roleplay", outgoingPresetId: v2Upgrade.sourceId },
      chats: { [room.id]: { incomingPresetId: "custom-mine", contextEnabled: true, contextMessageCount: 40 } },
    },
    translated,
  );
  assert.equal(restored.translation.defaults.presetId, "builtin-literary-roleplay");
  assert.equal(restored.translation.defaults.outgoingPresetId, v2Upgrade.id);
  const mine = restored.translation.presets.find((preset) => preset.id === "custom-mine")!;
  assert.equal(mine.replace, true);
  assert.equal(mine.targetLanguage, undefined);
  assert.ok(
    !restored.translation.presets.some(
      (preset) => preset.id === "builtin-roleplay" || preset.id === v2Upgrade.sourceId,
    ),
  );
  assert.equal(restored.translation.rooms[room.id]!.presetId, "custom-mine");
  assert.equal(restored.translation.rooms[room.id]!.contextMessages, 10);
  assert.equal(restored.translation.rooms[room.id]!.contextIncludeTranslation, true);
  assert.equal(restored.translation.rooms[room.id]!.contextIncludeUserInput, false);
  assert.throws(() => importNativeIntegrationBackup({}, translated), /Unsupported/);
  const migrated = importNativeIntegrationBackup(
    { weatherSettings: { enabled: false, roomIds: ["old"], rooms: { old: { enabled: false } } } },
    translated,
  );
  assert.equal(migrated.weather.rooms.old!.enabled, false);
  assert.equal(migrated.weather.enabled, false);
  assert.deepEqual(remapExcerptMarks([{ type: "hide", start: 3, end: 5 }], "abcde", "Xabcde"), [
    { type: "hide", start: 4, end: 6 },
  ]);
  const metadata = normalizeNovelAiMetadata({
    Source: "NovelAI",
    Comment: JSON.stringify({
      model: "nai-diffusion-4-5-full",
      prompt: "cat",
      uc: "bad",
      seed: 42,
      steps: 28,
      scale: 5,
      cfg_rescale: 0.4,
    }),
  });
  assert.equal(metadata.values.model, "nai-diffusion-4-5-full");
  assert.equal(metadata.values.promptPrefix, "cat");
  assert.ok(!("seed" in metadata.values));
  assert.equal(normalizeNovelAiMetadata({ Source: "NovelAI Diffusion V4.5", Comment: "{}" }).values.model, undefined);
  const sharp = await getSharp();
  const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: "white" } })
    .png()
    .toBuffer();
  const chunk = (type: string, data: Buffer) => {
    const size = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32Buffer(body));
    return Buffer.concat([size, body, crc]);
  };
  const comment = JSON.stringify({ model: "nai-diffusion-4-5-full", prompt: "메타데이터", steps: 28, scale: 5 });
  for (const compressed of [false, true]) {
    const data = compressed
      ? Buffer.concat([Buffer.from("Comment\0\0"), deflateSync(Buffer.from(comment))])
      : Buffer.from("Comment\0" + comment);
    const augmented = Buffer.concat([
      png.subarray(0, png.length - 12),
      chunk(compressed ? "zTXt" : "tEXt", data),
      png.subarray(-12),
    ]);
    const read = await readNovelAiMetadata(augmented);
    assert.equal(read.values.promptPrefix, "메타데이터");
    await assert.rejects(readNovelAiMetadata(augmented.subarray(0, augmented.length - 3)));
  }
  const alphaPayload = gzipSync(Buffer.from(JSON.stringify({ Source: "NovelAI", Comment: comment })));
  const bits = Buffer.alloc(4);
  bits.writeUInt32BE(alphaPayload.length * 8);
  const bytes = Buffer.concat([Buffer.from("stealth_pngcomp"), bits, alphaPayload]);
  const raw = Buffer.alloc(64 * 64 * 4, 255);
  for (let i = 0; i < bytes.length * 8; i++) {
    const pos = ((i % 64) * 64 + Math.floor(i / 64)) * 4 + 3;
    raw[pos] = (raw[pos]! & 254) | ((bytes[Math.floor(i / 8)]! >> (7 - (i % 8))) & 1);
  }
  assert.equal(
    (
      await readNovelAiMetadata(
        await sharp(raw, { raw: { width: 64, height: 64, channels: 4 } })
          .png()
          .toBuffer(),
      )
    ).values.promptPrefix,
    "메타데이터",
  );
  console.log(
    "PASS: native integration storage/CAS, global preset, translation, vault v1/v2, TTS identity/cache, migrations, PNG/alpha metadata",
  );
} finally {
  await app.close();
  await db._fileStore.close();
  rmSync(directory, { recursive: true, force: true });
}
