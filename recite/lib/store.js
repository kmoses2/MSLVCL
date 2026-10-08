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
    assignments: [],
    group: null,
    settings: { hint: 'hidden' },
  };
}

/**
 * The 함께 암송 모임 this phone is in: role 'leader' or 'member', the leader
 * code (leaders only), which weeks' verses were already put in the list, the
 * results last saved on the server, and a cache of the group for offline use.
 */
function normalizeGroup(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) return null;
  return {
    id: raw.id,
    name: typeof raw.name === 'string' ? raw.name : '',
    role: raw.role === 'leader' ? 'leader' : 'member',
    code: typeof raw.code === 'string' ? raw.code : '',
    joinedAt: Number(raw.joinedAt) || 0,
    added: Array.isArray(raw.added) ? raw.added.filter((start) => typeof start === 'string') : [],
    uploaded: raw.uploaded && typeof raw.uploaded === 'object' ? raw.uploaded : {},
    cache: raw.cache && typeof raw.cache === 'object' ? raw.cache : null,
  };
}

function isAssignment(a) {
  return a && typeof a.id === 'string' && typeof a.title === 'string' && Array.isArray(a.verseIds);
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
  state.assignments = Array.isArray(raw.assignments)
    ? raw.assignments.filter(isAssignment).map((a) => ({
        id: a.id,
        title: a.title,
        due: typeof a.due === 'string' ? a.due : '',
        from: typeof a.from === 'string' ? a.from : '',
        verseIds: a.verseIds.filter((id) => typeof id === 'string'),
        receivedAt: Number(a.receivedAt) || 0,
      }))
    : [];
  state.group = normalizeGroup(raw.group);
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
  const assignments = (state.assignments ?? []).map((a) => ({ ...a, verseIds: a.verseIds.filter((v) => v !== id) }));
  return { ...state, verses: state.verses.filter((v) => v.id !== id), attempts, assignments };
}

/** Adds an assignment unless one with the same id is already there. Returns { state, added }. */
export function addAssignment(state, assignment) {
  const list = state.assignments ?? [];
  if (assignment.id && list.some((a) => a.id === assignment.id)) return { state, added: false };
  return { state: { ...state, assignments: [assignment, ...list] }, added: true };
}

export function removeAssignment(state, id) {
  return { ...state, assignments: (state.assignments ?? []).filter((a) => a.id !== id) };
}

/**
 * [{ verseId, ref, done, best }]: done once a verse was recited word-perfect
 * after the assignment arrived, so a review assignment asks for a fresh recitation.
 */
export function assignmentProgress(state, assignment) {
  const since = assignment.receivedAt || 0;
  return assignment.verseIds
    .map((verseId) => getVerse(state, verseId))
    .filter(Boolean)
    .map((verse) => {
      const attempts = (state.attempts[verse.id] ?? []).filter((a) => a.at >= since);
      return {
        verseId: verse.id,
        ref: verse.ref,
        done: attempts.some((a) => a.perfect),
        best: attempts.reduce((max, a) => Math.max(max, a.score), 0),
      };
    });
}

export function addAttempt(state, verseId, attempt) {
  const list = [...(state.attempts[verseId] ?? []), attempt].slice(-MAX_ATTEMPTS_PER_VERSE);
  return { ...state, attempts: { ...state.attempts, [verseId]: list } };
}

export function updateAttempt(state, verseId, at, patch) {
  const list = (state.attempts[verseId] ?? []).map((a) => (a.at === at ? { ...a, ...patch } : a));
  return { ...state, attempts: { ...state.attempts, [verseId]: list } };
}

export function setGroup(state, group) {
  return { ...state, group: normalizeGroup(group) };
}

export function updateGroup(state, patch) {
  return state.group ? { ...state, group: { ...state.group, ...patch } } : state;
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

/** A backup file. Group membership belongs to this phone, so it stays out. */
export function exportState(state, now = new Date()) {
  const { group, ...rest } = state;
  return JSON.stringify({ app: 'niv-recite', exportedAt: now.toISOString(), ...rest }, null, 2);
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
  const assignments = [...(state.assignments ?? [])];
  for (const assignment of incoming.assignments) {
    if (!assignments.some((a) => a.id === assignment.id)) assignments.push(assignment);
  }
  return { state: { ...state, verses, attempts, assignments }, added };
}
