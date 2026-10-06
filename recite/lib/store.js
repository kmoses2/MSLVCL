// App state: verses, recitation attempts and settings, kept in localStorage on
// this device only. The functions here return new state objects; app.js saves.

import { STARTER_VERSES } from './starter.js';

export const STORAGE_KEY = 'niv-recite/v1';
const MAX_ATTEMPTS_PER_VERSE = 40;
export const MASTERY_STREAK = 3;

export function createInitialState(now = Date.now()) {
  return {
    version: 1,
    verses: STARTER_VERSES.map((verse, i) => ({ ...verse, starter: true, createdAt: now + i, updatedAt: now + i })),
    attempts: {},
    settings: { hint: 'hidden' },
  };
}

function isVerse(v) {
  return v && typeof v.id === 'string' && typeof v.ref === 'string' && typeof v.text === 'string';
}

function normalizeState(raw) {
  const state = createInitialState();
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.verses)) return null;
  state.verses = raw.verses.filter(isVerse).map((v) => ({
    id: v.id,
    ref: v.ref,
    text: v.text,
    tag: typeof v.tag === 'string' ? v.tag : '',
    ko: typeof v.ko === 'string' ? v.ko : '',
    koVersion: Number.isInteger(v.koVersion) ? v.koVersion : 0,
    starter: Boolean(v.starter),
    createdAt: Number(v.createdAt) || 0,
    updatedAt: Number(v.updatedAt) || 0,
  }));
  state.attempts = {};
  if (raw.attempts && typeof raw.attempts === 'object') {
    for (const [id, list] of Object.entries(raw.attempts)) {
      if (Array.isArray(list)) state.attempts[id] = list.filter((a) => a && Number.isFinite(a.at) && Number.isFinite(a.score));
    }
  }
  if (raw.settings && typeof raw.settings === 'object') state.settings = { ...state.settings, ...raw.settings };
  return state;
}

export function loadState(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (raw) return normalizeState(JSON.parse(raw)) ?? createInitialState();
  } catch {
    // unreadable or blocked storage: start fresh
  }
  return createInitialState();
}

/** Returns false when the browser refused to store the data. */
export function saveState(state, storage = globalThis.localStorage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function newId(now = Date.now()) {
  return `v-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function getVerse(state, id) {
  return state.verses.find((v) => v.id === id) ?? null;
}

/**
 * Adds a verse, or updates it when `fields.id` exists. Returns { state, id }.
 * ko is the Korean text; koVersion the YouVersion id it came from (0: typed by hand).
 */
export function upsertVerse(state, fields, now = Date.now()) {
  const existing = fields.id ? getVerse(state, fields.id) : null;
  if (existing) {
    const verse = {
      ...existing,
      ref: fields.ref,
      text: fields.text,
      tag: fields.tag ?? existing.tag,
      ko: fields.ko ?? existing.ko ?? '',
      koVersion: fields.koVersion ?? existing.koVersion ?? 0,
      updatedAt: now,
    };
    return { state: { ...state, verses: state.verses.map((v) => (v.id === verse.id ? verse : v)) }, id: verse.id };
  }
  const verse = {
    id: newId(now),
    ref: fields.ref,
    text: fields.text,
    tag: fields.tag ?? '',
    ko: fields.ko ?? '',
    koVersion: fields.koVersion ?? 0,
    starter: false,
    createdAt: now,
    updatedAt: now,
  };
  return { state: { ...state, verses: [...state.verses, verse] }, id: verse.id };
}

/** Stores Korean text fetched for a verse without touching its other fields. */
export function setVerseKorean(state, id, ko, koVersion) {
  return { ...state, verses: state.verses.map((v) => (v.id === id ? { ...v, ko, koVersion } : v)) };
}

/** Verses whose Korean text should be (re)fetched in the given version. Hand-typed text is kept. */
export function versesNeedingKorean(state, versionId) {
  return state.verses.filter((v) => !(v.ko && (v.koVersion === versionId || v.koVersion === 0)));
}

export function removeVerse(state, id) {
  const attempts = { ...state.attempts };
  delete attempts[id];
  return { ...state, verses: state.verses.filter((v) => v.id !== id), attempts };
}

export function addAttempt(state, verseId, attempt) {
  const list = [...(state.attempts[verseId] ?? []), attempt].slice(-MAX_ATTEMPTS_PER_VERSE);
  return { ...state, attempts: { ...state.attempts, [verseId]: list } };
}

export function updateAttempt(state, verseId, at, patch) {
  const list = (state.attempts[verseId] ?? []).map((a) => (a.at === at ? { ...a, ...patch } : a));
  return { ...state, attempts: { ...state.attempts, [verseId]: list } };
}

export function setSetting(state, key, value) {
  return { ...state, settings: { ...state.settings, [key]: value } };
}

/**
 * status: 'new' (never recited), 'learning', or 'mastered' (the last
 * MASTERY_STREAK attempts were all word-perfect).
 */
export function verseProgress(attempts = []) {
  const recent = attempts.slice(-MASTERY_STREAK);
  const best = attempts.reduce((max, a) => Math.max(max, a.score), 0);
  const mastered = recent.length === MASTERY_STREAK && recent.every((a) => a.perfect);
  let streak = 0;
  for (let i = attempts.length - 1; i >= 0 && attempts[i].perfect; i--) streak++;
  return {
    status: attempts.length === 0 ? 'new' : mastered ? 'mastered' : 'learning',
    best,
    streak,
    count: attempts.length,
    last: attempts[attempts.length - 1] ?? null,
  };
}

/** Puts back starter verses the user deleted. */
export function restoreStarters(state, now = Date.now()) {
  const have = new Set(state.verses.map((v) => v.id));
  const missing = createInitialState(now).verses.filter((v) => !have.has(v.id));
  return { state: { ...state, verses: [...state.verses, ...missing] }, added: missing.length };
}

export function exportState(state, now = new Date()) {
  return JSON.stringify({ app: 'niv-recite', exportedAt: now.toISOString(), ...state }, null, 2);
}

/** Merges a backup into the current state. Throws on a file that is not a backup. */
export function importState(state, json) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('백업 파일을 읽지 못했어요. JSON 형식이 아니에요.');
  }
  const incoming = normalizeState(parsed);
  if (!incoming) throw new Error('이 앱의 백업 파일이 아니에요.');

  const verses = [...state.verses];
  let added = 0;
  for (const verse of incoming.verses) {
    const index = verses.findIndex((v) => v.id === verse.id);
    if (index === -1) {
      verses.push(verse);
      added++;
    } else if (verse.updatedAt > verses[index].updatedAt) {
      verses[index] = verse;
    }
  }
  const attempts = { ...state.attempts };
  for (const [id, list] of Object.entries(incoming.attempts)) {
    const seen = new Set((attempts[id] ?? []).map((a) => a.at));
    attempts[id] = [...(attempts[id] ?? []), ...list.filter((a) => !seen.has(a.at))]
      .sort((a, b) => a.at - b.at)
      .slice(-MAX_ATTEMPTS_PER_VERSE);
  }
  return { state: { ...state, verses, attempts }, added };
}
