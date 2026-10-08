// Talks to Firebase through its REST APIs, so there is no SDK to load: each
// device signs in anonymously (Identity Toolkit), and group data lives in
// Firestore documents. Who may read or write what is decided by the security
// rules in firestore.rules, not here.

/**
 * code: 'config' (no or wrong settings), 'anonymous-off' (anonymous sign-in not
 * enabled), 'no-database' (Firestore not created), 'network', 'auth', 'denied',
 * 'not-found', 'exists', 'server'.
 */
export class FirebaseError extends Error {
  constructor(code, status = 0, detail = '') {
    super(`Firebase: ${code}${status ? ` (${status})` : ''}${detail ? ` ${detail}` : ''}`);
    this.code = code;
    this.status = status;
  }
}

const ENDPOINTS = {
  identity: 'https://identitytoolkit.googleapis.com',
  token: 'https://securetoken.googleapis.com',
  firestore: 'https://firestore.googleapis.com',
};

// --- Firestore's typed JSON values ---

export function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: value.length ? { values: value.map(encodeValue) } : {} };
  if (typeof value === 'object') return { mapValue: Object.keys(value).length ? { fields: encodeFields(value) } : {} };
  throw new TypeError(`Firestore can't store ${typeof value}`);
}

export function encodeFields(object) {
  return Object.fromEntries(
    Object.entries(object)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, encodeValue(value)]),
  );
}

export function decodeValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(decodeValue);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields);
  return null;
}

export function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]));
}

const ERROR_CODES = { PERMISSION_DENIED: 'denied', NOT_FOUND: 'not-found', ALREADY_EXISTS: 'exists', UNAUTHENTICATED: 'auth' };

async function failure(response) {
  const data = await response.json().catch(() => null);
  const status = data?.error?.status;
  const message = typeof data?.error?.message === 'string' ? data.error.message : '';
  let code = ERROR_CODES[status] ?? { 401: 'auth', 403: 'denied', 404: 'not-found', 409: 'exists' }[response.status] ?? 'server';
  if (/OPERATION_NOT_ALLOWED|ADMIN_ONLY_OPERATION/.test(message)) code = 'anonymous-off';
  else if (/API key not valid|API_KEY_INVALID|CONFIGURATION_NOT_FOUND/i.test(message)) code = 'config';
  else if (/database \(default\) does not exist|SERVICE_DISABLED|has not been used in project/i.test(message)) code = 'no-database';
  else if (response.status === 400 && /TOKEN|USER_NOT_FOUND|USER_DISABLED/.test(message)) code = 'auth';
  return new FirebaseError(code, response.status, message);
}

/**
 * config: { apiKey, projectId, endpoints? } (endpoints point at the emulators in tests).
 * The anonymous account is kept in storage, so a device keeps the same uid.
 */
export function createFirebase(config, { storage = globalThis.localStorage, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  const apiKey = String(config?.apiKey ?? '').trim();
  const projectId = String(config?.projectId ?? '').trim();
  const endpoints = { ...ENDPOINTS, ...config?.endpoints };
  const sessionKey = `niv-recite/firebase/${projectId}`;
  const documents = `projects/${projectId}/databases/(default)/documents`;
  let session = null;
  let pending = null;

  const configured = () => Boolean(apiKey && projectId);

  function readSession() {
    if (session) return session;
    try {
      const saved = JSON.parse(storage?.getItem(sessionKey) ?? 'null');
      if (saved?.uid && saved.refreshToken) session = saved;
    } catch {
      // unreadable: sign in again
    }
    return session;
  }

  function keepSession(next) {
    session = next;
    try {
      storage?.setItem(sessionKey, JSON.stringify(next));
    } catch {
      // storage blocked: the session lasts until the page closes
    }
    return next;
  }

  async function post(url, body, form = false) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
        body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
      });
    } catch {
      throw new FirebaseError('network');
    }
    if (!response.ok) throw await failure(response);
    return response.json();
  }

  async function signUp() {
    const data = await post(`${endpoints.identity}/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`, { returnSecureToken: true });
    if (!data?.idToken || !data.localId) throw new FirebaseError('auth');
    return keepSession({ uid: data.localId, idToken: data.idToken, refreshToken: data.refreshToken, expiresAt: now() + Number(data.expiresIn || 3600) * 1000 });
  }

  async function refresh(old) {
    const data = await post(`${endpoints.token}/v1/token?key=${encodeURIComponent(apiKey)}`, { grant_type: 'refresh_token', refresh_token: old.refreshToken }, true);
    if (!data?.id_token) throw new FirebaseError('auth');
    return keepSession({ uid: data.user_id || old.uid, idToken: data.id_token, refreshToken: data.refresh_token || old.refreshToken, expiresAt: now() + Number(data.expires_in || 3600) * 1000 });
  }

  /** A valid session, signing in or refreshing when needed (one request at a time). */
  async function signIn() {
    if (!configured()) throw new FirebaseError('config');
    const current = readSession();
    if (current?.idToken && current.expiresAt - 60_000 > now()) return current;
    pending ??= (async () => {
      try {
        if (current?.refreshToken) {
          try {
            return await refresh(current);
          } catch (err) {
            // A revoked account needs a new one; anything else (offline) keeps the old one.
            if (err.code !== 'auth') throw err;
          }
        }
        return await signUp();
      } finally {
        pending = null;
      }
    })();
    return pending;
  }

  async function call(method, url, body, retried = false) {
    const { idToken } = await signIn();
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new FirebaseError('network');
    }
    if (response.status === 401 && !retried) {
      session = { ...session, expiresAt: 0 };
      return call(method, url, body, true);
    }
    if (!response.ok) throw await failure(response);
    return response.json().catch(() => ({}));
  }

  const docUrl = (path) => `${endpoints.firestore}/v1/${documents}/${path}`;

  return {
    configured,
    signIn,
    /** This device's anonymous user id, once signed in. */
    uid: () => readSession()?.uid ?? '',

    /** The document's fields, or null when it doesn't exist. */
    async get(path) {
      try {
        return decodeFields((await call('GET', docUrl(path))).fields);
      } catch (err) {
        if (err.code === 'not-found') return null;
        throw err;
      }
    },

    /** Every document in a collection: [{ id, data }]. */
    async list(path) {
      const out = [];
      let pageToken = '';
      do {
        const data = await call('GET', `${docUrl(path)}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
        for (const doc of data.documents ?? []) out.push({ id: doc.name.split('/').pop(), data: decodeFields(doc.fields) });
        pageToken = data.nextPageToken ?? '';
      } while (pageToken && out.length < 3000);
      return out;
    },

    /** Creates or replaces a whole document. */
    async set(path, data) {
      await call('PATCH', docUrl(path), { fields: encodeFields(data) });
    },

    /** Changes only the given top-level fields of an existing document. */
    async update(path, data) {
      const mask = Object.keys(data)
        .map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
        .join('&');
      await call('PATCH', `${docUrl(path)}?${mask}&currentDocument.exists=true`, { fields: encodeFields(data) });
    },

    async remove(path) {
      await call('DELETE', docUrl(path));
    },

    /** Writes several documents at once, all or none. writes: [{ path, data, create }] */
    async commit(writes) {
      await call('POST', `${endpoints.firestore}/v1/${documents}:commit`, {
        writes: writes.map(({ path, data, create }) => ({
          update: { name: `${documents}/${path}`, fields: encodeFields(data) },
          ...(create ? { currentDocument: { exists: false } } : {}),
        })),
      });
    },
  };
}
