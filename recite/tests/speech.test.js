import test from 'node:test';
import assert from 'node:assert/strict';
import { createListener, mergeSegments } from '../lib/speech.js';

test('mergeSegments joins segments and collapses Android-style repeats', () => {
  assert.equal(mergeSegments(['For God so loved', ' the world']), 'For God so loved the world');
  assert.equal(mergeSegments(['for God', 'for God so loved', 'for God so loved the world']), 'for God so loved the world');
  assert.equal(mergeSegments(['', '  ', 'amen']), 'amen');
});

// A stand-in for the browser's SpeechRecognition.
class FakeRecognition {
  static instances = [];
  constructor() {
    FakeRecognition.instances.push(this);
    this.started = false;
  }
  start() {
    this.started = true;
  }
  stop() {
    queueMicrotask(() => this.onend?.());
  }
  abort() {
    this.aborted = true;
  }
  say(...segments) {
    const results = segments.map(([text, isFinal]) => Object.assign([{ transcript: text }], { isFinal }));
    this.onresult?.({ results });
  }
}

test('the listener keeps text across automatic restarts and reports it on stop', async () => {
  FakeRecognition.instances = [];
  globalThis.webkitSpeechRecognition = FakeRecognition;
  const updates = [];
  const ended = new Promise((resolve) => {
    const listener = createListener({
      onText: (text) => updates.push(text),
      onEnd: (text, error) => resolve({ text, error }),
    });
    listener.start();
    const first = FakeRecognition.instances[0];
    assert.equal(first.lang, 'en-US');
    assert.equal(first.continuous, true);
    first.say(['For God so', true], [' loved the world', false]);
    first.onend(); // the browser stopped by itself after a pause
    const second = FakeRecognition.instances[1];
    assert.ok(second?.started, 'listener restarted');
    second.say(['that he gave', true]);
    listener.stop();
  });
  const { text, error } = await ended;
  assert.equal(text, 'For God so loved the world that he gave');
  assert.equal(error, null);
  assert.equal(updates.at(-1), 'For God so loved the world that he gave');
  delete globalThis.webkitSpeechRecognition;
});

test('a permission error ends listening with the error code', async () => {
  FakeRecognition.instances = [];
  globalThis.webkitSpeechRecognition = FakeRecognition;
  const { text, error } = await new Promise((resolve) => {
    createListener({ onEnd: (t, e) => resolve({ text: t, error: e }) }).start();
    const r = FakeRecognition.instances[0];
    r.onerror({ error: 'not-allowed' });
    r.onend();
  });
  assert.equal(text, '');
  assert.equal(error, 'not-allowed');
  assert.equal(FakeRecognition.instances.length, 1, 'no restart after a fatal error');
  delete globalThis.webkitSpeechRecognition;
});
