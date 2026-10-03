// Cleans verse text pasted from Bible apps and websites: verse numbers,
// footnote letters, links, "John 3:16 NIV" lines and copyright footers.

import { formatReference, parseReference } from './books.js';

const SECTION_BREAK = /^\s*(footnotes|cross references|read full chapter)\s*:?\s*$/i;
const NOISE_LINE = /^\s*(new international version.*|holy bible.*|scripture quotations.*|.*copyright\b.*|.*\bbiblica\b.*|\(?niv\)?|niv®?)\s*$/i;
const REFERENCE_LINE = /^\s*[—–-]?\s*((?:[1-3]\s*)?[\p{L}][\p{L} .]*?\s*\d+(?:\s*:\s*\d+(?:\s*[-–]\s*\d+)?)?)\s*(?:\(?\s*NIV\s*\)?)?\s*$/iu;
const TRAILING_REFERENCE = /\s+[—–-]?\s*((?:[1-3]\s*)?[A-Z][a-z]+(?:\s+(?:of\s+)?[A-Z][a-z]+)*\.?\s+\d+:\d+(?:\s*[-–]\s*\d+)?)\s*(?:\(?\s*NIV\s*\)?)?\s*$/u;

function asReference(text) {
  const ref = parseReference(text);
  return ref?.book && ref.verse != null ? formatReference(text) : '';
}

/** Returns { text, reference }; reference is "" unless the paste named one. */
export function cleanPastedVerse(input) {
  let reference = '';
  const kept = [];
  for (const rawLine of String(input ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    if (SECTION_BREAK.test(rawLine)) break; // BibleGateway appends footnotes after the passage
    const line = rawLine.replace(/https?:\/\/\S+/g, ' ');
    if (!line.trim() || NOISE_LINE.test(line)) continue;
    const refLine = REFERENCE_LINE.exec(line);
    if (refLine && asReference(refLine[1])) {
      reference ||= asReference(refLine[1]);
      continue;
    }
    kept.push(line);
  }

  let text = kept.join(' ');
  const trailing = TRAILING_REFERENCE.exec(text);
  if (trailing && asReference(trailing[1])) {
    reference ||= asReference(trailing[1]);
    text = text.slice(0, trailing.index);
  }

  text = text
    .replace(/\[[a-z]{1,2}\]/g, '') // footnotes: [a]
    .replace(/\(\s*[A-Z]{1,3}\s*\)/g, '') // cross references: (A)
    // Verse and chapter numbers: "16 For God", "6in all your ways". Not "1st".
    .replace(/(^|[\s"“‘(])\d{1,3}(?!(?:st|nd|rd|th)\b)(?=\s*[“"‘'(]?\p{L})/gu, '$1')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  // Quotes that open a verse pasted out of a longer speech are usually unbalanced.
  if (/^[“"]/.test(text) && !/[”"]/.test(text.slice(1))) text = text.slice(1).trim();
  return { text, reference };
}
