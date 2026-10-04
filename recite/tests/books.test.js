import test from 'node:test';
import assert from 'node:assert/strict';
import { bibleComUrl, BOOKS, findBook, formatReference, koreanReference, parseReference, passageId, referenceProblem, spokenBookWords } from '../lib/books.js';

test('there are 66 books with distinct names', () => {
  assert.equal(BOOKS.length, 66);
  assert.equal(new Set(BOOKS.map((b) => b.en)).size, 66);
  assert.equal(new Set(BOOKS.map((b) => b.ko)).size, 66);
  assert.equal(new Set(BOOKS.map((b) => b.koAbbr)).size, 66);
});

test('books are found by English, Korean and abbreviated names', () => {
  for (const [name, en] of [
    ['John', 'John'],
    ['jn', 'John'],
    ['요', 'John'],
    ['요한복음', 'John'],
    ['1 John', '1 John'],
    ['1Jn', '1 John'],
    ['I John', '1 John'],
    ['First John', '1 John'],
    ['요일', '1 John'],
    ['Psalm', 'Psalms'],
    ['Ps.', 'Psalms'],
    ['시', 'Psalms'],
    ['Song of Solomon', 'Song of Songs'],
    ['Phil', 'Philippians'],
    ['Phm', 'Philemon'],
    ['Isaiah', 'Isaiah'],
    ['Revelations', 'Revelation'],
    ['고전', '1 Corinthians'],
  ]) {
    assert.equal(findBook(name)?.en, en, name);
  }
  assert.equal(findBook('Hezekiah'), null);
});

test('parseReference reads chapter, verse and range', () => {
  assert.deepEqual(
    { ...parseReference('Proverbs 3:5-6'), book: undefined },
    { bookText: 'Proverbs', book: undefined, chapter: 3, verse: 5, verseEnd: 6, numbers: [3, 5, 6] },
  );
  assert.equal(parseReference('요한복음 3장 16절').verse, 16);
  assert.equal(parseReference('Psalm 23').verse, null);
  assert.equal(parseReference('hello'), null);
});

test('formatReference and koreanReference', () => {
  assert.equal(formatReference('jn 3:16'), 'John 3:16');
  assert.equal(formatReference('요 3:16'), 'John 3:16');
  assert.equal(formatReference('ps 119:11'), 'Psalm 119:11');
  assert.equal(formatReference('1 cor 10:13'), '1 Corinthians 10:13');
  assert.equal(formatReference('My favorite'), 'My favorite');
  assert.equal(koreanReference('1 John 5:11-12'), '요한일서 5:11-12');
  assert.equal(koreanReference('Song of Songs 2:4'), '아가 2:4');
  assert.equal(koreanReference('Unknown 1:1'), '');
});

test('spokenBookWords include number and ordinal forms', () => {
  assert.deepEqual(spokenBookWords(parseReference('1 John 1:9')), ['one', 'first', 'john']);
  assert.deepEqual(spokenBookWords(parseReference('Psalm 23:1')), ['psalms', 'psalm']);
});

test('versification covers the whole Bible in NIV numbering', () => {
  assert.equal(BOOKS.reduce((n, b) => n + b.verses.length, 0), 1189);
  assert.equal(BOOKS.reduce((n, b) => n + b.verses.reduce((a, c) => a + c, 0), 0), 31103);
  const count = (en, chapter) => BOOKS.find((b) => b.en === en).verses[chapter - 1];
  assert.equal(count('Psalms', 119), 176);
  assert.equal(count('John', 3), 36);
  assert.equal(count('3 John', 1), 15); // the NIV splits 3 John 14 into 14–15
  assert.equal(BOOKS.filter((b) => b.testament === 'old').length, 39);
  assert.equal(new Set(BOOKS.map((b) => b.usfm)).size, 66);
});

test('one-chapter books take a bare number as the verse', () => {
  assert.equal(formatReference('Jude 24'), 'Jude 1:24');
  assert.equal(formatReference('Jude 24-25'), 'Jude 1:24-25');
  assert.equal(formatReference('유다서 24절'), 'Jude 1:24');
  assert.equal(formatReference('Philemon 1:6'), 'Philemon 1:6');
  assert.equal(parseReference('John 3-4'), null);
  assert.equal(formatReference('요한복음 3장'), 'John 3');
  assert.equal(formatReference('John 3:16-16'), 'John 3:16');
});

test('referenceProblem explains references that do not exist', () => {
  assert.equal(referenceProblem('John 3:16'), '');
  assert.equal(referenceProblem('John 3:37'), '요한복음 3장은 36절까지 있어요.');
  assert.equal(referenceProblem('John 22:1'), '요한복음은 21장까지 있어요.');
  assert.equal(referenceProblem('Romans 17:1'), '로마서는 16장까지 있어요.');
  assert.equal(referenceProblem('Romans 8:28-27'), '끝 절이 시작 절보다 앞에 있어요.');
  assert.equal(referenceProblem('My favorite'), '');
});

test('bibleComUrl opens the NIV passage', () => {
  assert.equal(bibleComUrl('John 3:16'), 'https://www.bible.com/bible/111/JHN.3.16.NIV');
  assert.equal(bibleComUrl('잠 3:5-6'), 'https://www.bible.com/bible/111/PRO.3.5-6.NIV');
  assert.equal(bibleComUrl('Psalm 23'), 'https://www.bible.com/bible/111/PSA.23.NIV');
  assert.equal(bibleComUrl('1 John 1:9'), 'https://www.bible.com/bible/111/1JN.1.9.NIV');
  assert.equal(bibleComUrl('John 3:37'), '');
  assert.equal(bibleComUrl('My favorite'), '');
});

test('passageId gives USFM ids for valid references only', () => {
  assert.equal(passageId('John 3:16-17'), 'JHN.3.16-17');
  assert.equal(passageId('시 23'), 'PSA.23');
  assert.equal(passageId('Jude 24'), 'JUD.1.24');
  assert.equal(passageId('John 3:37'), '');
  assert.equal(passageId(''), '');
});
