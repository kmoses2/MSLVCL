// Small JSON payloads carried inside a link (#/join/…, #/g/…), as URL-safe
// base64 without padding, so chat apps keep the whole link clickable.

export function encodeLinkData(value) {
  let binary = '';
  for (const byte of new TextEncoder().encode(JSON.stringify(value))) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The payload, or null when the code is broken. */
export function decodeLinkData(code) {
  try {
    const binary = atob(String(code).replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}
