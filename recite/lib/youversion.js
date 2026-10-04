// Fetches NIV text from the YouVersion Platform API, which licenses Bible text
// to apps for free non-commercial use. It needs an app key from
// platform.youversion.com with the NIV (version 111) allowed for that app.
// Request format taken from YouVersion's own SDK (@youversion/platform-core).

import { cleanPastedVerse } from './cleanup.js';

export const NIV_VERSION_ID = 111;
const API = 'https://api.youversion.com/v1';

/** code: 'key' (401), 'license' (403), 'not-found' (404), 'network', 'server'. */
export class PassageError extends Error {
  constructor(code, status = 0) {
    super(`YouVersion: ${code}${status ? ` (${status})` : ''}`);
    this.code = code;
    this.status = status;
  }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

// format=text should already be plain; strip any markup that slips through.
function plainText(content) {
  return content
    .replace(/<(?:br|\/p|\/div)[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, body) => {
      if (body[0] !== '#') return ENTITIES[body.toLowerCase()] ?? entity;
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
    });
}

/**
 * Returns { text, reference } for a USFM passage id such as "JHN.3.16-17".
 * Throws PassageError; an aborted request rejects with the AbortError.
 */
export async function fetchNivPassage(appKey, id, { signal, fetchImpl = globalThis.fetch } = {}) {
  const url = `${API}/bibles/${NIV_VERSION_ID}/passages/${id}?format=text&include_headings=false&include_notes=false`;
  let response;
  try {
    response = await fetchImpl(url, { headers: { Accept: 'application/json', 'X-YVP-App-Key': String(appKey).trim() }, signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new PassageError('network');
  }
  if (!response.ok) {
    const code = { 401: 'key', 403: 'license', 404: 'not-found' }[response.status] ?? 'server';
    throw new PassageError(code, response.status);
  }
  const data = await response.json().catch(() => null);
  if (typeof data?.content !== 'string') throw new PassageError('server', response.status);
  return { text: cleanPastedVerse(plainText(data.content)).text, reference: typeof data.reference === 'string' ? data.reference : '' };
}
