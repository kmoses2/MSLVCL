// Speech recognition through the browser's Web Speech API (Chrome, Edge, Safari).

export function getSpeechRecognition() {
  return globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;
}

export function isSpeechSupported() {
  return Boolean(getSpeechRecognition());
}

/**
 * Joins result segments into one transcript. Chrome on Android repeats earlier
 * segments inside later ones ("for God", "for God so loved"), so a segment that
 * starts with the previous one replaces it.
 */
export function mergeSegments(segments) {
  const out = [];
  for (const raw of segments) {
    const text = String(raw ?? '').trim();
    if (!text) continue;
    const previous = out[out.length - 1];
    if (previous !== undefined && text.toLowerCase().startsWith(previous.toLowerCase())) out[out.length - 1] = text;
    else out.push(text);
  }
  return out.join(' ');
}

const MAX_RESTARTS = 40;

/**
 * Listens until stop() is called. Browsers end recognition on their own after a
 * pause or about a minute, so the listener restarts and keeps what was heard.
 *
 * onText(text, interim) fires while listening; onEnd(text, error) fires once.
 */
export function createListener({ lang = 'en-US', onText, onEnd } = {}) {
  const Recognition = getSpeechRecognition();
  if (!Recognition) throw new Error('Speech recognition is not supported in this browser.');

  let finished = [];
  let current = '';
  let wanted = false;
  let error = null;
  let restarts = 0;
  let recognition = null;
  let ended = false;

  const transcript = () => [...finished, current].filter(Boolean).join(' ').trim();

  function finish() {
    if (ended) return;
    ended = true;
    wanted = false;
    onEnd?.(transcript(), error);
  }

  function begin() {
    const r = new Recognition();
    recognition = r;
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    current = '';
    r.onresult = (event) => {
      const parts = [];
      let interim = false;
      for (let i = 0; i < event.results.length; i++) {
        parts.push(event.results[i][0]?.transcript ?? '');
        if (!event.results[i].isFinal) interim = true;
      }
      current = mergeSegments(parts);
      onText?.(transcript(), interim);
    };
    r.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      error = event.error || 'unknown';
      wanted = false;
    };
    r.onend = () => {
      if (r !== recognition) return;
      if (current) finished.push(current);
      current = '';
      if (wanted && !error && restarts < MAX_RESTARTS) {
        restarts++;
        try {
          begin();
          return;
        } catch {
          // fall through and finish with what we have
        }
      }
      finish();
    };
    r.start();
  }

  return {
    start() {
      finished = [];
      current = '';
      error = null;
      restarts = 0;
      ended = false;
      wanted = true;
      try {
        begin();
      } catch (err) {
        error = err?.name === 'NotAllowedError' ? 'not-allowed' : 'start-failed';
        finish();
      }
    },
    /** Stops listening; onEnd fires once the browser has delivered the last words. */
    stop() {
      wanted = false;
      try {
        recognition?.stop();
      } catch {
        finish();
      }
      // Some browsers never fire `end` after stop(); don't leave the user waiting.
      setTimeout(finish, 2500);
    },
    /** Stops without waiting for results (leaving the screen). */
    cancel() {
      wanted = false;
      ended = true;
      try {
        recognition?.abort();
      } catch {
        // already stopped
      }
    },
  };
}
