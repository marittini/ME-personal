// A character's or persona's phonetic name replaces that name in text sent to TTS (owner report 2026-10-24: IV with
// the phonetic name フォー was read as the Japanese 4, 욘).
import assert from "node:assert/strict";
import { ttsConfigSchema } from "../../packages/shared/src/index.ts";
import { applyTTSPronunciations, setTTSPronunciations } from "../../packages/client/src/lib/tts-pronunciation.ts";
import { buildDialogueSpeechGroups } from "../../packages/client/src/lib/tts-dialogue-groups.ts";
import { cleanTTSInputText } from "../../packages/client/src/lib/tts-dialogue.ts";

setTTSPronunciations([
  { name: "IV", spoken: "フォー" },
  { name: "세코", spoken: "せこ" },
  { name: "Empty", spoken: "  " },
]);
assert.equal(applyTTSPronunciations("IV, come here. IV는 웃었다."), "フォー, come here. フォー는 웃었다.");
// Only whole Latin names: IVY and XIV stay as they are.
assert.equal(applyTTSPronunciations("IVY and XIV"), "IVY and XIV");
assert.equal(applyTTSPronunciations("세코야"), "せこ야");
assert.equal(applyTTSPronunciations("Empty stays"), "Empty stays");
assert.equal(cleanTTSInputText("**IV**, wait."), "フォー, wait.");

const config = ttsConfigSchema.parse({ enabled: true, source: "openai", voice: "alloy" });
const groups = buildDialogueSpeechGroups('"IV, it is me."', config, {
  chatId: "c",
  messageId: "m",
  swipeIndex: 0,
  characterId: null,
  speaker: "세코",
  tagged: false,
  conversation: false,
  participants: [],
});
assert.equal(groups[0]!.requests[0]!.text, "フォー, it is me.");

setTTSPronunciations([]);
assert.equal(applyTTSPronunciations("IV"), "IV");
console.log("tts pronunciation: ok");
