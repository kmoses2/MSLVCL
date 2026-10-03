import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanPastedVerse } from '../lib/cleanup.js';

test('BibleGateway copy: verse number, footnote and cross-reference marks, footnotes section', () => {
  const pasted = `16 For God so loved the world that he gave his one and only Son,[a] that whoever believes in him shall not perish but have eternal life.(A)

Footnotes
John 3:16 Or his only begotten Son`;
  assert.deepEqual(cleanPastedVerse(pasted), {
    text: 'For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.',
    reference: '',
  });
});

test('multi-verse passage loses its inner verse numbers and a trailing reference', () => {
  const pasted = '5 Trust in the LORD with all your heart and lean not on your own understanding; 6 in all your ways submit to him, and he will make your paths straight.(B) Proverbs 3:5-6 NIV';
  assert.deepEqual(cleanPastedVerse(pasted), {
    text: 'Trust in the LORD with all your heart and lean not on your own understanding; in all your ways submit to him, and he will make your paths straight.',
    reference: 'Proverbs 3:5-6',
  });
});

test('YouVersion share text: reference line and link', () => {
  const pasted = `I can do all this through him who gives me strength.
Philippians 4:13 NIV
https://bible.com/bible/111/php.4.13.NIV`;
  assert.deepEqual(cleanPastedVerse(pasted), {
    text: 'I can do all this through him who gives me strength.',
    reference: 'Philippians 4:13',
  });
});

test('copyright footers are dropped', () => {
  const pasted = `If we confess our sins, he is faithful and just and will forgive us our sins and purify us from all unrighteousness.
New International Version (NIV)
Holy Bible, New International Version®, NIV® Copyright ©1973, 1978, 1984, 2011 by Biblica, Inc.®`;
  assert.equal(
    cleanPastedVerse(pasted).text,
    'If we confess our sins, he is faithful and just and will forgive us our sins and purify us from all unrighteousness.',
  );
});

test('numbers that belong to the text stay', () => {
  assert.equal(cleanPastedVerse('That number is 666.').text, 'That number is 666.');
  assert.equal(cleanPastedVerse('4 Then I heard the number: 144,000 from all the tribes').text, 'Then I heard the number: 144,000 from all the tribes');
  assert.equal(cleanPastedVerse('on the 1st day').text, 'on the 1st day');
});

test('an unbalanced opening quote from a longer speech is removed', () => {
  assert.equal(cleanPastedVerse('“Come to me, all you who are weary').text, 'Come to me, all you who are weary');
  assert.equal(cleanPastedVerse('“Be still.” Then').text, '“Be still.” Then');
});
