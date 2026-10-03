import test from 'node:test';
import assert from 'node:assert/strict';
import { BOOKS, findBook, formatReference, koreanReference, parseReference, spokenBookWords } from '../lib/books.js';

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
