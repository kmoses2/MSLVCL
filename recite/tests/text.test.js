import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalSpelling,
  firstLetters,
  HOMOPHONE_GROUPS,
  normalizeToken,
  numberToWords,
  ordinalWords,
  soundKey,
  tokenize,
  toUnits,
} from '../lib/text.js';

test('tokenize keeps word positions, apostrophes and curly quotes', () => {
  const text = '“For I know,” declares the LORD’s servant.';
  const tokens = tokenize(text);
  assert.deepEqual(
    tokens.map((t) => t.text),
    ['For', 'I', 'know', 'declares', 'the', 'LORD’s', 'servant'],
  );
  for (const t of tokens) assert.equal(text.slice(t.start, t.end), t.text);
});

test('hyphens and dashes separate words', () => {
  assert.deepEqual(
    toUnits('All Scripture is God-breathed—and useful').units.map((u) => u.word),
    ['all', 'scripture', 'is', 'god', 'breathed', 'and', 'useful'],
  );
});

test('normalizeToken lower-cases, drops apostrophes and spells out numbers', () => {
  assert.deepEqual(normalizeToken('LORD’s'), ['lords']);
  assert.deepEqual(normalizeToken("don't"), ['dont']);
  assert.deepEqual(normalizeToken('1'), ['one']);
  assert.deepEqual(normalizeToken('144,000'), ['one', 'hundred', 'forty', 'four', 'thousand']);
  assert.deepEqual(normalizeToken('1st'), ['first']);
  assert.deepEqual(normalizeToken('21st'), ['twenty', 'first']);
  assert.deepEqual(normalizeToken('Éden'), ['eden']);
});

test('numberToWords', () => {
  assert.deepEqual(numberToWords(0), ['zero']);
  assert.deepEqual(numberToWords(13), ['thirteen']);
  assert.deepEqual(numberToWords(40), ['forty']);
  assert.deepEqual(numberToWords(42), ['forty', 'two']);
  assert.deepEqual(numberToWords(119), ['one', 'hundred', 'nineteen']);
  assert.deepEqual(numberToWords(300), ['three', 'hundred']);
  assert.deepEqual(numberToWords(1000), ['one', 'thousand']);
  assert.deepEqual(numberToWords(2500000), ['two', 'million', 'five', 'hundred', 'thousand']);
});

test('ordinalWords', () => {
  assert.deepEqual(ordinalWords(1), ['first']);
  assert.deepEqual(ordinalWords(3), ['third']);
  assert.deepEqual(ordinalWords(12), ['twelfth']);
  assert.deepEqual(ordinalWords(20), ['twentieth']);
  assert.deepEqual(ordinalWords(100), ['one', 'hundredth']);
});

test('each homophone appears in only one group', () => {
  const seen = new Map();
  for (const group of HOMOPHONE_GROUPS) {
    for (const word of group) {
      assert.ok(!seen.has(word), `"${word}" is in [${seen.get(word)}] and [${group}]`);
      seen.set(word, group);
      assert.equal(word, word.toLowerCase().replace(/[^a-z]/g, ''), `"${word}" must be normalized`);
    }
  }
});

test('soundKey joins homophones and spelling variants; canonicalSpelling only spelling', () => {
  assert.equal(soundKey('sun'), soundKey('son'));
  assert.equal(soundKey('two'), soundKey('to'));
  assert.equal(soundKey('thrown'), soundKey('throne'));
  assert.notEqual(soundKey('lead'), soundKey('led'));
  assert.notEqual(soundKey('plans'), soundKey('plan'));
  assert.equal(soundKey('saviour'), soundKey('savior'));
  assert.equal(canonicalSpelling('honour'), 'honor');
  assert.equal(canonicalSpelling('sun'), 'sun');
});

test('firstLetters keeps punctuation', () => {
  assert.equal(firstLetters('Jesus wept. “Come, follow me.”'), 'J w. “C, f m.”');
});
