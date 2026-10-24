// A room's extras (people without a card) speak in their own voice through the same speech wrappers as the room's
// characters (owner request 2026-10-24: give an extra who turned up mid-RP a voice without making a card).
import assert from "node:assert/strict";
import { ttsConfigSchema, ttsExtraParticipants } from "../../packages/shared/src/index.ts";
import { buildDialogueSpeechGroups } from "../../packages/client/src/lib/tts-dialogue-groups.ts";
import { buildTTSVoiceRequests } from "../../packages/client/src/lib/tts-dialogue.ts";
import { roomTtsInstructions } from "../../packages/server/src/services/tts-emotion-guidance.ts";

const extras = ttsExtraParticipants([
  { id: "extra-a1", name: " 엑스트라A ", voice: "extra-voice" },
  { id: "extra-b2", name: "빈 목소리", voice: "" },
  { id: "not-an-extra", name: "Bad id", voice: "x" },
  { id: "extra-c3", name: "   ", voice: "x" },
]);
assert.deepEqual(extras, [
  { kind: "character", id: "extra-a1", name: "엑스트라A", voice: "extra-voice" },
  { kind: "character", id: "extra-b2", name: "빈 목소리", voice: "" },
]);

const config = ttsConfigSchema.parse({
  enabled: true,
  source: "elevenlabs",
  connectionId: "audio",
  voice: "default-voice",
  voiceMode: "per-character",
  voiceAssignments: [{ characterId: "iv", characterName: "IV", voice: "iv-voice" }],
});
const participants = [{ kind: "character" as const, id: "iv", name: "IV" }, ...extras];
const text = [
  '<audio_character id="iv">"[low] Who are you?"</audio_character>',
  '<audio_character id="extra-a1">"Just a passer-by."</audio_character>',
  '<audio_character id="extra-b2">"Me too."</audio_character>',
].join("\n\n");

const groups = buildDialogueSpeechGroups(text, config, {
  chatId: "c",
  messageId: "m",
  swipeIndex: 0,
  characterId: "iv",
  speaker: "IV",
  tagged: true,
  conversation: false,
  participants,
});
assert.deepEqual(
  groups.map((group) => group.requests[0]!.voice),
  ["iv-voice", "extra-voice", "default-voice"],
);
// Extras are not cards: no character id travels with their speech.
assert.equal(groups[1]!.requests[0]!.characterId, undefined);
assert.equal(groups[0]!.requests[0]!.characterId, "iv");

// Autoplay builds the same voices.
const requests = buildTTSVoiceRequests(text, config, "IV", "iv", undefined, participants, "tagged");
assert.deepEqual(
  requests.map((request) => request.voice),
  ["iv-voice", "extra-voice", "default-voice"],
);
// The generation prompt lists the extras with their ids, so the model can wrap their lines.
const guidance = roomTtsInstructions("roleplay", true, true, [
  { kind: "character", id: "iv", name: "IV" },
  ...extras.map(({ kind, id, name }) => ({ kind, id, name })),
])!;
assert.match(guidance, /"id":"extra-a1","name":"엑스트라A"/u);
assert.doesNotMatch(guidance, /extra-voice/u);
console.log("tts extra voices: ok");
