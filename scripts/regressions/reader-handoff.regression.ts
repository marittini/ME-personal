import assert from "node:assert/strict";
import {
  splitMessageParagraphs,
  matchParagraphTranslations,
  readerExcerptsSchema,
  normalizeLibraryCustomizations,
} from "../../packages/shared/src/index.js";
import { hideTTSAudioCues, parseTTSAudioLines } from "../../packages/client/src/lib/tts-audio-tags";
import { protectTranslationMarkup } from "../../packages/server/src/services/translation-markup";
assert.deepEqual(splitMessageParagraphs("첫 문단\n이어지는 줄\n\nSecond paragraph.\n\n日本語。"), [
  "첫 문단\n이어지는 줄",
  "Second paragraph.",
  "日本語。",
]);
for (const block of ["```js\na()\n\nb()\n```", "> 첫 줄\n\n> 둘째 줄", "- 하나\n\n- 둘\n  이어짐"])
  assert.deepEqual(splitMessageParagraphs(`${block}\n\n다음 문단`), [block, "다음 문단"]);
assert.deepEqual(matchParagraphTranslations(["one", "two"], "하나\n\n둘"), ["하나", "둘"]);
assert.equal(matchParagraphTranslations(["one", "two"], "합쳐진 번역"), null);
const encoded = "&lt;audio_character id=&quot;alice&quot;&gt;**“[calm, flat] 한글 대사.”**&lt;/audio_character&gt;";
assert.equal(hideTTSAudioCues(encoded), "**“한글 대사.”**");
assert.equal(
  parseTTSAudioLines(encoded, [{ kind: "character", id: "alice", name: "Alice" }])[0]?.text,
  "[calm, flat] 한글 대사.",
);
assert.equal(hideTTSAudioCues("`" + encoded + "`"), "`" + encoded + "`");
assert.equal(
  hideTTSAudioCues("[참고] 설명과 [링크](https://example.com)"),
  "[참고] 설명과 [링크](https://example.com)",
);
const protectedMarkup = protectTranslationMarkup(encoded);
assert.equal(protectedMarkup.restore(protectedMarkup.text), encoded);
assert.doesNotMatch(protectedMarkup.text, /audio_character|calm, flat/);
assert.equal(
  normalizeLibraryCustomizations({ work: { title: "한국어", displayName: "別名", description: "English" } }).work
    ?.displayName,
  "別名",
);
assert.deepEqual(normalizeLibraryCustomizations({ bad: { title: 1 } }), {});
assert.equal(
  readerExcerptsSchema.safeParse([
    {
      id: "1",
      text: "발췌",
      marks: [{ type: "highlight", start: 4, end: 2 }],
      anchors: [],
      updatedAt: new Date().toISOString(),
    },
  ]).success,
  false,
);
assert.equal(readerExcerptsSchema.parse([]).length, 0);
console.log("reader handoff regressions passed");
