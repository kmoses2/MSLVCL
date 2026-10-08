// 함께 암송 모임: a leader keeps a weekly plan on the server (from a start date,
// one verse per week), members join with an invite link, and each member's best
// try at each week's verse is shared with the group. Pure functions here;
// app.js does the talking to Firebase.

import { formatReference, parseReference } from './books.js';
import { withKorean } from './assignment.js';
import { decodeLinkData, encodeLinkData } from './link.js';

const INVITE_VERSION = 1;
const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
// No 0/O or 1/I, so a code copied by hand is not misread.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 10;
const MAX_WEEKS = 500;

function randomString(length, alphabet, random) {
  const bytes = new Uint8Array(length);
  random.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

export function newGroupId(random = globalThis.crypto) {
  return randomString(20, ID_ALPHABET, random);
}

/** The secret that makes a phone a leader of the group. */
export function newLeaderCode(random = globalThis.crypto) {
  return randomString(CODE_LENGTH, CODE_ALPHABET, random);
}

/** "abcde-fghjk" or "ABCDE FGHJK" -> "ABCDEFGHJK"; "" when it can't be a leader code. */
export function normalizeLeaderCode(text) {
  const code = String(text ?? '')
    .toUpperCase()
    .replace(/[\s-]/g, '');
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c)) ? code : '';
}

/** "ABCDE-FGHJK", easier to read out or copy by hand. */
export function formatLeaderCode(code) {
  return code ? `${code.slice(0, 5)}-${code.slice(5)}` : '';
}

// --- Invite links (#/g/<code>) ---

export function encodeInvite({ groupId, name, key }) {
  const payload = { v: INVITE_VERSION, g: groupId, n: name };
  if (key) payload.k = key;
  return encodeLinkData(payload);
}

/** { groupId, name, key }, or null when the code is broken. */
export function decodeInvite(code) {
  const payload = decodeLinkData(code);
  if (payload?.v !== INVITE_VERSION || typeof payload.g !== 'string' || !/^[A-Za-z0-9]{10,40}$/.test(payload.g)) return null;
  return {
    groupId: payload.g,
    name: String(payload.n ?? '').trim().slice(0, 40),
    key: typeof payload.k === 'string' ? payload.k.trim().slice(0, 200) : '',
  };
}

/** The code inside a pasted invite link, or "". */
export function findInviteCode(text) {
  return /#\/g\/([A-Za-z0-9_-]+)/.exec(String(text ?? ''))?.[1] ?? '';
}

// --- Dates ---

/** Local date as "YYYY-MM-DD". */
export function isoDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseIso(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Midnight (local time) at the start of the day, in ms. */
export function dayStart(iso) {
  return parseIso(iso).getTime();
}

export function addDays(iso, days) {
  const date = parseIso(iso);
  date.setDate(date.getDate() + days);
  return isoDate(date);
}

/** "10월 12일" */
export function dateText(iso) {
  const date = parseIso(iso);
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

// --- The weekly plan ---

/** Server weeks -> [{ start, ref, note }] sorted by start, one verse per start date. */
export function sanitizeWeeks(raw) {
  const byStart = new Map();
  for (const week of Array.isArray(raw) ? raw : []) {
    if (!week || typeof week !== 'object' || !/^\d{4}-\d{2}-\d{2}$/.test(week.start ?? '')) continue;
    const ref = formatReference(String(week.ref ?? ''));
    if (!parseReference(ref)?.book) continue;
    byStart.set(week.start, { start: week.start, ref, note: String(week.note ?? '').trim().slice(0, 60) });
  }
  return [...byStart.values()].sort((a, b) => a.start.localeCompare(b.start)).slice(-MAX_WEEKS);
}

/**
 * Where the group is today: current is the latest week that has started (its
 * number counts from 1), next the first one still ahead.
 */
export function weekStatus(weeks, today = isoDate()) {
  let index = -1;
  weeks.forEach((week, i) => {
    if (week.start <= today) index = i;
  });
  return { current: weeks[index] ?? null, number: index + 1, next: weeks[index + 1] ?? null };
}

/** Adds the week, replacing one with the same start date. */
export function putWeek(weeks, week) {
  return sanitizeWeeks([...weeks.filter((w) => w.start !== week.start), week]);
}

export function dropWeek(weeks, start) {
  return weeks.filter((w) => w.start !== start);
}

/**
 * Start date to suggest for a new week: keeps the group's weekday, and fills
 * this week first if it has no verse yet.
 */
export function suggestedStart(weeks, today = isoDate()) {
  const last = weeks.at(-1);
  if (!last) return today;
  let date = addDays(last.start, 7);
  if (date > today) return date;
  while (addDays(date, 7) <= today) date = addDays(date, 7);
  return date;
}

// --- Results ---

/**
 * A member's best try at each week's verse since that week started:
 * { [start]: { best, perfect, at } }, at = when it was first recited perfectly
 * (or the latest try when never perfect).
 */
export function weekResults(weeks, verses, attempts) {
  const out = {};
  for (const week of weeks) {
    const from = dayStart(week.start);
    const tries = verses
      .filter((v) => formatReference(v.ref) === week.ref)
      .flatMap((v) => attempts[v.id] ?? [])
      .filter((a) => a.at >= from);
    if (!tries.length) continue;
    const perfect = tries.filter((a) => a.perfect);
    out[week.start] = {
      best: Math.max(...tries.map((a) => a.score)),
      perfect: perfect.length > 0,
      at: perfect.length ? Math.min(...perfect.map((a) => a.at)) : Math.max(...tries.map((a) => a.at)),
    };
  }
  return out;
}

function cleanResult(r) {
  if (!r || typeof r !== 'object') return null;
  const best = Math.max(0, Math.min(100, Math.round(Number(r.best) || 0)));
  return { best, perfect: Boolean(r.perfect), at: Number(r.at) || 0 };
}

/** Combines results kept on the server with new ones from this phone; nothing gets worse. */
export function mergeResults(saved = {}, fresh = {}) {
  const out = {};
  for (const [start, r] of Object.entries(saved)) {
    const clean = cleanResult(r);
    if (clean && /^\d{4}-\d{2}-\d{2}$/.test(start)) out[start] = clean;
  }
  for (const [start, r] of Object.entries(fresh)) {
    const old = out[start];
    if (!old) {
      out[start] = cleanResult(r);
      continue;
    }
    let at;
    if (old.perfect && r.perfect) at = Math.min(old.at, r.at);
    else if (old.perfect || r.perfect) at = old.perfect ? old.at : r.at;
    else at = Math.max(old.at, r.at);
    out[start] = { best: Math.max(old.best, r.best), perfect: old.perfect || r.perfect, at };
  }
  return out;
}

export function sameResults(a = {}, b = {}) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const x = a[key];
    const y = b[key];
    if (!x || !y || x.best !== y.best || x.perfect !== y.perfect || x.at !== y.at) return false;
  }
  return true;
}

/** Server member docs -> [{ uid, name, joinedAt, results }]. */
export function sanitizeMembers(list) {
  return (Array.isArray(list) ? list : [])
    .filter((m) => m && typeof m.id === 'string' && typeof m.data?.name === 'string' && m.data.name.trim())
    .map((m) => ({
      uid: m.id,
      name: m.data.name.trim().slice(0, 30),
      joinedAt: Number(m.data.joinedAt) || 0,
      results: mergeResults(m.data.results && typeof m.data.results === 'object' ? m.data.results : {}),
    }));
}

/**
 * Everyone's standing on one week: perfect first (earliest first), then
 * those who tried by best score, then those who haven't started.
 */
export function boardRows(members, start) {
  return members
    .map((m) => {
      const r = m.results[start];
      return { uid: m.uid, name: m.name, tried: Boolean(r), best: r?.best ?? 0, perfect: Boolean(r?.perfect), at: r?.at ?? 0 };
    })
    .sort(
      (a, b) =>
        Number(b.perfect) - Number(a.perfect) ||
        (a.perfect ? a.at - b.at : 0) ||
        Number(b.tried) - Number(a.tried) ||
        b.best - a.best ||
        a.name.localeCompare(b.name, 'ko'),
    );
}

export function doneCount(members, start) {
  return members.filter((m) => m.results[start]?.perfect).length;
}

// --- Messages for the group chat ---

export function inviteMessage({ groupName, leaderName, week, url }) {
  return [
    `[말씀 암송] ${groupName}`,
    `${leaderName ? `${leaderName}님이 ` : ''}함께 말씀을 외우는 모임에 초대했어요.`,
    week ? `이번 주 말씀: ${withKorean(week.ref)}` : null,
    '',
    '링크를 누르고 이름을 적으면, 매주 외울 말씀이 앱 맨 위에 떠요. 누가 외웠는지도 함께 볼 수 있어요.',
    url,
  ]
    .filter((line) => line !== null)
    .join('\n');
}

/** The leader's announcement of a week's verse. */
export function weekMessage({ groupName, number, week, url }) {
  return [
    `[${groupName}] ${number}주차 말씀`,
    withKorean(week.ref),
    week.note || null,
    `${dateText(week.start)}부터 함께 외워요. 앱을 열면 맨 위에 있어요.`,
    url,
  ]
    .filter((line) => line !== null)
    .join('\n');
}
