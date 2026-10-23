import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
// End to end through the real translation service: what the AI provider actually receives.
const directory = mkdtempSync(join(tmpdir(), "me-translation-live-"));
process.env.DATA_DIR = directory;
process.env.FILE_STORAGE_DIR = join(directory, "storage");
process.env.LOG_LEVEL = "silent";
const { createChatSchema, createConnectionSchema, BUILTIN_TRANSLATION_PRESETS } =
  await import("../../packages/shared/src/index.js");
const { createFileNativeDB } = await import("../../packages/server/src/db/file-backed-store.js");
const { createChatsStorage } = await import("../../packages/server/src/services/storage/chats.storage.js");
const { createConnectionsStorage } = await import("../../packages/server/src/services/storage/connections.storage.js");
const { readNativeIntegrations, saveNativeIntegrations } =
  await import("../../packages/server/src/services/native-integrations.js");
const { translateText } = await import("../../packages/server/src/services/translation.service.js");

const requests: Array<{ messages: Array<{ role: string; content: string }> }> = [];
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const parsed = JSON.parse(body || "{}");
    requests.push(parsed);
    const text = "번역 결과";
    if (parsed.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
      res.end("data: [DONE]\n\n");
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: text } }] }));
    }
  });
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as { port: number }).port;
const db = await createFileNativeDB();
try {
  const connection = await createConnectionsStorage(db).create(
    createConnectionSchema.parse({
      name: "Mock translator",
      provider: "custom",
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: "fixture",
      model: "mock",
      treatAsLocalEndpoint: true,
    }),
  );
  const chat = await createChatsStorage(db).create(
    createChatSchema.parse({ name: "Live translation", mode: "roleplay", characterIds: [] }),
  );
  const settings = await readNativeIntegrations(db);
  settings.translation.rooms[chat!.id] = {
    ...settings.translation.defaults,
    presetId: "builtin-literary-roleplay",
    glossary: [{ source: "Alice", target: "앨리스", notes: "" }],
    style: "Alice speaks in short, cold sentences.",
  };
  await saveNativeIntegrations(db, settings);
  const source = '<audio_character id="alice">"[calm] Alice is here."</audio_character>';
  const result = await translateText(db, {
    chatId: chat!.id,
    text: source,
    provider: "ai",
    targetLanguage: "Korean",
    connectionId: connection!.id,
    systemPrompt: "Native chat prompt",
  });
  assert.equal(result.translatedText, "번역 결과");
  assert.equal(requests.length, 1, "the provider receives exactly one translation request");
  const sent = JSON.stringify(requests[0]!.messages);
  const preset = BUILTIN_TRANSLATION_PRESETS.find((row) => row.id === "builtin-literary-roleplay")!;
  assert.ok(sent.includes(JSON.stringify(preset.prompt.slice(0, 40)).slice(1, -1)), "built-in preset prompt is sent");
  assert.ok(!sent.includes("Native chat prompt"), "a replacing preset replaces the chat prompt");
  assert.ok(sent.includes("앨리스"), "matching glossary entry is sent");
  assert.ok(sent.includes("Alice speaks in short, cold sentences."), "speech style is sent");
  assert.ok(!/\{\{\s*(?:voice|vocab|targetLanguage)\s*\}\}/.test(sent), "no unfilled macros reach the provider");
  assert.ok(sent.includes("Korean"), "target language is filled");
  // Display-only translation: audio wrappers and cues are not sent, so the model cannot drop or alter them.
  assert.ok(sent.includes("Alice is here."), "the spoken line is sent");
  assert.ok(!/audio_character|\[calm\]|MARI_/.test(sent), "no audio markup or protection markers are sent");
  console.log("translation presets reach the provider");
} finally {
  server.close();
  rmSync(directory, { recursive: true, force: true });
}
