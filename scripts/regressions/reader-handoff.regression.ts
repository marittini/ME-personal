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

// Reader paragraph controls must preserve parsed inline content and one TTS anchor per utterance.
const { createRequire } = await import("node:module");
const clientRequire = createRequire(new URL("../../packages/client/package.json", import.meta.url));
const React = clientRequire("react");
Object.assign(globalThis, { React });
const { renderToStaticMarkup } = clientRequire("react-dom/server");
const { renderProseParagraphs } = await import("../../packages/client/src/lib/prose-paragraphs");
const prose = renderToStaticMarkup(
  React.createElement("div", null, renderProseParagraphs("한국어\n한 줄\n\n日本語 English", "proof")),
);
assert.equal(prose.replace(/<[^>]*>/g, ""), "한국어\n한 줄\n\n日本語 English");
assert.equal((prose.match(/data-reader-prose/g) ?? []).length, 2);
const dialogue = renderToStaticMarkup(
  React.createElement(
    "div",
    null,
    renderProseParagraphs(React.createElement("strong", { "data-tts-dialogue": "" }, "First\n\nsecond"), "speech"),
  ),
);
assert.equal((dialogue.match(/data-tts-dialogue/g) ?? []).length, 1);
const { normalizeReaderPreferences } = await import("../../packages/client/src/lib/reader-preferences");
assert.equal(normalizeReaderPreferences({ font: "serif" }).font, "@serif");
assert.equal(normalizeReaderPreferences({ indent: NaN }).indent, 0);
assert.equal(normalizeReaderPreferences({ indent: 100 }).indent, 4);

assert.deepEqual(splitMessageParagraphs("    code\n\n    more\n\n다음"), ["    code\n\n    more", "다음"]);
assert.equal(hideTTSAudioCues("```html\n" + encoded), "```html\n" + encoded);

// Quoted references are text, not audio cues; open-vocabulary cues stay hidden when they stand apart.
assert.equal(hideTTSAudioCues("“[문서 3쪽]을 펼쳐.”"), "“[문서 3쪽]을 펼쳐.”");
assert.equal(hideTTSAudioCues("“[참조]를 봐.”"), "“[참조]를 봐.”");
assert.equal(hideTTSAudioCues('"[calm, flat] ……마음대로 해."'), '"……마음대로 해."');
assert.equal(hideTTSAudioCues('"[flustered, gruff]……간다."'), '"……간다."');
assert.equal(hideTTSAudioCues('<audio_persona id="p">"[calm, flat]마음대로 해."</audio_persona>'), '"마음대로 해."');
