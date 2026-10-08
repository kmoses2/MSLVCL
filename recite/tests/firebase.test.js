import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirebase, decodeFields, encodeFields, FirebaseError } from '../lib/firebase.js';

function memoryStorage() {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)) };
}

const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/** A fetch that answers from a list of [match, status, body] and records every call. */
function fakeFetch(routes, calls = []) {
  return async (url, options = {}) => {
    calls.push({ url, ...options });
    const found = routes.find(([match]) => url.includes(match));
    if (!found) throw new TypeError('offline');
    const [, status, body] = found;
    return response(status, typeof body === 'function' ? body(url, options) : body);
  };
}

const SIGN_UP = ['accounts:signUp', 200, { idToken: 'id-1', refreshToken: 'refresh-1', expiresIn: '3600', localId: 'user-1' }];

test('Firestore values round-trip', () => {
  const data = { name: '목요 암송', count: 3, ratio: 0.5, ok: true, none: null, weeks: [{ start: '2026-10-12', ref: 'John 1:1' }], empty: [], results: {} };
  const fields = encodeFields(data);
  assert.deepEqual(fields.count, { integerValue: '3' });
  assert.deepEqual(fields.empty, { arrayValue: {} });
  assert.deepEqual(fields.results, { mapValue: {} });
  assert.deepEqual(decodeFields(fields), data);
  assert.deepEqual(encodeFields({ skip: undefined }), {});
});

test('signs in anonymously once and keeps the account', async () => {
  const calls = [];
  const storage = memoryStorage();
  const fb = createFirebase({ apiKey: 'key-1', projectId: 'proj' }, { storage, fetchImpl: fakeFetch([SIGN_UP], calls) });
  const [a, b] = await Promise.all([fb.signIn(), fb.signIn()]);
  assert.equal(a.uid, 'user-1');
  assert.equal(b.uid, 'user-1');
  assert.equal(calls.length, 1, 'one sign-up for both callers');
  assert.equal(calls[0].url, 'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=key-1');
  assert.deepEqual(JSON.parse(calls[0].body), { returnSecureToken: true });

  const again = createFirebase({ apiKey: 'key-1', projectId: 'proj' }, { storage, fetchImpl: fakeFetch([], calls) });
  assert.equal(again.uid(), 'user-1', 'the same device keeps its uid');
  assert.equal((await again.signIn()).idToken, 'id-1');
  assert.equal(calls.length, 1);
});

test('an expired token is refreshed; offline keeps the account', async () => {
  let clock = 0;
  const storage = memoryStorage();
  const calls = [];
  const routes = [SIGN_UP, ['securetoken', 200, { id_token: 'id-2', refresh_token: 'refresh-2', expires_in: '3600', user_id: 'user-1' }]];
  const fb = createFirebase({ apiKey: 'k', projectId: 'p' }, { storage, fetchImpl: fakeFetch(routes, calls), now: () => clock });
  await fb.signIn();
  clock = 3600 * 1000;
  assert.equal((await fb.signIn()).idToken, 'id-2');
  assert.match(calls[1].body, /grant_type=refresh_token&refresh_token=refresh-1/);
  assert.equal(calls[1].headers['Content-Type'], 'application/x-www-form-urlencoded');

  clock *= 2;
  const offline = createFirebase({ apiKey: 'k', projectId: 'p' }, { storage, fetchImpl: fakeFetch([]), now: () => clock });
  await assert.rejects(offline.signIn(), (err) => err instanceof FirebaseError && err.code === 'network');
  assert.equal(offline.uid(), 'user-1');
});

test('setup problems get their own codes', async () => {
  const cases = [
    [{ error: { code: 400, message: 'ADMIN_ONLY_OPERATION', status: 'INVALID_ARGUMENT' } }, 400, 'anonymous-off'],
    [{ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }, 400, 'config'],
  ];
  for (const [body, status, code] of cases) {
    const fb = createFirebase({ apiKey: 'k', projectId: 'p' }, { storage: memoryStorage(), fetchImpl: fakeFetch([['accounts:signUp', status, body]]) });
    await assert.rejects(fb.signIn(), (err) => err.code === code, code);
  }
  await assert.rejects(createFirebase({ apiKey: '', projectId: '' }).signIn(), (err) => err.code === 'config');

  const noDatabase = createFirebase(
    { apiKey: 'k', projectId: 'p' },
    {
      storage: memoryStorage(),
      fetchImpl: fakeFetch([SIGN_UP, ['firestore', 404, { error: { code: 404, message: 'The database (default) does not exist for project p', status: 'NOT_FOUND' } }]]),
    },
  );
  await assert.rejects(noDatabase.get('groups/g'), (err) => err.code === 'no-database');
});

test('documents: get, list, set, update, commit', async () => {
  const calls = [];
  const docs = 'https://firestore.googleapis.com/v1/projects/proj/databases/(default)/documents';
  const routes = [
    SIGN_UP,
    ['groups/missing', 404, { error: { code: 404, status: 'NOT_FOUND', message: 'No document' } }],
    ['groups/denied', 403, { error: { code: 403, status: 'PERMISSION_DENIED', message: 'Missing or insufficient permissions.' } }],
    ['/members?pageSize', 200, (url) =>
      url.includes('pageToken')
        ? { documents: [{ name: 'projects/proj/databases/(default)/documents/groups/g/members/u2', fields: encodeFields({ name: '김철수' }) }] }
        : { documents: [{ name: 'projects/proj/databases/(default)/documents/groups/g/members/u1', fields: encodeFields({ name: '구모세' }) }], nextPageToken: 'next' }],
    [':commit', 200, {}],
    ['groups/g', 200, { name: 'projects/proj/databases/(default)/documents/groups/g', fields: encodeFields({ name: '목요 암송', weeks: [] }) }],
  ];
  const fb = createFirebase({ apiKey: 'k', projectId: 'proj' }, { storage: memoryStorage(), fetchImpl: fakeFetch(routes, calls) });

  assert.deepEqual(await fb.get('groups/g'), { name: '목요 암송', weeks: [] });
  assert.equal(calls.at(-1).headers.Authorization, 'Bearer id-1');
  assert.equal(await fb.get('groups/missing'), null);
  await assert.rejects(fb.get('groups/denied'), (err) => err.code === 'denied');

  assert.deepEqual((await fb.list('groups/g/members')).map((d) => [d.id, d.data.name]), [['u1', '구모세'], ['u2', '김철수']]);

  await fb.update('groups/g', { weeks: [{ start: '2026-10-12', ref: 'John 1:1' }], updatedAt: 5 });
  assert.equal(calls.at(-1).method, 'PATCH');
  assert.equal(calls.at(-1).url, `${docs}/groups/g?updateMask.fieldPaths=weeks&updateMask.fieldPaths=updatedAt&currentDocument.exists=true`);

  await fb.set('groups/g/members/u1', { name: '구모세', joinedAt: 1, results: {} });
  assert.equal(calls.at(-1).url, `${docs}/groups/g/members/u1`);

  await fb.commit([{ path: 'groups/g', data: { name: 'x' }, create: true }, { path: 'secrets/g', data: { code: 'ABCDEFGHJK' } }]);
  const body = JSON.parse(calls.at(-1).body);
  assert.equal(calls.at(-1).url, `${docs}:commit`);
  assert.equal(body.writes[0].update.name, 'projects/proj/databases/(default)/documents/groups/g');
  assert.deepEqual(body.writes[0].currentDocument, { exists: false });
  assert.equal(body.writes[1].currentDocument, undefined);
});

test('a rejected token is refreshed once and the request retried', async () => {
  let first = true;
  const calls = [];
  const routes = [
    SIGN_UP,
    ['securetoken', 200, { id_token: 'id-2', refresh_token: 'refresh-2', expires_in: '3600', user_id: 'user-1' }],
  ];
  const fetchImpl = async (url, options) => {
    if (url.includes('firestore')) {
      calls.push(options.headers.Authorization);
      if (first) {
        first = false;
        return response(401, { error: { status: 'UNAUTHENTICATED' } });
      }
      return response(200, { fields: encodeFields({ name: 'ok' }) });
    }
    return fakeFetch(routes)(url, options);
  };
  const fb = createFirebase({ apiKey: 'k', projectId: 'p' }, { storage: memoryStorage(), fetchImpl });
  assert.deepEqual(await fb.get('groups/g'), { name: 'ok' });
  assert.deepEqual(calls, ['Bearer id-1', 'Bearer id-2']);
});
