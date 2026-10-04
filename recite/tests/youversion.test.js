import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchNivPassage, NIV_VERSION_ID, PassageError } from '../lib/youversion.js';

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
