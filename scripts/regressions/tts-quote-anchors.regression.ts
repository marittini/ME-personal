// Per-line read-aloud controls find their quote by its words, so narration that quotes words does not push every
// control into the row under the message (owner reports 2026-10-24).
import assert from "node:assert/strict";
import {
  matchLinesToQuotes,
  matchLinesToTranslatedQuotes,
  matchLinesToWrappedTranslation,
  spokenKey,
  translationQuoteCount,
} from "../../packages/client/src/lib/tts-translation-anchors.ts";

assert.equal(spokenKey('"[calm, flat] ……だから 卵しか ないと!"'), spokenKey("だから卵しかないと"));

// Native: narration quotes a word ("word") and 『…』 between two spoken lines.
const page = ['"Come here."', '"sorry"', "『麦茶と 卵しか ねぇ』", '"[low] I said, come here."'];
assert.deepEqual(matchLinesToQuotes(["Come here.", "I said, come here."], page), [0, 3]);
// A line that is not on the page stays unplaced; the rest keep their quotes.
assert.deepEqual(matchLinesToQuotes(["Come here.", "Not shown.", "I said, come here."], page), [0, null, 3]);
// Order is kept: the same words later in the text go to the later quote.
assert.deepEqual(matchLinesToQuotes(["Same.", "Same."], ['"Same."', "『x』", '"Same."']), [0, 2]);
// A long line read in chunks still finds its single quote.
assert.deepEqual(matchLinesToQuotes(["One two three four five six"], ['"One two three four five six seven"']), [0]);

// Translation view: the second paragraph's narration quote came back as a translated quote too.
const original = [
  '"Hungry."',
  "He had complained 『only barley tea and eggs』 earlier.",
  '<audio_persona id="p">"I told you there were only eggs."</audio_persona>',
].join("\n\n");
// Translated quotes: paragraph 0 has one, paragraph 1 one (narration), paragraph 2 one.
assert.deepEqual(
  matchLinesToTranslatedQuotes(original, ["Hungry.", "I told you there were only eggs."], [0, 1, 2]),
  [0, 2],
);
// A paragraph whose translation lost a quote cannot be mapped quote for quote, but its spoken count still fits.
assert.deepEqual(matchLinesToTranslatedQuotes('"A." 『b』 "C."', ["A.", "C."], [0, 0]), [0, 1]);
// When neither count fits, the line is left for the row instead of guessing.
assert.deepEqual(matchLinesToTranslatedQuotes('"A." 『b』 "C."', ["A.", "C."], [0]), [null, null]);
// Paragraphs merged in translation, every quote kept: map quote for quote overall.
assert.deepEqual(matchLinesToTranslatedQuotes('"A."\n\n『b』\n\n"C."', ["A.", "C."], [0, 0, 0]), [0, 2]);

// Translation-only with the wrappers kept: 『…』 narration came back as "…" in the same paragraph as a spoken line.
const translation = [
  '그는 "배고파"라는 말을 삼킨다. <audio_character id="c1">"[low] 진짜 배고프다고."</audio_character>',
  '냉장고에는 "보리차와 달걀"이라는 메모만 있다.',
  '<audio_persona id="p1">"[flat] 달걀밖에 없다고 했잖아."</audio_persona>',
].join("\n\n");
assert.equal(translationQuoteCount(translation), 4);
// Attribute quotes (id="c1") never count; the spoken quotes are the 2nd and 4th.
assert.deepEqual(matchLinesToWrappedTranslation(translation, 2), [1, 3]);
assert.equal(matchLinesToWrappedTranslation(translation, 3), null);
assert.equal(matchLinesToWrappedTranslation('"no wrappers"', 1), null);
console.log("tts quote anchors: ok");
