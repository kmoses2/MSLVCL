import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchNivPassage, fetchPassage, KNOWN_KOREAN_VERSIONS, listKoreanVersions, NIV_VERSION_ID, PassageError, preferredKoreanVersion } from '../lib/youversion.js';

function fakeFetch(status, body, calls = []) {
  return async (url, options) => {
    calls.push({ url, options });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
}

test('requests the NIV passage as plain text with the app key', async () => {
  const calls = [];
  const result = await fetchNivPassage(' my-key ', 'JHN.3.16', {
    fetchImpl: fakeFetch(200, { id: 'JHN.3.16', reference: 'John 3:16', content: 'For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.' }, calls),
  });
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    `https://api.youversion.com/v1/bibles/${NIV_VERSION_ID}/passages/JHN.3.16?format=text&include_headings=false&include_notes=false`,
  );
  assert.equal(calls[0].options.headers['X-YVP-App-Key'], 'my-key');
  assert.equal(result.reference, 'John 3:16');
  assert.match(result.text, /^For God so loved/);
});

test('verse numbers and stray markup are cleaned from the text', async () => {
  const content = '<p>16&nbsp;For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life. 17&nbsp;For God did not send his Son into the world to condemn the world, but to save the world through him.</p>';
  const { text } = await fetchNivPassage('k', 'JHN.3.16-17', { fetchImpl: fakeFetch(200, { content, reference: 'John 3:16-17' }) });
  assert.equal(
    text,
    'For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life. For God did not send his Son into the world to condemn the world, but to save the world through him.',
  );
  const curly = await fetchNivPassage('k', 'ROM.1.12', { fetchImpl: fakeFetch(200, { content: 'each other&#8217;s faith &amp; hope' }) });
  assert.equal(curly.text, 'each other’s faith & hope');
});

test('errors say what went wrong', async () => {
  for (const [status, code] of [
    [401, 'key'],
    [403, 'license'],
    [404, 'not-found'],
    [500, 'server'],
  ]) {
    await assert.rejects(fetchNivPassage('k', 'JHN.3.16', { fetchImpl: fakeFetch(status, {}) }), (err) => err instanceof PassageError && err.code === code && err.status === status);
  }
  await assert.rejects(
    fetchNivPassage('k', 'JHN.3.16', { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }),
    (err) => err instanceof PassageError && err.code === 'network',
  );
  await assert.rejects(fetchNivPassage('k', 'JHN.3.16', { fetchImpl: fakeFetch(200, { nope: true }) }), (err) => err.code === 'server');
});

test('an aborted request stays an abort', async () => {
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  await assert.rejects(fetchNivPassage('k', 'JHN.3.16', { fetchImpl: async () => { throw abort; } }), (err) => err === abort);
});

test('Korean versions come from the version list', async () => {
  const calls = [];
  const versions = await listKoreanVersions('k', {
    fetchImpl: fakeFetch(200, {
      data: [
        { id: 142, abbreviation: 'RNKSV', localized_abbreviation: '새번역', title: 'Revised New Korean Standard Version', localized_title: '새번역', language_tag: 'ko' },
        { id: 88, abbreviation: 'KRV', localized_abbreviation: 'KRV', title: 'Korean Revised Version', localized_title: '개역한글', language_tag: 'ko', copyright: '© 대한성서공회' },
      ],
    }, calls),
  });
  assert.equal(calls[0].url, 'https://api.youversion.com/v1/bibles?language_ranges[]=ko&page_size=100');
  assert.deepEqual(versions.map((v) => [v.id, v.title]), [[142, '새번역'], [88, '개역한글']]);
  assert.equal(preferredKoreanVersion(versions).id, 88);
  assert.equal(preferredKoreanVersion([{ id: 5, title: '성경전서 개역개정판' }, ...versions]).id, 5);
  assert.equal(preferredKoreanVersion([]), null);
  assert.deepEqual(KNOWN_KOREAN_VERSIONS.map((v) => v.id), [88, 142]);
});

test('fetchPassage asks for the given version', async () => {
  const calls = [];
  const { text } = await fetchPassage('k', 88, 'JHN.3.16', {
    fetchImpl: fakeFetch(200, { content: '16 하나님이 세상을 이처럼 사랑하사 독생자를 주셨으니', reference: '요한복음 3:16' }, calls),
  });
  assert.match(calls[0].url, /\/bibles\/88\/passages\/JHN\.3\.16\?format=text/);
  assert.equal(text, '하나님이 세상을 이처럼 사랑하사 독생자를 주셨으니');
});
