// Assignments shared through a link: a leader picks verses and a due date, and
// opening the link adds those verses to a member's app. Only references (and
// optionally the leader's YouVersion app key) travel in the link, never Bible
// text: each phone fetches the text itself. Members send results back as chat
// messages, so nothing is stored on a server.

import { formatReference, koreanReference, parseReference } from './books.js';

const LINK_VERSION = 1;
const MAX_VERSES = 50;

function toBase64Url(text) {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(code) {
  const binary = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

export function newAssignmentId(now = Date.now()) {
  return `a-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** { id, title, due: 'YYYY-MM-DD' | '', refs: ['John 3:16', …], from, key } -> link code */
export function encodeAssignment({ id, title, due, refs, from, key }) {
  const payload = { v: LINK_VERSION, i: id, t: title, r: refs };
  if (due) payload.d = due;
  if (from) payload.f = from;
  if (key) payload.k = key;
  return toBase64Url(JSON.stringify(payload));
}

/** Link code -> assignment, or null when the code is broken. */
export function decodeAssignment(code) {
  let payload;
  try {
    payload = JSON.parse(fromBase64Url(String(code)));
  } catch {
    return null;
  }
  if (payload?.v !== LINK_VERSION || !Array.isArray(payload.r)) return null;
  const refs = [...new Set(payload.r.map((r) => formatReference(String(r))))].filter((r) => parseReference(r)?.book).slice(0, MAX_VERSES);
  if (!refs.length) return null;
  return {
    id: typeof payload.i === 'string' && payload.i ? payload.i.slice(0, 40) : '',
    title: String(payload.t || '암송 과제').trim().slice(0, 60),
    due: /^\d{4}-\d{2}-\d{2}$/.test(payload.d ?? '') ? payload.d : '',
    from: String(payload.f ?? '').trim().slice(0, 30),
    key: typeof payload.k === 'string' ? payload.k.trim().slice(0, 200) : '',
    refs,
  };
}

/** The code inside a pasted assignment link (or a bare code), or "". */
export function findAssignmentCode(text) {
  const value = String(text ?? '');
  const inLink = /#\/join\/([A-Za-z0-9_-]+)/.exec(value);
  if (inLink) return inLink[1];
  const bare = /^\s*([A-Za-z0-9_-]{20,})\s*$/.exec(value);
  return bare ? bare[1] : '';
}

function dayStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** "D-3", "오늘 마감", "마감 지남" or "" (no due date). */
export function dueLabel(due, today = new Date()) {
  if (!due) return '';
  const [y, m, d] = due.split('-').map(Number);
  const days = Math.round((new Date(y, m - 1, d) - dayStart(today)) / 86400000);
  if (days > 0) return `D-${days}`;
  return days === 0 ? '오늘 마감' : '마감 지남';
}

/** "10월 15일" */
export function dueText(due) {
  if (!due) return '';
  const [, m, d] = due.split('-').map(Number);
  return `${m}월 ${d}일`;
}

function withKorean(ref) {
  const ko = koreanReference(ref);
  return ko ? `${ref} (${ko})` : ref;
}

/** The message that carries the link into the group chat. */
export function invitationMessage({ title, due, refs, from, url }) {
  return [
    `[말씀 암송] ${title}`,
    `${from ? `${from}님이 보낸 ` : ''}암송 과제예요.${due ? ` ${dueText(due)}까지 외워 주세요.` : ''}`,
    ...refs.map((ref) => `• ${withKorean(ref)}`),
    '',
    '아래 링크를 누르면 말씀 암송 앱에 구절이 들어가요.',
    url,
  ].join('\n');
}

function scoreText({ score, perfect, wrong, missing, extra }) {
  if (perfect) return '100% 완벽';
  const misses = [wrong && `틀림 ${wrong}`, missing && `빠뜨림 ${missing}`, extra && `덧붙임 ${extra}`].filter(Boolean);
  return `${score}%${misses.length ? ` (${misses.join(', ')})` : ''}`;
}

const whenFormat = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** One recitation, ready to paste into the group chat. */
export function resultMessage({ name, ref, assignmentTitle, attempt }) {
  return [
    `[${assignmentTitle || '말씀 암송'}] ${name}`,
    `${withKorean(ref)} · ${scoreText(attempt)}`,
    `${whenFormat.format(attempt.at)} · ${attempt.mode === 'type' ? '입력으로' : '음성으로'} 암송`,
  ].join('\n');
}

/** Where a member stands on an assignment. items: [{ ref, done, best }] */
export function progressMessage({ name, title, due, items }) {
  const done = items.filter((item) => item.done).length;
  return [
    `[${title}] ${name} · ${done}/${items.length} 완료${due ? ` (${dueText(due)}까지)` : ''}`,
    ...items.map((item) => `${item.done ? '✅' : '⬜'} ${item.ref}${item.best ? ` · 최고 ${item.best}%` : ''}`),
  ].join('\n');
}
