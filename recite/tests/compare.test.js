import test from 'node:test';
import assert from 'node:assert/strict';
import { buildView, compareRecitation, findVerseSpan, summarize } from '../lib/compare.js';
import { toUnits } from '../lib/text.js';
import { STARTER_VERSES } from '../lib/starter.js';

const JOHN_3_16 = STARTER_VERSES.find((v) => v.ref === 'John 3:16');
const PROVERBS_3_5 = STARTER_VERSES.find((v) => v.ref === 'Proverbs 3:5-6');
const ROMANS_8_28 = STARTER_VERSES.find((v) => v.ref === 'Romans 8:28');

function check(verse, said, mode = 'voice') {
  const result = compareRecitation(verse.text, said, { mode, reference: verse.ref });
  return { result, stats: summarize(result), items: buildView(result) };
}

// Compact picture of the result: "word", "[-missing]", "[wrong→heard]", "[+extra]", "{ref}".
function picture(items) {
  return items
    .map((item) => {
      if (item.kind === 'ref') return `{${item.heard}}`;
      if (item.kind === 'extra') return `[+${item.heard}]`;
      if (item.status === 'missing') return `[-${item.text}]`;
      if (item.status === 'wrong') return `[${item.text}→${item.heard}]`;
      return item.text;
    })
    .join(' ');
}

test('a word-perfect recitation scores 100 regardless of case and punctuation', () => {
  const { stats } = check(JOHN_3_16, 'for god so loved the world that he gave his one and only son that whoever believes in him shall not perish but have eternal life');
  assert.deepEqual(stats, { total: 26, correct: 26, wrong: 0, missing: 0, extra: 0, score: 100, perfect: true });
});

test('every starter verse matches itself in both modes', () => {
  for (const verse of STARTER_VERSES) {
    for (const mode of ['voice', 'type']) {
      const { stats } = check(verse, verse.text, mode);
      assert.ok(stats.perfect, `${verse.ref} (${mode})`);
    }
  }
});

test('digits from the recognizer count as the spoken number', () => {
  const { stats } = check(JOHN_3_16, 'For God so loved the world that he gave his 1 and only Son that whoever believes in him shall not perish but have eternal life');
  assert.ok(stats.perfect);
});

test('a missing word is reported in place', () => {
  const { stats, items } = check(ROMANS_8_28, 'And we know that in all things God works for good of those who love him, who have been called according to his purpose.');
  assert.equal(stats.missing, 1);
  assert.equal(stats.wrong + stats.extra, 0);
  assert.match(picture(items), /works for \[-the\] good of/);
});

test('a changed word is wrong, and shows what was heard', () => {
  const { stats, items } = check(JOHN_3_16, 'For God so loved the world that he gave his one and only Son that whoever believes in him will not perish but have eternal life');
  assert.equal(stats.wrong, 1);
  assert.match(picture(items), /\[shall→will\] not perish/);
});

test('a singular for a plural is wrong: no fuzzy matching', () => {
  const verse = STARTER_VERSES.find((v) => v.ref === 'Jeremiah 29:11');
  const { stats, items } = check(verse, 'For I know the plan I have for you declares the LORD plans to prosper you and not to harm you plans to give you hope and a future');
  assert.equal(stats.wrong, 1);
  assert.match(picture(items), /\[plans→plan\]/);
});

test('an added word is extra', () => {
  const { stats, items } = check(JOHN_3_16, 'For God so loved the whole world that he gave his one and only Son that whoever believes in him shall not perish but have eternal life');
  assert.equal(stats.extra, 1);
  assert.equal(stats.score, 96);
  assert.match(picture(items), /the \[\+whole\] world/);
});

test('NIV 1984 wording is caught: "acknowledge him" for "submit to him"', () => {
  const { stats, items } = check(PROVERBS_3_5, 'Trust in the Lord with all your heart and lean not on your own understanding in all your ways acknowledge him and he will make your paths straight');
  assert.equal(stats.wrong, 1);
  assert.equal(stats.missing, 1);
  assert.match(picture(items), /ways \[submit→acknowledge\] \[-to\] him/);
});

test('homophones pass in voice mode but not when typed', () => {
  const said = 'For God so loved the world that he gave his one and only sun that whoever believes in him shall not perish but have eternal life';
  const voice = check(JOHN_3_16, said, 'voice');
  assert.ok(voice.stats.perfect);
  const son = voice.items.find((item) => item.text === 'Son');
  assert.equal(son.variant, true);
  assert.equal(son.heard, 'sun');
  const typed = check(JOHN_3_16, said, 'type');
  assert.equal(typed.stats.wrong, 1);
});

test('words written joined or apart match', () => {
  const verse = { ref: 'Romans 10:13', text: 'for, “Everyone who calls on the name of the Lord will be saved.”' };
  assert.ok(check(verse, 'for every one who calls on the name of the Lord will be saved').stats.perfect);
  const apart = { ref: 'Test 1:1', text: 'any one of you' };
  assert.ok(check(apart, 'anyone of you').stats.perfect);
});

test('a spoken reference before and after the verse is not graded', () => {
  for (const said of [
    'John 3:16 For God so loved the world that he gave his one and only Son that whoever believes in him shall not perish but have eternal life John 3:16',
    'John three sixteen for God so loved the world that he gave his one and only Son that whoever believes in him shall not perish but have eternal life',
    'John chapter 3 verse 16 For God so loved the world that he gave his one and only Son that whoever believes in him shall not perish but have eternal life',
    'John 316 For God so loved the world that he gave his one and only Son that whoever believes in him shall not perish but have eternal life',
  ]) {
    const { stats, items } = check(JOHN_3_16, said);
    assert.ok(stats.perfect, said);
    assert.equal(items[0].kind, 'ref', said);
  }
});

test('numbered books and verse ranges are recognized as references', () => {
  const verse = STARTER_VERSES.find((v) => v.ref === '1 John 1:9');
  const { stats } = check(verse, 'First John 1:9 If we confess our sins he is faithful and just and will forgive us our sins and purify us from all unrighteousness 1st John one nine');
  assert.ok(stats.perfect);
  const { stats: range } = check(PROVERBS_3_5, 'Proverbs 3:5 to 6 Trust in the LORD with all your heart and lean not on your own understanding in all your ways submit to him and he will make your paths straight');
  assert.ok(range.perfect);
});

test('reference stripping never eats the first word of the verse', () => {
  const { stats, items } = check(ROMANS_8_28, 'Romans 8:28 and we know that in all things God works for the good of those who love him who have been called according to his purpose');
  assert.ok(stats.perfect);
  assert.equal(items[0].heard, 'Romans 8:28');
  const eccl = { ref: 'Ecclesiastes 4:9', text: 'Two are better than one, because they have a good return for their labor:' };
  assert.ok(check(eccl, 'Ecclesiastes four nine two are better than one because they have a good return for their labor').stats.perfect);
  const words = toUnits('two are better').units.map((u) => u.word);
  assert.deepEqual(findVerseSpan(words, 'Ecclesiastes 4:9'), { start: 0, end: 3 });
});

test('saying nothing gives 0 with every word missing', () => {
  const { stats } = check(JOHN_3_16, '');
  assert.equal(stats.score, 0);
  assert.equal(stats.missing, 26);
});

test('the score only reaches 100 when every word is right', () => {
  const verse = { ref: 'Psalm 119:105', text: Array.from({ length: 300 }, () => 'word').join(' ') };
  const said = Array.from({ length: 299 }, () => 'word').join(' ');
  const { stats } = check(verse, said);
  assert.equal(stats.missing, 1);
  assert.equal(stats.score, 99);
  assert.equal(stats.perfect, false);
});

test('accepting recognition mistakes updates the score', () => {
  const { result, stats } = check(JOHN_3_16, 'For God so loved the world that he gave his one and only Son that whoever believes in him shall not perish but have eternal light');
  assert.equal(stats.wrong, 1);
  const op = result.ops.findIndex((o) => o.type === 'sub');
  const accepted = summarize(result, new Set([op]));
  assert.ok(accepted.perfect);
  assert.equal(accepted.score, 100);
  const item = buildView(result, new Set([op])).find((i) => i.op === op);
  assert.equal(item.accepted, true);
});

test('the view lists verse words in order with extras between them', () => {
  const verse = { ref: 'John 11:35', text: 'Jesus wept.' };
  const { items } = check(verse, 'and Jesus really wept');
  assert.deepEqual(
    items.map((i) => (i.kind === 'word' ? i.text : `+${i.heard}`)),
    ['+and', 'Jesus', '+really', 'wept'],
  );
});

test('a long passage is aligned quickly', () => {
  const words = STARTER_VERSES.map((v) => v.text).join(' ');
  const passage = { ref: 'Test 1:1', text: `${words} ${words} ${words}` };
  const started = Date.now();
  const { stats } = check(passage, passage.text.replace(/\bthe\b/g, 'a'));
  assert.ok(stats.wrong > 0);
  assert.ok(Date.now() - started < 2000);
});
