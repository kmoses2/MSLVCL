// Books of the Bible with their Korean (개역개정) names and common abbreviations,
// plus a parser for references such as "John 3:16", "1 Jn 1:9" or "요 3:16".

import { numberToWords, ordinalWords } from './text.js';
import { VERSIFICATION } from './versification.js';

// [English name, Korean name, Korean abbreviation, English abbreviations...]
const BOOK_TABLE = [
  ['Genesis', '창세기', '창', 'gen', 'ge', 'gn'],
  ['Exodus', '출애굽기', '출', 'exod', 'ex', 'exo'],
  ['Leviticus', '레위기', '레', 'lev', 'le', 'lv'],
  ['Numbers', '민수기', '민', 'num', 'nu', 'nm', 'nb'],
  ['Deuteronomy', '신명기', '신', 'deut', 'dt', 'de'],
  ['Joshua', '여호수아', '수', 'josh', 'jos', 'jsh'],
  ['Judges', '사사기', '삿', 'judg', 'jdg', 'jg', 'jdgs'],
  ['Ruth', '룻기', '룻', 'ru', 'rth'],
  ['1 Samuel', '사무엘상', '삼상', '1sam', '1sa', '1sm'],
  ['2 Samuel', '사무엘하', '삼하', '2sam', '2sa', '2sm'],
  ['1 Kings', '열왕기상', '왕상', '1kgs', '1ki', '1kin'],
  ['2 Kings', '열왕기하', '왕하', '2kgs', '2ki', '2kin'],
  ['1 Chronicles', '역대상', '대상', '1chr', '1ch', '1chron'],
  ['2 Chronicles', '역대하', '대하', '2chr', '2ch', '2chron'],
  ['Ezra', '에스라', '스', 'ezr'],
  ['Nehemiah', '느헤미야', '느', 'neh', 'ne'],
  ['Esther', '에스더', '에', 'esth', 'est', 'es'],
  ['Job', '욥기', '욥', 'jb'],
  ['Psalms', '시편', '시', 'psalm', 'ps', 'psa', 'psm', 'pss'],
  ['Proverbs', '잠언', '잠', 'prov', 'pr', 'prv', 'pro'],
  ['Ecclesiastes', '전도서', '전', 'eccl', 'ecc', 'ec', 'eccles', 'qoh'],
  ['Song of Songs', '아가', '아', 'song', 'sos', 'songofsolomon', 'canticles'],
  ['Isaiah', '이사야', '사', 'isa', 'is'],
  ['Jeremiah', '예레미야', '렘', 'jer', 'je', 'jr'],
  ['Lamentations', '예레미야애가', '애', 'lam', 'la'],
  ['Ezekiel', '에스겔', '겔', 'ezek', 'eze', 'ezk'],
  ['Daniel', '다니엘', '단', 'dan', 'da', 'dn'],
  ['Hosea', '호세아', '호', 'hos', 'ho'],
  ['Joel', '요엘', '욜', 'joe', 'jl'],
  ['Amos', '아모스', '암', 'am'],
  ['Obadiah', '오바댜', '옵', 'obad', 'ob'],
  ['Jonah', '요나', '욘', 'jon', 'jnh'],
  ['Micah', '미가', '미', 'mic', 'mc'],
  ['Nahum', '나훔', '나', 'nah', 'na'],
  ['Habakkuk', '하박국', '합', 'hab', 'hb'],
  ['Zephaniah', '스바냐', '습', 'zeph', 'zep', 'zp'],
  ['Haggai', '학개', '학', 'hag', 'hg'],
  ['Zechariah', '스가랴', '슥', 'zech', 'zec', 'zc'],
  ['Malachi', '말라기', '말', 'mal', 'ml'],
  ['Matthew', '마태복음', '마', 'matt', 'mt', 'mat'],
  ['Mark', '마가복음', '막', 'mrk', 'mk', 'mr'],
  ['Luke', '누가복음', '눅', 'luk', 'lk'],
  ['John', '요한복음', '요', 'jn', 'jhn', 'joh'],
  ['Acts', '사도행전', '행', 'act', 'ac'],
  ['Romans', '로마서', '롬', 'rom', 'ro', 'rm'],
  ['1 Corinthians', '고린도전서', '고전', '1cor', '1co'],
  ['2 Corinthians', '고린도후서', '고후', '2cor', '2co'],
  ['Galatians', '갈라디아서', '갈', 'gal', 'ga'],
  ['Ephesians', '에베소서', '엡', 'eph', 'ephes'],
  ['Philippians', '빌립보서', '빌', 'phil', 'php', 'pp'],
  ['Colossians', '골로새서', '골', 'col', 'co'],
  ['1 Thessalonians', '데살로니가전서', '살전', '1thess', '1th', '1thes'],
  ['2 Thessalonians', '데살로니가후서', '살후', '2thess', '2th', '2thes'],
  ['1 Timothy', '디모데전서', '딤전', '1tim', '1ti', '1tm'],
  ['2 Timothy', '디모데후서', '딤후', '2tim', '2ti', '2tm'],
  ['Titus', '디도서', '딛', 'tit', 'ti'],
  ['Philemon', '빌레몬서', '몬', 'philem', 'phm', 'pm'],
  ['Hebrews', '히브리서', '히', 'heb'],
  ['James', '야고보서', '약', 'jas', 'jm'],
  ['1 Peter', '베드로전서', '벧전', '1pet', '1pe', '1pt', '1p'],
  ['2 Peter', '베드로후서', '벧후', '2pet', '2pe', '2pt', '2p'],
  ['1 John', '요한일서', '요일', '1jn', '1jo', '1joh', '1jhn', '1j'],
  ['2 John', '요한이서', '요이', '2jn', '2jo', '2joh', '2jhn', '2j'],
  ['3 John', '요한삼서', '요삼', '3jn', '3jo', '3joh', '3jhn', '3j'],
  ['Jude', '유다서', '유', 'jud', 'jd'],
  ['Revelation', '요한계시록', '계', 'rev', 're', 'revelations'],
];

// Extra words people say aloud for a book name.
const SPOKEN_ALIASES = {
  Psalms: ['psalm'],
  'Song of Songs': ['solomon'],
  Revelation: ['revelations'],
};

// verses[c - 1] is the number of verses in chapter c.
export const BOOKS = BOOK_TABLE.map(([en, ko, koAbbr, ...abbr], i) => ({
  en,
  ko,
  koAbbr,
  abbr,
  testament: i < 39 ? 'old' : 'new',
  usfm: VERSIFICATION[i].usfm,
  verses: VERSIFICATION[i].verses,
}));

function bookKey(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/^(first|1st|i)\s+/, '1')
    .replace(/^(second|2nd|ii)\s+/, '2')
    .replace(/^(third|3rd|iii)\s+/, '3')
    .replace(/[\s.]/g, '');
}

const BOOK_INDEX = new Map();
for (const book of BOOKS) {
  for (const name of [book.en, book.ko, book.koAbbr, ...book.abbr]) {
    const key = bookKey(name);
    if (!BOOK_INDEX.has(key)) BOOK_INDEX.set(key, book);
  }
}

export function findBook(name) {
  return BOOK_INDEX.get(bookKey(name)) ?? null;
}

// book, then "3:16", "3:16-18", "3장 16절", "3", "3장", or for one-chapter books "24", "24-25".
const REFERENCE_RE =
  /^\s*(.+?)\s*(\d+)\s*(?:(?:[:：.]|장)\s*(\d+)\s*절?\s*(?:[-–—~]\s*(\d+)\s*절?)?|절?\s*[-–—~]\s*(\d+)\s*절?|장|절)?\s*$/u;

/**
 * Parses "John 3:16", "Proverbs 3:5-6", "요한복음 3장 16절", "요 3:16" or "Jude 24".
 * Returns null when the text does not look like a reference.
 */
export function parseReference(text) {
  const match = REFERENCE_RE.exec(String(text ?? ''));
  if (!match) return null;
  const [, bookText, first, verseText, endText, rangeEnd] = match;
  const book = findBook(bookText);
  let chapter = Number(first);
  let verse = verseText ? Number(verseText) : null;
  let verseEnd = endText ? Number(endText) : null;
  if (book && book.verses.length === 1 && verse == null) {
    // Obadiah, Philemon, 2–3 John and Jude have one chapter: "Jude 24" is verse 24.
    verse = chapter;
    verseEnd = rangeEnd ? Number(rangeEnd) : null;
    chapter = 1;
  } else if (rangeEnd) {
    return null; // chapter ranges are not supported
  }
  if (verseEnd === verse) verseEnd = null;
  return {
    bookText: bookText.trim(),
    book,
    chapter,
    verse,
    verseEnd,
    numbers: [chapter, verse, verseEnd].filter((n) => n != null),
  };
}

// 은/는: whether the last Hangul syllable has a final consonant.
function topic(word) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code < 11172 && code % 28 !== 0 ? `${word}은` : `${word}는`;
}

/** Why the reference does not exist in the NIV, or "" (also "" for unknown books). */
export function referenceProblem(text) {
  const ref = parseReference(text);
  if (!ref?.book) return '';
  const { book, chapter, verse, verseEnd } = ref;
  if (chapter < 1 || chapter > book.verses.length) return `${topic(book.ko)} ${book.verses.length}장까지 있어요.`;
  const last = book.verses[chapter - 1];
  if ((verse != null && (verse < 1 || verse > last)) || (verseEnd != null && verseEnd > last)) {
    return `${book.ko} ${chapter}장은 ${last}절까지 있어요.`;
  }
  if (verseEnd != null && verseEnd < verse) return '끝 절이 시작 절보다 앞에 있어요.';
  return '';
}

/** Link that opens the passage in the NIV on bible.com (or the Bible app), or "". */
export function bibleComUrl(text) {
  const ref = parseReference(text);
  if (!ref?.book || referenceProblem(text)) return '';
  let passage = `${ref.book.usfm}.${ref.chapter}`;
  if (ref.verse != null) passage += `.${ref.verse}${ref.verseEnd != null ? `-${ref.verseEnd}` : ''}`;
  return `https://www.bible.com/bible/111/${passage}.NIV`;
}

function formatNumbers(ref) {
  let out = String(ref.chapter);
  if (ref.verse != null) out += `:${ref.verse}`;
  if (ref.verseEnd != null) out += `-${ref.verseEnd}`;
  return out;
}

/** "jn 3:16" -> "John 3:16". Unknown books keep the text as typed. */
export function formatReference(text) {
  const ref = parseReference(text);
  if (!ref) return String(text ?? '').trim();
  // A single psalm is "Psalm 23", the book is "Psalms".
  const name = ref.book ? (ref.book.en === 'Psalms' ? 'Psalm' : ref.book.en) : ref.bookText;
  return `${name} ${formatNumbers(ref)}`;
}

/** "John 3:16" -> "요한복음 3:16", or "" when the book is unknown. */
export function koreanReference(text) {
  const ref = parseReference(text);
  if (!ref?.book) return '';
  return `${ref.book.ko} ${formatNumbers(ref)}`;
}

/** Words someone might say for the book name, e.g. "1 John" -> one, first, john. */
export function spokenBookWords(ref) {
  const name = ref.book ? ref.book.en : ref.bookText;
  const words = [];
  for (const part of name.toLowerCase().split(/\s+/)) {
    if (/^\d+$/.test(part)) words.push(...numberToWords(Number(part)), ...ordinalWords(Number(part)));
    else words.push(part.replace(/[^\p{L}]/gu, ''));
  }
  if (ref.book) words.push(...(SPOKEN_ALIASES[ref.book.en] ?? []));
  return words.filter(Boolean);
}
