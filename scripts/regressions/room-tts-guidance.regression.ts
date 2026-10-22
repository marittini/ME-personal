import assert from "node:assert/strict";
import { roomTtsInstructions } from "../../packages/server/src/services/tts-emotion-guidance.js";
import { ttsConfigSchema, ttsSourceProfileFromConfig } from "../../packages/shared/src/types/tts.js";
import { withTTSVoiceRequestCacheKeys } from "../../packages/client/src/lib/tts-dialogue.js";
import { buildTTSVoiceRequests } from "../../packages/client/src/lib/tts-dialogue.js";
import {
  hideTTSAudioCues,
  parseTTSAudioLines,
  type TTSAudioParticipant,
} from "../../packages/client/src/lib/tts-audio-tags.js";

assert.ok(roomTtsInstructions("roleplay", true));
assert.ok(roomTtsInstructions("conversation", true));
assert.equal(roomTtsInstructions("game", true), null);
assert.equal(roomTtsInstructions("roleplay", false), null);
assert.equal(roomTtsInstructions("roleplay", "true"), null);
const config = ttsConfigSchema.parse({
  source: "elevenlabs",
  enabled: false,
  elevenLabsStyle: 0.4,
  elevenLabsSimilarityBoost: 0.8,
  elevenLabsSpeakerBoost: false,
});
assert.ok(roomTtsInstructions("roleplay", true), "guidance is independent of the paid speech gate");
const profile = ttsSourceProfileFromConfig(config);
assert.equal(profile.elevenLabsStyle, 0.4);
assert.equal(profile.elevenLabsSimilarityBoost, 0.8);
assert.equal(profile.elevenLabsSpeakerBoost, false);
const requests = [{ text: "Hello", voice: "voice" }];
const original = withTTSVoiceRequestCacheKeys(requests, config, "message")[0].cacheKey;
for (const change of [{ elevenLabsStyle: 0.9 }, { elevenLabsSimilarityBoost: 0.2 }, { elevenLabsSpeakerBoost: true }]) {
  assert.notEqual(withTTSVoiceRequestCacheKeys(requests, { ...config, ...change }, "message")[0].cacheKey, original);
}
assert.equal(ttsConfigSchema.safeParse({ elevenLabsStyle: 3 }).success, false);

const participants: TTSAudioParticipant[] = [
  { kind: "character", id: "alice", name: "Alice" },
  { kind: "persona", id: "reader", name: "Reader" },
];
const tagged =
  '<audio_character id="alice">"[whispering] Hello."</audio_character>\n<audio_persona id="reader">"[sigh] Yes."</audio_persona>';
assert.equal(parseTTSAudioLines(tagged, participants).length, 2);
assert.equal(parseTTSAudioLines("```html\n" + tagged + "\n```", participants).length, 0);
assert.equal(parseTTSAudioLines('<audio_character id="unknown">"Hello"</audio_character>', participants).length, 0);
assert.equal(parseTTSAudioLines('<audio_character id="alice"><b>Hello</b></audio_character>', participants).length, 0);
const assigned = {
  ...config,
  voiceMode: "per-character" as const,
  voiceAssignments: [{ characterId: "alice", characterName: "Alice", voice: "alice-voice" }],
  personaVoiceAssignments: [{ personaId: "reader", personaName: "Reader", voice: "reader-voice" }],
};
const spoken = buildTTSVoiceRequests(tagged, assigned, null, null, undefined, participants);
assert.deepEqual(
  spoken.map((line) => line.voice),
  ["alice-voice", "reader-voice"],
);
assert.match(spoken[0].text, /\[whispering\]/, "synthesis keeps original delivery cues");
assert.equal(hideTTSAudioCues(tagged), '"Hello."\n"Yes."');
assert.equal(hideTTSAudioCues("A [chapter note] and `[sigh]`"), "A [chapter note] and `[sigh]`");
assert.equal(hideTTSAudioCues("```\n[sigh]\n```"), "```\n[sigh]\n```");
assert.equal(hideTTSAudioCues("[Happy](https://example.com)"), "[Happy](https://example.com)");
assert.match(roomTtsInstructions("roleplay", true, true, participants)!, /audio_character/);
assert.match(roomTtsInstructions("roleplay", true, true, participants)!, /"id":"reader"/);
