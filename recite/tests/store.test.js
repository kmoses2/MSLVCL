import test from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../lib/store.js';
import { STARTER_VERSES } from '../lib/starter.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
}

test('a first visit starts with the starter verses', () => {
  const state = store.loadState(memoryStorage());
  assert.equal(state.verses.length, STARTER_VERSES.length);
  assert.ok(state.verses.every((v) => v.starter));
  assert.equal(state.settings.hint, 'hidden');
});

test('state survives a save and load; broken data falls back to a fresh state', () => {
  const storage = memoryStorage();
  let state = store.loadState(storage);
  state = store.upsertVerse(state, { ref: 'John 11:35', text: 'Jesus wept.' }).state;
  assert.ok(store.saveState(state, storage));
  assert.equal(store.loadState(storage).verses.length, STARTER_VERSES.length + 1);

  storage.setItem(store.STORAGE_KEY, '{not json');
  assert.equal(store.loadState(storage).verses.length, STARTER_VERSES.length);
  assert.equal(store.saveState(state, { setItem: () => { throw new Error('quota'); } }), false);
});

test('upsert, remove and attempts', () => {
  let state = store.createInitialState(0);
  const added = store.upsertVerse(state, { ref: 'John 11:35', text: 'Jesus wept.', tag: '짧은 구절' }, 10);
  state = added.state;
  state = store.upsertVerse(state, { id: added.id, ref: 'John 11:35', text: 'Jesus wept.', tag: '' }, 20).state;
  assert.equal(store.getVerse(state, added.id).updatedAt, 20);
  assert.equal(store.getVerse(state, added.id).tag, '');

  for (let i = 0; i < 50; i++) state = store.addAttempt(state, added.id, { at: i, score: 50, perfect: false });
  assert.equal(state.attempts[added.id].length, 40);
  state = store.updateAttempt(state, added.id, 49, { score: 100, perfect: true });
  assert.equal(state.attempts[added.id].at(-1).score, 100);

  state = store.removeVerse(state, added.id);
  assert.equal(store.getVerse(state, added.id), null);
  assert.equal(state.attempts[added.id], undefined);
});

test('verseProgress: new, learning, mastered after three perfect in a row', () => {
  assert.equal(store.verseProgress([]).status, 'new');
  const perfect = (at) => ({ at, score: 100, perfect: true });
  const miss = (at) => ({ at, score: 90, perfect: false });
  assert.equal(store.verseProgress([miss(1), perfect(2), perfect(3)]).status, 'learning');
  const done = store.verseProgress([miss(1), perfect(2), perfect(3), perfect(4)]);
  assert.equal(done.status, 'mastered');
  assert.equal(done.streak, 3);
  assert.equal(done.best, 100);
  assert.equal(store.verseProgress([perfect(1), perfect(2), perfect(3), miss(4)]).status, 'learning');
});

test('backup export and import merge without duplicates', () => {
  let phone = store.createInitialState(0);
  const added = store.upsertVerse(phone, { ref: 'John 11:35', text: 'Jesus wept.' }, 5);
  phone = store.addAttempt(added.state, added.id, { at: 1, score: 100, perfect: true });
  const backup = store.exportState(phone);

  let laptop = store.createInitialState(0);
  laptop = store.addAttempt(laptop, 'starter-jn-3-16', { at: 2, score: 80, perfect: false });
  const merged = store.importState(laptop, backup);
  assert.equal(merged.added, 1);
  assert.equal(merged.state.attempts[added.id].length, 1);
  assert.equal(merged.state.attempts['starter-jn-3-16'].length, 1);

  const again = store.importState(merged.state, backup);
  assert.equal(again.added, 0);
  assert.equal(again.state.attempts[added.id].length, 1);

  assert.throws(() => store.importState(laptop, 'nope'), /JSON/);
  assert.throws(() => store.importState(laptop, '{"hello":1}'), /백업 파일이 아니에요/);
});

test('restoreStarters puts deleted starter verses back', () => {
  let state = store.createInitialState(0);
  state = store.removeVerse(state, 'starter-jn-3-16');
  const restored = store.restoreStarters(state);
  assert.equal(restored.added, 1);
  assert.ok(store.getVerse(restored.state, 'starter-jn-3-16'));
  assert.equal(store.restoreStarters(restored.state).added, 0);
});

test('Korean text is kept and tracked by version', () => {
  const storage = memoryStorage();
  let state = store.createInitialState(0);
  const added = store.upsertVerse(state, { ref: 'John 11:35', text: 'Jesus wept.', ko: '예수께서 눈물을 흘리시더라', koVersion: 0 });
  state = store.setVerseKorean(added.state, 'starter-jn-3-16', '하나님이 세상을 이처럼 사랑하사', 88);
  assert.ok(store.saveState(state, storage));
  const loaded = store.loadState(storage);
  assert.equal(store.getVerse(loaded, added.id).ko, '예수께서 눈물을 흘리시더라');
  assert.equal(store.getVerse(loaded, 'starter-jn-3-16').koVersion, 88);

  const need88 = store.versesNeedingKorean(loaded, 88).map((v) => v.id);
  assert.ok(!need88.includes('starter-jn-3-16'), 'already has version 88');
  assert.ok(!need88.includes(added.id), 'hand-typed Korean is kept');
  assert.ok(need88.includes('starter-ro-8-28'), 'missing Korean is fetched');
  assert.ok(store.versesNeedingKorean(loaded, 142).map((v) => v.id).includes('starter-jn-3-16'), 'another version replaces fetched text');

  const edited = store.upsertVerse(loaded, { id: added.id, ref: 'John 11:35', text: 'Jesus wept.' });
  assert.equal(store.getVerse(edited.state, added.id).ko, '예수께서 눈물을 흘리시더라', 'editing without ko keeps it');
});
