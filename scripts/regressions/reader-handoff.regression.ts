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

// Excerpt studio (extension 1.0.0 port): legacy settings migrate, marks behave and English wraps by word.
{
  const { nativeIntegrationsSchema, excerptAppearanceSchema, readerExcerptSchema } =
    await import("../../packages/shared/src/index.js");
  const { applyExcerptMark, annotateExcerptText, layoutExcerptLines, excerptFileName } =
    await import("../../packages/client/src/lib/excerpt-canvas");
  const legacyDefaults = {
    width: 720,
    height: 0,
    padding: 48,
    fontSize: 24,
    lineHeight: 1.7,
    letterSpacing: 0,
    radius: 16,
    fontFamily: "",
    title: "",
    author: "",
    background: "paper",
    backgroundColor: "#fbf8f3",
    textColor: "#302a25",
    quoteColor: "#936b4b",
    backgroundImageUrl: null,
  };
  // Untouched first-port defaults become the extension's defaults.
  assert.deepEqual(
    nativeIntegrationsSchema.parse({ excerpt: legacyDefaults }).excerpt,
    excerptAppearanceSchema.parse({}),
  );
  const customized = nativeIntegrationsSchema.parse({
    excerpt: { ...legacyDefaults, width: 900, height: 1200, background: "ruled", title: "작품", author: "" },
  }).excerpt;
  assert.equal(customized.cardWidth, 900);
  assert.equal(customized.heightMode, "fixed");
  assert.equal(customized.cardHeight, 1200);
  assert.deepEqual([customized.background.mode, customized.background.pattern], ["solid", "lines"]);
  assert.equal(customized.background.color, "#fbf8f3");
  assert.deepEqual([customized.showTitle, customized.titleText, customized.showAuthor], [true, "작품", false]);
  assert.equal(customized.dialogueColor, "#936b4b");
  // Already-migrated settings stay as saved.
  const current = excerptAppearanceSchema.parse({ cardWidth: 500, align: "justify" });
  assert.deepEqual(nativeIntegrationsSchema.parse({ excerpt: current }).excerpt, current);
  // Excerpts saved before appearance/colors existed still parse.
  assert.ok(
    readerExcerptSchema.safeParse({
      id: "a",
      text: "x",
      marks: [{ start: 0, end: 1, type: "highlight" }],
      anchors: [],
      updatedAt: new Date().toISOString(),
    }).success,
  );

  let marks = applyExcerptMark([], 0, 10, { type: "highlight", color: "y" });
  marks = applyExcerptMark(marks, 3, 6, { type: "underline", color: "b" });
  assert.deepEqual(
    marks.map((m) => [m.start, m.end, m.type, m.color]),
    [
      [0, 3, "highlight", "y"],
      [3, 6, "underline", "b"],
      [6, 10, "highlight", "y"],
    ],
  );
  marks = applyExcerptMark([...marks, { start: 7, end: 9, type: "replace", value: "Z" }], 2, 8, null);
  assert.deepEqual(
    marks.map((m) => [m.start, m.end, m.type]),
    [
      [0, 2, "highlight"],
      [8, 10, "highlight"],
    ],
  );

  // A mark on a renamed word covers the whole replacement; range replacements apply before rules.
  const annotated = annotateExcerptText(
    "Bob met Ann.",
    [{ start: 8, end: 11, type: "replace", value: "Eve" }],
    [{ find: "Bob", replace: "로버트" }],
  );
  assert.equal(annotated.map((c) => c.ch).join(""), "로버트 met Eve.");
  assert.deepEqual(
    annotated.slice(0, 3).map((c) => [c.bs, c.be]),
    [
      [0, 3],
      [0, 3],
      [0, 3],
    ],
  );

  // Fixed-width measure: English wraps between words, Korean per syllable, an over-long word splits.
  const widthOf = (value: string) => value.length * 10;
  const words = layoutExcerptLines("alpha beta gamma", 110, widthOf).map((line) =>
    line.tokens.map((token) => token.text).join(""),
  );
  assert.deepEqual(words, ["alpha beta", "gamma"]);
  assert.deepEqual(
    layoutExcerptLines("가나다라", 25, widthOf).map((line) => line.tokens.map((token) => token.text).join("")),
    ["가나", "다라"],
  );
  assert.deepEqual(
    layoutExcerptLines("abcdefgh", 30, widthOf).map((line) => line.tokens.map((token) => token.text).join("")),
    ["abc", "def", "gh"],
  );
  assert.equal(excerptFileName(new Date(2026, 9, 23, 9, 5, 7)), "발췌_20261023_090507.png");
}
