// NIV recitation checker: verse list, practice (voice or typing), verse editor
// and settings. Plain DOM, no framework; screens are picked by the URL hash.

import { buildView, compareRecitation, summarize } from './lib/compare.js';
import { countWords, firstLetters, tokenize } from './lib/text.js';
import { bibleComUrl, BOOKS, formatReference, koreanReference, parseReference, passageId, referenceProblem } from './lib/books.js';
import { cleanPastedVerse } from './lib/cleanup.js';
import { createListener, isSpeechSupported } from './lib/speech.js';
import { NIV_NOTICE } from './lib/starter.js';
import * as store from './lib/store.js';
import { fetchNivPassage, fetchPassage, KNOWN_KOREAN_VERSIONS, listKoreanVersions, preferredKoreanVersion } from './lib/youversion.js';
import {
  decodeAssignment,
  dueLabel,
  dueText,
  encodeAssignment,
  findAssignmentCode,
  invitationMessage,
  newAssignmentId,
  progressMessage,
  resultMessage,
} from './lib/assignment.js';

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
const speechOk = isSpeechSupported();
const IN_APP_BROWSER = /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\//i.test(navigator.userAgent);
const IN_KAKAOTALK = /KAKAOTALK/i.test(navigator.userAgent);

// KakaoTalk's own browser keeps a separate copy of the app's data and often
// blocks the microphone; this asks KakaoTalk to open the page in Chrome or Safari.
function openOutsideKakao() {
  location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(location.href)}`;
}

let state = store.loadState();
let saveFailed = false;

function commit(next) {
  state = next;
  if (store.saveState(state)) {
    saveFailed = false;
  } else if (!saveFailed) {
    saveFailed = true;
    toast('이 기기에 저장하지 못했어요. 브라우저의 사이트 데이터 설정을 확인해 주세요.');
  }
}

// --- DOM helpers ---

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'value') el.value = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

/** Puts a screen in place; like h(), skips null and false children. */
function show(...children) {
  app.replaceChildren(...children.filter((child) => child != null && child !== false));
}

const ICONS = {
  mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
  speaker: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6M18 6.8a7.5 7.5 0 0 1 0 10.4"/>',
  back: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  keyboard: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7.5 14h9"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  retry: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
  share: '<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M5 12.5V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6.5"/>',
  inbox: '<path d="M3.5 13.5h4.5l1.5 3h5l1.5-3h4.5"/><path d="M6 5h12l2.5 8.5V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-4.5z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  external: '<path d="M14 4h6v6M20 4l-8.5 8.5"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  clipboard: '<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M8 5H6.5A1.5 1.5 0 0 0 5 6.5v13A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-13A1.5 1.5 0 0 0 17.5 5H16"/>',
};

function icon(name, extra = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `icon ${extra}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name];
  return svg;
}

let toastTimer = 0;
function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, 3200);
}

const whenFormat = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function verseMeta(verse) {
  return [koreanReference(verse.ref), verse.tag].filter(Boolean).join(' · ');
}

// --- Routing ---

const routes = [
  [/^#\/v\/([\w-]+)$/, (id) => renderPractice(id)],
  [/^#\/join\/([A-Za-z0-9_-]+)$/, (code) => renderJoin(code)],
  [/^#\/share$/, () => renderShare()],
  [/^#\/receive$/, () => renderReceive()],
  [/^#\/add$/, () => renderEditor(null)],
  [/^#\/edit\/([\w-]+)$/, (id) => renderEditor(id)],
  [/^#\/settings$/, () => renderSettings()],
];

function route() {
  leavePractice();
  const hash = location.hash;
  const found = routes.find(([pattern]) => pattern.test(hash));
  if (found) found[1](...found[0].exec(hash).slice(1));
  else renderHome();
  window.scrollTo(0, 0);
}

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

// --- Home: the verse deck ---

const STATUS_LABEL = { new: '새 구절', learning: '연습 중', mastered: '암송 완료' };

function renderHome() {
  const progress = new Map(state.verses.map((v) => [v.id, store.verseProgress(state.attempts[v.id])]));
  const mastered = [...progress.values()].filter((p) => p.status === 'mastered').length;
  show(
    h(
      'header',
      { class: 'top' },
      h(
        'div',
        { class: 'brand' },
        h('h1', { class: 'brand-title' }, '말씀 암송', h('span', { class: 'niv' }, 'NIV')),
        h('p', { class: 'brand-sub' }, '소리 내어 외우면, 한 단어씩 맞았는지 확인해요'),
      ),
      h('a', { class: 'icon-button', href: '#/settings', 'aria-label': '설정과 도움말' }, icon('sliders')),
    ),
    IN_KAKAOTALK ? kakaoNotice() : null,
    assignmentSection(),
    h('p', { class: 'tally' }, `${state.verses.length}구절 · 암송 완료 ${mastered}`),
    state.verses.length
      ? h('ol', { class: 'deck' }, state.verses.map((verse) => h('li', {}, verseCard(verse, progress.get(verse.id)))))
      : h('p', { class: 'empty' }, '아직 구절이 없어요. 외우고 싶은 NIV 구절을 추가해 보세요.'),
    h('a', { class: 'add-card', href: '#/add' }, icon('plus'), '새 구절 추가'),
    h(
      'div',
      { class: 'row group-row' },
      h('a', { class: 'btn ghost', href: '#/share' }, icon('share'), '과제 보내기'),
      h('a', { class: 'btn ghost', href: '#/receive' }, icon('inbox'), '과제 받기'),
    ),
    h('p', { class: 'footnote' }, 'NIV® © Biblica, Inc. · 구절과 기록은 이 기기에만 저장돼요 · ', h('a', { href: '#/settings' }, '도움말')),
  );
}

function kakaoNotice() {
  return h(
    'div',
    { class: 'notice info kakao' },
    h('p', {}, '카카오톡 안에서 열려 있어요. 여기서는 기록이 따로 저장되고 마이크가 안 될 수 있어요.'),
    h('button', { type: 'button', class: 'btn ghost', onclick: openOutsideKakao }, 'Chrome/Safari로 열기'),
  );
}

function myName() {
  return String(state.settings.name ?? '').trim();
}

/** The member's name for messages, asked once. */
function askName() {
  if (myName()) return myName();
  const name = (window.prompt('결과와 함께 보낼 이름을 적어 주세요.') ?? '').trim().slice(0, 30);
  if (name) commit(store.setSetting(state, 'name', name));
  return name;
}

/** Opens the share sheet (KakaoTalk etc.), or copies the text when there is none. */
async function shareText(text, title = '말씀 암송') {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('복사했어요. 단톡방에 붙여넣어 주세요.');
  } catch {
    toast('복사하지 못했어요. 글을 길게 눌러 복사해 주세요.');
  }
}

function assignmentSection() {
  const list = state.assignments ?? [];
  if (!list.length) return null;
  return h(
    'section',
    { class: 'assignments', 'aria-labelledby': 'assignments-title' },
    h('h2', { id: 'assignments-title', class: 'section-title' }, '받은 과제'),
    list.map(assignmentCard),
  );
}

function assignmentCard(assignment) {
  const items = store.assignmentProgress(state, assignment);
  const done = items.filter((item) => item.done).length;
  const label = dueLabel(assignment.due);
  const meta = [assignment.from && `${assignment.from}님이 보냄`, assignment.due && `${dueText(assignment.due)}까지`].filter(Boolean).join(' · ');
  return h(
    'article',
    { class: done === items.length && items.length ? 'assignment is-done' : 'assignment', 'data-assignment': assignment.id },
    h(
      'div',
      { class: 'assignment-head' },
      h('h3', { class: 'assignment-title' }, assignment.title),
      label ? h('span', { class: label === '마감 지남' ? 'due is-late' : 'due' }, label) : null,
    ),
    meta ? h('p', { class: 'assignment-meta' }, meta) : null,
    h(
      'ul',
      { class: 'assignment-verses' },
      items.map((item) =>
        h('li', {}, h('a', { class: item.done ? 'chip is-done' : 'chip', href: `#/v/${item.verseId}` }, item.done ? icon('check') : null, item.ref)),
      ),
    ),
    h(
      'div',
      { class: 'assignment-foot' },
      h('span', { class: 'assignment-count' }, `${done}/${items.length} 완료`),
      h('button', { type: 'button', class: 'btn ghost small', onclick: () => sendProgress(assignment) }, icon('share'), '현황 보내기'),
      h(
        'button',
        {
          type: 'button',
          class: 'link-button',
          onclick: () => {
            if (!window.confirm(`‘${assignment.title}’ 과제를 목록에서 지울까요? 구절과 기록은 남아요.`)) return;
            commit(store.removeAssignment(state, assignment.id));
            renderHome();
          },
        },
        '지우기',
      ),
    ),
  );
}

async function sendProgress(assignment) {
  const name = askName();
  if (!name) return;
  const items = store.assignmentProgress(state, assignment);
  await shareText(progressMessage({ name, title: assignment.title, due: assignment.due, items }), assignment.title);
}

function verseCard(verse, progress) {
  const filled = Math.min(progress.streak, store.MASTERY_STREAK);
  return h(
    'a',
    { class: `card is-${progress.status}`, href: verse.text ? `#/v/${verse.id}` : `#/edit/${verse.id}`, 'data-verse': verse.id },
    h('div', { class: 'card-head' }, h('span', { class: 'ref' }, verse.ref), verse.tag ? h('span', { class: 'tag' }, verse.tag) : null),
    koreanReference(verse.ref) ? h('p', { class: 'ref-ko' }, koreanReference(verse.ref)) : null,
    verse.text
      ? h('p', { class: 'card-verse', lang: 'en' }, verse.text)
      : h('p', { class: 'card-verse is-missing' }, '본문이 아직 없어요. 눌러서 NIV 본문을 넣어 주세요.'),
    verse.ko && showKorean() ? h('p', { class: 'card-ko', lang: 'ko' }, verse.ko) : null,
    h(
      'div',
      { class: 'card-foot' },
      h('span', { class: `pill pill-${progress.status}` }, STATUS_LABEL[progress.status]),
      h(
        'span',
        { class: 'dots', role: 'img', 'aria-label': `연속 완벽 ${filled}/${store.MASTERY_STREAK}` },
        Array.from({ length: store.MASTERY_STREAK }, (_, i) => h('span', { class: i < filled ? 'dot on' : 'dot' })),
      ),
      h('span', { class: 'best' }, progress.count ? `최고 ${progress.best}%` : `${countWords(verse.text)}단어`),
    ),
  );
}

function renderNotFound() {
  show(
    h('nav', { class: 'bar' }, h('a', { class: 'back', href: '#/' }, icon('back'), '목록')),
    h('p', { class: 'empty' }, '이 구절을 찾을 수 없어요. 삭제되었을 수 있어요.'),
  );
}

// --- Practice ---

let session = null;
let wakeLock = null;

async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    wakeLock = null;
  }
}

function stopSpeaking() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

function leavePractice() {
  if (!session) return;
  session.listener?.cancel();
  clearInterval(session.timer);
  stopSpeaking();
  keepAwake(false);
  session = null;
}

function renderPractice(id) {
  const verse = store.getVerse(state, id);
  if (!verse) {
    renderNotFound();
    return;
  }
  if (!verse.text.trim()) {
    show(
      h('nav', { class: 'bar' }, h('a', { class: 'back', href: '#/' }, icon('back'), '목록')),
      h('h1', { class: 'page-title' }, verse.ref),
      h('p', { class: 'notice info' }, '이 구절은 아직 NIV 본문이 없어요. 본문을 넣으면 암송할 수 있어요.'),
      h('div', { class: 'row' }, h('a', { class: 'btn primary', href: `#/edit/${verse.id}` }, icon('edit'), '본문 넣기')),
    );
    return;
  }
  const body = h('div', { class: 'practice' });
  show(
    h(
      'nav',
      { class: 'bar' },
      h('a', { class: 'back', href: '#/' }, icon('back'), '목록'),
      h('a', { class: 'text-button', href: `#/edit/${verse.id}` }, icon('edit'), '편집'),
    ),
    body,
  );
  session = {
    verseId: verse.id,
    body,
    phase: speechOk ? 'idle' : 'typing',
    mode: speechOk ? 'voice' : 'type',
    transcript: '',
    typed: '',
    result: null,
    accepted: new Set(),
    attemptAt: 0,
    error: '',
    endError: null,
    listener: null,
    timer: 0,
    startedAt: 0,
  };
  paintPractice();
}

function paintPractice() {
  const s = session;
  if (!s) return;
  const verse = store.getVerse(state, s.verseId);
  const hint = state.settings.hint ?? 'hidden';
  const meta = verseMeta(verse);
  const parts = [
    h(
      'header',
      { class: 'verse-head' },
      h('h1', { class: 'ref' }, verse.ref),
      meta ? h('p', { class: 'verse-meta' }, meta) : null,
      verse.ko && showKorean() ? h('p', { class: 'verse-ko', lang: 'ko' }, verse.ko) : null,
    ),
  ];
  if (s.phase === 'result') {
    parts.push(resultView(verse));
  } else {
    parts.push(hintToolbar(verse, hint), h('div', { class: 'sheet' }, hintBody(verse, hint)), reciteArea());
  }
  parts.push(historyList(verse.id));
  s.body.replaceChildren(...parts.filter(Boolean));
}

const HINTS = [
  ['hidden', '가리기'],
  ['initials', '첫 글자'],
  ['full', '전체 보기'],
];

function hintToolbar(verse, hint) {
  return h(
    'div',
    { class: 'toolbar' },
    h(
      'div',
      { class: 'segmented', role: 'radiogroup', 'aria-label': '본문 보기' },
      HINTS.map(([value, label]) =>
        h(
          'button',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(hint === value),
            class: hint === value ? 'on' : '',
            onclick: () => {
              commit(store.setSetting(state, 'hint', value));
              paintPractice();
            },
          },
          label,
        ),
      ),
    ),
    'speechSynthesis' in window ? speakButton(verse) : null,
  );
}

function speakButton(verse) {
  const button = h('button', { type: 'button', class: 'chip-button' });
  const label = (name, text) => button.replaceChildren(icon(name), text);
  label('speaker', '듣기');
  button.addEventListener('click', () => {
    const synth = window.speechSynthesis;
    if (synth.speaking || synth.pending) {
      synth.cancel();
      label('speaker', '듣기');
      return;
    }
    // "LORD" in small caps would be spelled out letter by letter.
    const utterance = new SpeechSynthesisUtterance(verse.text.replace(/\b([A-Z])([A-Z]+)\b/g, (_, a, b) => a + b.toLowerCase()));
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    const voices = synth.getVoices();
    const voice =
      voices.find((v) => v.lang === 'en-US' && /samantha|google us|aria|jenny|allison/i.test(v.name)) ??
      voices.find((v) => v.lang?.replace('_', '-').startsWith('en-US'));
    if (voice) utterance.voice = voice;
    utterance.onend = () => label('speaker', '듣기');
    utterance.onerror = () => label('speaker', '듣기');
    label('stop', '멈추기');
    synth.speak(utterance);
  });
  return button;
}

function hintBody(verse, hint) {
  if (hint === 'full') return h('p', { class: 'verse' }, verse.text);
  if (hint === 'initials') return h('p', { class: 'verse initials' }, firstLetters(verse.text));
  // Blanks the length of each word keep the verse's shape without its words.
  const nodes = [];
  let last = 0;
  for (const token of tokenize(verse.text)) {
    if (token.start > last) nodes.push(verse.text.slice(last, token.start));
    nodes.push(h('span', { class: 'blank', style: `width:${Array.from(token.text).length * 0.55}em` }));
    last = token.end;
  }
  nodes.push(verse.text.slice(last));
  return h('p', { class: 'verse blanks', role: 'img', 'aria-label': `가려진 본문, ${countWords(verse.text)}단어` }, nodes);
}

const SPEECH_ERRORS = {
  'not-allowed': '마이크 사용이 허용되지 않았어요. 주소창의 사이트 설정에서 마이크를 허용한 뒤 다시 눌러 주세요.',
  'service-not-allowed':
    '이 브라우저에서는 음성 인식을 쓸 수 없어요. iPhone은 Safari, 안드로이드와 PC는 Chrome으로 열어 주세요. iPhone은 설정 › 일반 › 키보드에서 받아쓰기를 켜야 할 수도 있어요.',
  'audio-capture': '마이크를 찾지 못했어요. 마이크가 연결되어 있는지 확인해 주세요.',
  network: '음성 인식 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.',
  'language-not-supported': '이 기기에서는 영어(미국) 음성 인식을 쓸 수 없어요.',
};

function speechErrorMessage(code) {
  return SPEECH_ERRORS[code] ?? `음성 인식이 멈췄어요 (${code}). 다시 눌러 주세요.`;
}

function elapsed() {
  const seconds = Math.floor((Date.now() - (session?.startedAt ?? Date.now())) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function reciteArea() {
  const s = session;
  if (s.phase === 'typing') return typedForm();
  if (s.phase === 'listening' || s.phase === 'grading') {
    const live = s.phase === 'listening';
    return h(
      'section',
      { class: 'recite' },
      h(
        'button',
        { type: 'button', class: 'mic is-live', disabled: !live, onclick: stopListening, 'aria-label': '다 했어요, 채점하기' },
        icon('stop', 'solid'),
      ),
      live
        ? h('p', { class: 'mic-label' }, '듣고 있어요 ', h('span', { class: 'timer', id: 'timer' }, elapsed()))
        : h('p', { class: 'mic-label' }, '채점하는 중…'),
      transcriptBox(),
      live ? h('p', { class: 'mic-tip' }, '다 외웠으면 빨간 버튼을 눌러 채점하세요.') : null,
      live ? h('button', { type: 'button', class: 'link-button', onclick: cancelListening }, '취소') : null,
    );
  }
  return h(
    'section',
    { class: 'recite' },
    s.error ? h('p', { class: 'notice', role: 'alert' }, s.error) : null,
    IN_KAKAOTALK
      ? kakaoNotice()
      : IN_APP_BROWSER
        ? h('p', { class: 'notice info' }, '앱 안의 브라우저에서는 음성 인식이 안 될 수 있어요. 메뉴에서 ‘다른 브라우저로 열기’를 눌러 Safari나 Chrome으로 열어 주세요.')
        : null,
    h('button', { type: 'button', class: 'mic', onclick: startListening, 'aria-label': '암송 시작' }, icon('mic')),
    h('p', { class: 'mic-label' }, '눌러서 암송 시작'),
    h('p', { class: 'mic-tip' }, '영어로 또박또박 말해 주세요. 장절(John 3:16)을 앞뒤에 말해도 채점에는 들어가지 않아요.'),
    h(
      'button',
      {
        type: 'button',
        class: 'link-button',
        onclick: () => {
          s.phase = 'typing';
          s.error = '';
          paintPractice();
          document.getElementById('typed-answer')?.focus();
        },
      },
      icon('keyboard'),
      '키보드로 입력하기',
    ),
  );
}

function transcriptBox() {
  const text = session.transcript;
  return h('p', { id: 'live', class: text ? 'live' : 'live is-empty' }, text || '듣는 중… 첫 단어부터 말해 보세요.');
}

function updateLive() {
  const el = document.getElementById('live');
  if (!el) return;
  el.textContent = session.transcript || '듣는 중… 첫 단어부터 말해 보세요.';
  el.classList.toggle('is-empty', !session.transcript);
}

function updateTimer() {
  const el = document.getElementById('timer');
  if (el) el.textContent = elapsed();
}

function startListening() {
  const s = session;
  if (!s) return;
  stopSpeaking();
  Object.assign(s, { error: '', endError: null, transcript: '', result: null, accepted: new Set(), phase: 'listening', mode: 'voice', startedAt: Date.now() });
  try {
    s.listener = createListener({
      lang: 'en-US',
      onText: (text) => {
        if (session !== s) return;
        s.transcript = text;
        updateLive();
      },
      onEnd: (text, error) => {
        if (session === s) finishListening(text, error);
      },
    });
  } catch {
    s.phase = 'typing';
    paintPractice();
    return;
  }
  paintPractice();
  s.timer = setInterval(updateTimer, 500);
  keepAwake(true);
  s.listener.start();
}

function stopListening() {
  const s = session;
  if (!s?.listener) return;
  s.phase = 'grading';
  clearInterval(s.timer);
  paintPractice();
  s.listener.stop();
}

function cancelListening() {
  const s = session;
  s.listener?.cancel();
  s.listener = null;
  clearInterval(s.timer);
  keepAwake(false);
  s.phase = 'idle';
  paintPractice();
}

function finishListening(text, error) {
  const s = session;
  clearInterval(s.timer);
  keepAwake(false);
  s.listener = null;
  const said = text.trim();
  if (!said) {
    s.phase = 'idle';
    s.error = error ? speechErrorMessage(error) : '아무 말도 들리지 않았어요. 마이크 가까이에서 또렷하게 말해 주세요.';
    paintPractice();
    return;
  }
  s.endError = error;
  grade(said, 'voice');
}

function typedForm() {
  const s = session;
  const area = h('textarea', {
    id: 'typed-answer',
    class: 'verse-input',
    rows: '5',
    spellcheck: 'false',
    autocomplete: 'off',
    autocorrect: 'off',
    autocapitalize: 'sentences',
    placeholder: '외운 구절을 입력하세요',
    value: s.typed,
  });
  const submit = () => {
    if (!area.value.trim()) {
      area.focus();
      return;
    }
    grade(area.value, 'type');
  };
  area.addEventListener('input', () => {
    s.typed = area.value;
  });
  area.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit();
  });
  return h(
    'section',
    { class: 'typed' },
    speechOk
      ? null
      : h('p', { class: 'notice info' }, '이 브라우저는 음성 인식을 지원하지 않아서 입력으로 채점해요. iPhone은 Safari, 안드로이드와 PC는 Chrome에서 열면 소리 내어 암송할 수 있어요.'),
    h('label', { for: 'typed-answer', class: 'sr-only' }, '외운 구절'),
    area,
    h(
      'div',
      { class: 'row' },
      h('button', { type: 'button', class: 'btn primary', onclick: submit }, '채점하기'),
      speechOk
        ? h(
            'button',
            {
              type: 'button',
              class: 'btn ghost',
              onclick: () => {
                s.phase = 'idle';
                paintPractice();
              },
            },
            icon('mic'),
            '음성으로 하기',
          )
        : null,
    ),
  );
}

function statsFields(stats) {
  return { score: stats.score, perfect: stats.perfect, wrong: stats.wrong, missing: stats.missing, extra: stats.extra };
}

let persistenceAsked = false;
function requestPersistence() {
  if (persistenceAsked) return;
  persistenceAsked = true;
  navigator.storage?.persist?.().catch(() => {});
}

function grade(text, mode) {
  const s = session;
  const verse = store.getVerse(state, s.verseId);
  const result = compareRecitation(verse.text, text, { mode, reference: verse.ref });
  const at = Date.now();
  commit(store.addAttempt(state, verse.id, { at, mode, ...statsFields(summarize(result)) }));
  Object.assign(s, { phase: 'result', result, accepted: new Set(), attemptAt: at, mode, transcript: text });
  paintPractice();
  window.scrollTo(0, 0);
  requestPersistence();
}

function toggleAccept(op) {
  const s = session;
  if (s.accepted.has(op)) s.accepted.delete(op);
  else s.accepted.add(op);
  const stats = summarize(s.result, s.accepted);
  commit(store.updateAttempt(state, s.verseId, s.attemptAt, { ...statsFields(stats), accepted: s.accepted.size }));
  paintPractice();
}

function retry() {
  const s = session;
  Object.assign(s, { result: null, accepted: new Set(), transcript: '', error: '', endError: null });
  window.scrollTo(0, 0);
  if (s.mode === 'type' || !speechOk) {
    s.typed = '';
    s.phase = 'typing';
    paintPractice();
    document.getElementById('typed-answer')?.focus();
  } else {
    startListening();
  }
}

function verdictFor(stats) {
  if (stats.perfect) return '완벽해요. 한 단어도 틀리지 않았어요.';
  if (stats.score >= 90) return '거의 다 왔어요. 표시된 곳만 다시 보세요.';
  if (stats.score >= 60) return '흐름은 잡혔어요. 조금만 더 연습해요.';
  return '본문을 다시 읽고 천천히 외워 봐요.';
}

function resultView(verse) {
  const s = session;
  const stats = summarize(s.result, s.accepted);
  const progress = store.verseProgress(state.attempts[verse.id]);
  const marked = stats.wrong + stats.missing + stats.extra > 0 || s.accepted.size > 0;
  const voice = s.mode === 'voice';
  return h(
    'div',
    { class: 'result' },
    h(
      'section',
      { class: stats.perfect ? 'score is-perfect' : 'score', 'aria-live': 'polite' },
      h('p', { class: 'score-num' }, h('span', { class: 'num' }, stats.score), h('span', { class: 'pct' }, '%')),
      h(
        'div',
        { class: 'score-text' },
        h('p', { class: 'verdict' }, verdictFor(stats)),
        h(
          'ul',
          { class: 'counts' },
          h('li', {}, '맞음 ', h('b', {}, stats.correct), `/${stats.total}`),
          h('li', { class: stats.wrong ? 'bad' : '' }, '틀림 ', h('b', {}, stats.wrong)),
          h('li', { class: stats.missing ? 'bad' : '' }, '빠뜨림 ', h('b', {}, stats.missing)),
          h('li', { class: stats.extra ? 'warn' : '' }, '덧붙임 ', h('b', {}, stats.extra)),
        ),
      ),
      stats.perfect ? h('span', { class: 'seal', 'aria-hidden': 'true' }, '완벽') : null,
      stats.perfect ? streakNote(progress) : null,
    ),
    s.endError ? h('p', { class: 'notice' }, `${speechErrorMessage(s.endError)} 들린 부분까지만 채점했어요.`) : null,
    h(
      'div',
      { class: 'sheet' },
      markedVerse(s.result, s.accepted, voice),
      marked ? legend(voice) : null,
    ),
    marked
      ? h(
          'p',
          { class: 'fine' },
          voice
            ? '마이크가 잘못 알아들은 단어는 눌러서 맞음으로 바꿀 수 있어요. 다시 누르면 되돌아가요.'
            : '오타는 눌러서 맞음으로 바꿀 수 있어요. 다시 누르면 되돌아가요.',
        )
      : null,
    h('details', { class: 'heard' }, h('summary', {}, voice ? '들린 그대로 보기' : '입력한 그대로 보기'), h('p', {}, s.transcript)),
    h(
      'div',
      { class: 'row actions' },
      h('button', { type: 'button', class: 'btn primary', onclick: retry }, icon('retry'), '다시 암송하기'),
      h('button', { type: 'button', class: 'btn ghost', onclick: () => sendResult(verse) }, icon('share'), '결과 보내기'),
      h('a', { class: 'btn ghost', href: '#/' }, '목록으로'),
    ),
  );
}

async function sendResult(verse) {
  const attempt = (state.attempts[verse.id] ?? []).find((a) => a.at === session?.attemptAt);
  if (!attempt) return;
  const name = askName();
  if (!name) return;
  const assignment = (state.assignments ?? []).find((a) => a.verseIds.includes(verse.id));
  await shareText(resultMessage({ name, ref: verse.ref, assignmentTitle: assignment?.title, attempt }));
}

function streakNote(progress) {
  if (progress.status === 'mastered') return h('p', { class: 'streak' }, `${progress.streak}번 연속 완벽 · 암송 완료!`);
  const left = store.MASTERY_STREAK - progress.streak;
  return h('p', { class: 'streak' }, `연속 완벽 ${progress.streak}/${store.MASTERY_STREAK} · ${left}번 더 하면 암송 완료`);
}

function markedVerse(result, accepted, voice) {
  const items = buildView(result, accepted);
  const { text, tokens } = result.expected;
  const nodes = [];
  let last = 0;
  items.forEach((item, k) => {
    if (item.kind === 'word') {
      const token = tokens[item.token];
      if (token.start > last) nodes.push(text.slice(last, token.start));
      nodes.push(wordMark(item, voice));
      last = token.end;
      return;
    }
    const nextWord = items.slice(k + 1).find((x) => x.kind === 'word');
    if (item.kind === 'ref') {
      if (!nextWord && last < text.length) {
        nodes.push(text.slice(last));
        last = text.length;
      }
      nodes.push(h('span', { class: `mark-ref ${nextWord ? 'lead' : 'tail'}`, title: '장절은 채점하지 않아요' }, item.heard));
      return;
    }
    // An extra word goes after the punctuation that follows the previous word.
    const until = nextWord ? tokens[nextWord.token].start : text.length;
    if (until > last) {
      nodes.push(text.slice(last, until));
      last = until;
    }
    nodes.push(
      h(
        'button',
        {
          type: 'button',
          class: item.accepted ? 'mark mark-extra is-accepted' : 'mark mark-extra',
          'aria-pressed': String(item.accepted),
          'aria-label': `본문에 없는 말: ${item.heard}. ${item.accepted ? '무시함, 눌러서 되돌리기' : '눌러서 무시하기'}`,
          onclick: () => toggleAccept(item.op),
        },
        item.heard,
      ),
    );
  });
  if (last < text.length) nodes.push(text.slice(last));
  return h('p', { class: 'verse marked' }, nodes);
}

function wordMark(item, voice) {
  if (item.status === 'ok') {
    if (!item.variant) return item.text;
    const why = voice ? '발음이 같아서' : '같은 단어의 다른 철자라서';
    return h(
      'button',
      { type: 'button', class: 'mark mark-variant', onclick: () => toast(`‘${item.heard}’(으)로 ${voice ? '들렸지만' : '썼지만'} ${why} 맞게 처리했어요.`) },
      item.text,
    );
  }
  const what = item.status === 'wrong' ? `틀림: ${item.text}, ${voice ? '들린 말' : '입력한 말'}: ${item.heard}` : `빠뜨림: ${item.text}`;
  return h(
    'button',
    {
      type: 'button',
      class: `mark mark-${item.status}${item.accepted ? ' is-accepted' : ''}`,
      'aria-pressed': String(item.accepted),
      'aria-label': `${what}. ${item.accepted ? '맞음으로 처리함, 눌러서 되돌리기' : '눌러서 맞음으로 바꾸기'}`,
      onclick: () => toggleAccept(item.op),
    },
    item.status === 'wrong' && !item.accepted ? h('ruby', {}, item.text, h('rt', {}, item.heard)) : item.text,
  );
}

function legend(voice) {
  return h(
    'p',
    { class: 'legend' },
    h('span', {}, h('span', { class: 'sw sw-wrong' }, 'word'), voice ? ' 틀린 단어 (위: 들린 말)' : ' 틀린 단어 (위: 입력한 말)'),
    h('span', {}, h('span', { class: 'sw sw-missing' }, 'word'), ' 빠뜨린 단어'),
    h('span', {}, h('span', { class: 'sw sw-extra' }, 'word'), ' 본문에 없는 말'),
  );
}

function historyList(verseId) {
  const recent = (state.attempts[verseId] ?? []).slice(-5).reverse();
  if (!recent.length) return null;
  return h(
    'section',
    { class: 'history' },
    h('h2', {}, '최근 기록'),
    h(
      'ol',
      {},
      recent.map((a) =>
        h(
          'li',
          {},
          h('span', { class: 'when' }, whenFormat.format(a.at)),
          h('span', { class: 'how' }, a.mode === 'type' ? '입력' : '음성'),
          h('span', { class: a.perfect ? 'pts perfect' : 'pts' }, `${a.score}%`),
        ),
      ),
    ),
  );
}

// --- Add / edit a verse ---

// What the user typed into "new verse" survives a trip to the Bible app, even
// if the browser reloads this page meanwhile.
const DRAFT_KEY = 'niv-recite/draft';
const DRAFT_MAX_AGE = 6 * 60 * 60 * 1000;

function loadDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null');
    if (draft && Date.now() - draft.at < DRAFT_MAX_AGE) return draft;
  } catch {
    // no usable draft
  }
  return null;
}

function saveDraft(fields) {
  try {
    if (fields.ref || fields.text || fields.tag || fields.ko) localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...fields, at: Date.now() }));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    // the draft just isn't kept
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // nothing to clear
  }
}

const FETCH_ERRORS = {
  key: 'YouVersion 앱 키가 맞지 않아요. 설정에서 키를 다시 붙여넣어 주세요.',
  license: '이 앱 키로는 NIV를 가져올 수 없어요. YouVersion 개발자 사이트에서 이 앱에 NIV 사용을 신청해 주세요.',
  'not-found': 'YouVersion에서 이 구절을 찾지 못했어요.',
  network: 'YouVersion에 연결하지 못했어요. 인터넷 연결을 확인해 주세요. 인터넷이 되는데도 계속 이러면 알려 주세요.',
};

function fetchErrorMessage(err) {
  return FETCH_ERRORS[err?.code] ?? `YouVersion에서 본문을 가져오지 못했어요${err?.status ? ` (오류 ${err.status})` : ''}. 잠시 뒤 다시 해 보세요.`;
}

// Korean text is shown unless it was turned off in settings.
function showKorean() {
  return state.settings.koreanVersionId !== -1;
}

function youversionKey() {
  return String(state.settings.youversionKey ?? '').trim();
}

// settings.koreanVersionId: undefined = not chosen yet, -1 = off, otherwise a YouVersion id.
function koreanVersion() {
  const id = Number(state.settings.koreanVersionId);
  if (!Number.isInteger(id) || id <= 0) return null;
  return { id, title: state.settings.koreanVersionTitle || '', copyright: state.settings.koreanVersionCopyright || '' };
}

function koreanCopyrightText() {
  const version = koreanVersion();
  if (!version) return '';
  return `한글 본문: ${version.title}${version.copyright ? ` · ${version.copyright}` : ''} (YouVersion 제공)`;
}

function setKoreanVersion(version) {
  let next = store.setSetting(state, 'koreanVersionId', version ? version.id : -1);
  next = store.setSetting(next, 'koreanVersionTitle', version?.title ?? '');
  next = store.setSetting(next, 'koreanVersionCopyright', version?.copyright ?? '');
  commit(next);
  const line = document.getElementById('ko-copyright');
  if (line) {
    line.textContent = koreanCopyrightText();
    line.hidden = !line.textContent;
  }
}

let koreanVersions = null; // list for this app key, loaded once per visit
let koreanProblem = null; // last PassageError while filling Korean text
let koreanFill = null; // the running fill, shared by every caller

async function loadKoreanVersions(key) {
  if (koreanVersions) return koreanVersions;
  try {
    const list = await listKoreanVersions(key);
    koreanVersions = list.length ? list : KNOWN_KOREAN_VERSIONS;
  } catch {
    koreanVersions = KNOWN_KOREAN_VERSIONS;
  }
  return koreanVersions;
}

const KOREAN_PROBLEMS = {
  license: '한글 성경을 쓸 허락이 아직 없어요. YouVersion 사이트 › Licensing에서 한국어 성경 출판사(예: Korean Bible Society)를 체크하고 동의해 주세요.',
};

function koreanProblemMessage(err) {
  return KOREAN_PROBLEMS[err?.code] ?? fetchErrorMessage(err);
}

// Shows a verse's new Korean text wherever it is on screen.
function showKoreanText(verseId) {
  const verse = store.getVerse(state, verseId);
  const card = document.querySelector(`.card[data-verse="${CSS.escape(verseId)}"]`);
  if (card && verse?.ko && showKorean()) {
    let ko = card.querySelector('.card-ko');
    if (!ko) {
      ko = h('p', { class: 'card-ko', lang: 'ko' });
      card.querySelector('.card-verse')?.after(ko);
    }
    ko.textContent = verse.ko;
  }
  if (session?.verseId === verseId && session.phase !== 'listening' && session.phase !== 'grading') paintPractice();
}

/** Fetches Korean text for verses that don't have it in the chosen version yet. */
function fillKoreanTexts(onProgress) {
  if (!koreanFill) koreanFill = runKoreanFill(onProgress).finally(() => (koreanFill = null));
  return koreanFill;
}

async function runKoreanFill(onProgress) {
  const key = youversionKey();
  if (!key || state.settings.koreanVersionId === -1) return;
  koreanProblem = null;
  let version = koreanVersion();
  if (!version) {
    const pick = preferredKoreanVersion(await loadKoreanVersions(key));
    if (!pick) return;
    setKoreanVersion(pick);
    version = koreanVersion();
  }
  const todo = store.versesNeedingKorean(state, version.id);
  let done = 0;
  for (const verse of todo) {
    const id = passageId(verse.ref);
    if (id) {
      try {
        const { text } = await fetchPassage(key, version.id, id);
        commit(store.setVerseKorean(state, verse.id, text, version.id));
        showKoreanText(verse.id);
      } catch (err) {
        if (err.code !== 'not-found') {
          koreanProblem = err;
          break;
        }
      }
    }
    done++;
    onProgress?.(done, todo.length);
  }
}

function numberOptions(from, to, suffix) {
  return Array.from({ length: to - from + 1 }, (_, k) => h('option', { value: String(from + k) }, `${from + k}${suffix}`));
}

/** Book, chapter and verse lists covering the whole Bible. Calls onPick(reference). */
function versePicker(onPick) {
  const bookSelect = h(
    'select',
    { id: 'pick-book' },
    h('option', { value: '' }, '성경 66권에서 고르기'),
    [
      ['구약', 'old'],
      ['신약', 'new'],
    ].map(([label, testament]) =>
      h('optgroup', { label }, BOOKS.filter((b) => b.testament === testament).map((b) => h('option', { value: b.usfm }, `${b.ko} · ${b.en}`))),
    ),
  );
  const chapterSelect = h('select', { id: 'pick-chapter', disabled: true });
  const verseSelect = h('select', { id: 'pick-verse', disabled: true });
  const endSelect = h('select', { id: 'pick-verse-end', disabled: true });
  const book = () => BOOKS.find((b) => b.usfm === bookSelect.value) ?? null;

  // verse 0 means the whole chapter.
  const fillVerses = (verse, end) => {
    const last = book().verses[Number(chapterSelect.value) - 1];
    verseSelect.replaceChildren(h('option', { value: '0' }, '장 전체'), ...numberOptions(1, last, '절'));
    verseSelect.value = String(Math.min(verse, last));
    verseSelect.disabled = false;
    const start = Number(verseSelect.value);
    if (start === 0) {
      endSelect.replaceChildren(h('option', { value: '0' }, '—'));
      endSelect.disabled = true;
      return;
    }
    endSelect.replaceChildren(...numberOptions(start, last, '절'));
    endSelect.value = String(Math.min(Math.max(end, start), last));
    endSelect.disabled = false;
  };

  const emit = () => {
    const b = book();
    if (!b) return;
    const chapter = Number(chapterSelect.value);
    const verse = Number(verseSelect.value);
    const end = Number(endSelect.value);
    let ref;
    if (verse === 0) ref = b.verses.length === 1 ? `${b.en} 1:1-${b.verses[0]}` : `${b.en} ${chapter}`;
    else ref = `${b.en} ${chapter}:${verse}${end > verse ? `-${end}` : ''}`;
    onPick(formatReference(ref));
  };

  bookSelect.addEventListener('change', () => {
    const b = book();
    if (!b) {
      for (const select of [chapterSelect, verseSelect, endSelect]) {
        select.replaceChildren();
        select.disabled = true;
      }
      return;
    }
    chapterSelect.replaceChildren(...numberOptions(1, b.verses.length, '장'));
    chapterSelect.disabled = false;
    fillVerses(1, 1);
    emit();
  });
  chapterSelect.addEventListener('change', () => {
    fillVerses(1, 1);
    emit();
  });
  verseSelect.addEventListener('change', () => {
    const verse = Number(verseSelect.value);
    fillVerses(verse, verse);
    emit();
  });
  endSelect.addEventListener('change', emit);

  /** Shows a typed or saved reference in the lists. */
  const show = (text) => {
    const ref = parseReference(text);
    if (!ref?.book || referenceProblem(text)) return;
    bookSelect.value = ref.book.usfm;
    chapterSelect.replaceChildren(...numberOptions(1, ref.book.verses.length, '장'));
    chapterSelect.value = String(ref.chapter);
    chapterSelect.disabled = false;
    fillVerses(ref.verse ?? 0, ref.verseEnd ?? ref.verse ?? 0);
  };

  const element = h(
    'div',
    { class: 'picker' },
    h('label', { for: 'pick-book', class: 'sr-only' }, '책'),
    bookSelect,
    h(
      'div',
      { class: 'picker-row' },
      h('label', { for: 'pick-chapter', class: 'sr-only' }, '장'),
      chapterSelect,
      h('label', { for: 'pick-verse', class: 'sr-only' }, '시작 절'),
      verseSelect,
      h('span', { class: 'tilde', 'aria-hidden': 'true' }, '~'),
      h('label', { for: 'pick-verse-end', class: 'sr-only' }, '끝 절'),
      endSelect,
    ),
  );
  return { element, show };
}

function stepTitle(id, number, ...label) {
  return h('h2', { id, class: 'step-title' }, h('span', { class: 'step-no', 'aria-hidden': 'true' }, number), ...label);
}

function renderEditor(id) {
  const verse = id ? store.getVerse(state, id) : null;
  if (id && !verse) {
    renderNotFound();
    return;
  }
  const draft = verse ? null : loadDraft();
  const start = verse ?? draft ?? {};

  const refInput = h('input', {
    id: 'verse-ref',
    type: 'text',
    autocomplete: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
    placeholder: '예: John 3:16 또는 요 3:16',
    value: start.ref ?? '',
  });
  const refHint = h('p', { class: 'field-hint', id: 'verse-ref-hint' });
  const openLink = h('a', { class: 'btn ghost', id: 'open-niv', target: '_blank', rel: 'noopener', hidden: true }, 'NIV 본문 열기', icon('external'));
  const textInput = h('textarea', {
    id: 'verse-text',
    class: 'verse-input',
    rows: '7',
    spellcheck: 'false',
    autocorrect: 'off',
    placeholder: '여기에 NIV 본문을 붙여넣으세요.',
    value: start.text ?? '',
  });
  const pasteWarning = h('p', { class: 'field-warn', role: 'status', hidden: true });
  const textHint = h('p', { class: 'field-hint', id: 'verse-text-hint' });
  const tagInput = h('input', {
    id: 'verse-tag',
    type: 'text',
    maxlength: '24',
    placeholder: '예: 구원의 확신',
    'aria-labelledby': 'step-3',
    value: start.tag ?? '',
  });
  const koVersionNow = koreanVersion();
  const koInput = h('textarea', {
    id: 'verse-ko',
    class: 'ko-input',
    rows: '4',
    lang: 'ko',
    spellcheck: 'false',
    placeholder: koVersionNow ? `${koVersionNow.title} 본문이 자동으로 채워져요. 직접 적어도 돼요.` : '한글 본문을 붙여넣거나 적어 주세요. (선택)',
    value: start.ko ?? '',
  });
  const koHint = h('p', { class: 'field-hint', id: 'verse-ko-hint', role: 'status' });
  // Korean text filled in from YouVersion; a new pick may replace it, hand edits are kept.
  let koAuto = verse?.koVersion > 0 ? verse.ko : '';
  let koAutoVersion = verse?.koVersion ?? 0;
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const appKey = youversionKey();
  const fetchStatus = h('p', { class: 'field-hint', id: 'fetch-status', role: 'status', hidden: true });
  let pastedRef = '';
  let autoText = ''; // text filled in from YouVersion; a new pick may replace it
  let fetchController = null;
  let fetchTimer = 0;

  const refreshHints = () => {
    const ref = refInput.value.trim();
    const problem = referenceProblem(ref);
    refHint.classList.toggle('is-error', Boolean(problem));
    if (problem) refHint.textContent = problem;
    else if (parseReference(ref)?.book) refHint.textContent = `${formatReference(ref)} · ${koreanReference(ref)}`;
    else refHint.textContent = ref ? '책 이름을 알아보지 못했어요. 적은 그대로 저장돼요.' : '위에서 고르거나 직접 적어도 돼요.';

    const url = bibleComUrl(ref);
    openLink.hidden = !url;
    if (url) openLink.href = url;

    const words = countWords(textInput.value);
    textHint.textContent = words
      ? `${words}단어 · 한 단어씩 채점하니 본문이 정확한지 꼭 확인해 주세요.`
      : '붙여넣으면 절 번호, 각주 표시([a]), 링크는 자동으로 지워져요.';
    if (!words) pastedRef = '';
    const mismatch = pastedRef && pastedRef !== formatReference(ref);
    pasteWarning.hidden = !mismatch;
    if (mismatch) pasteWarning.textContent = `붙여넣은 본문은 ${pastedRef}이라고 되어 있어요. 장절이 맞는지 확인해 주세요.`;

    if (!verse) saveDraft({ ref: refInput.value, text: textInput.value, tag: tagInput.value, ko: koInput.value });
  };

  const showFetchStatus = (message, kind) => {
    fetchStatus.textContent = message;
    fetchStatus.className = `field-hint is-${kind}`;
    fetchStatus.hidden = false;
  };

  // Fills in the NIV text for the chosen reference. Text the user typed or
  // pasted is only replaced when they ask for it (force).
  const fetchText = async ({ force = false } = {}) => {
    clearTimeout(fetchTimer);
    if (!appKey) return;
    const ref = refInput.value.trim();
    const id = passageId(ref);
    if (!id) {
      if (force) showFetchStatus('먼저 구절을 골라 주세요.', 'error');
      return;
    }
    const current = textInput.value.trim();
    if (!force && current && current !== autoText) return;
    fetchController?.abort();
    const controller = new AbortController();
    fetchController = controller;
    showFetchStatus(`${formatReference(ref)} 본문을 YouVersion에서 가져오는 중…`, 'busy');
    const kv = koreanVersion();
    const koCurrent = koInput.value.trim();
    const wantKorean = kv && (force || !koCurrent || koCurrent === koAuto);
    const korean = wantKorean ? fetchPassage(appKey, kv.id, id, { signal: controller.signal }).catch((err) => err) : null;
    try {
      const { text } = await fetchNivPassage(appKey, id, { signal: controller.signal });
      if (fetchController !== controller) return;
      textInput.value = text;
      autoText = text;
      pastedRef = '';
      showFetchStatus(`YouVersion에서 ${formatReference(ref)} 본문을 가져왔어요. 확인하고 저장하세요.`, 'ok');
      refreshHints();
    } catch (err) {
      if (err?.name === 'AbortError' || fetchController !== controller) return;
      showFetchStatus(fetchErrorMessage(err), 'error');
    }
    const ko = await korean;
    if (!ko || fetchController !== controller || ko?.name === 'AbortError') return;
    if (ko instanceof Error) {
      koHint.className = 'field-hint is-error';
      koHint.textContent = koreanProblemMessage(ko);
      return;
    }
    koInput.value = ko.text;
    koAuto = ko.text;
    koAutoVersion = kv.id;
    koHint.className = 'field-hint';
    koHint.textContent = `${kv.title} 본문을 가져왔어요.`;
    refreshHints();
  };
  const scheduleFetch = () => {
    clearTimeout(fetchTimer);
    fetchTimer = setTimeout(fetchText, 600);
  };

  const picker = versePicker((ref) => {
    refInput.value = ref;
    refreshHints();
    scheduleFetch();
  });

  const insertPasted = (raw, replaceAll) => {
    const { text, reference } = cleanPastedVerse(raw);
    if (replaceAll) textInput.value = text;
    else textInput.setRangeText(text, textInput.selectionStart, textInput.selectionEnd, 'end');
    if (reference) {
      if (!refInput.value.trim()) {
        refInput.value = reference;
        picker.show(reference);
      }
      pastedRef = reference;
    }
    refreshHints();
  };

  const pasteButton = h(
    'button',
    {
      type: 'button',
      class: 'btn ghost',
      onclick: async () => {
        try {
          const copied = await navigator.clipboard.readText();
          if (!copied.trim()) {
            toast('복사된 내용이 없어요. 성경 앱에서 구절을 먼저 복사해 주세요.');
            return;
          }
          insertPasted(copied, true);
        } catch {
          toast('본문 칸을 길게 눌러서 붙여넣어 주세요.');
          textInput.focus();
        }
      },
    },
    icon('clipboard'),
    '붙여넣기',
  );

  refInput.addEventListener('input', () => {
    picker.show(refInput.value);
    refreshHints();
    scheduleFetch();
  });
  textInput.addEventListener('input', refreshHints);
  tagInput.addEventListener('input', refreshHints);
  koInput.addEventListener('input', refreshHints);
  textInput.addEventListener('paste', (event) => {
    const pasted = event.clipboardData?.getData('text/plain');
    if (!pasted) return;
    event.preventDefault();
    insertPasted(pasted, false);
  });
  picker.show(refInput.value);
  refreshHints();
  if (appKey && !textInput.value.trim() && passageId(refInput.value.trim())) fetchText();

  const form = h(
    'form',
    { class: 'editor', novalidate: true },
    h(
      'section',
      { class: 'step', 'aria-labelledby': 'step-1' },
      stepTitle('step-1', '1', '구절 고르기'),
      picker.element,
      h('div', { class: 'field' }, h('label', { for: 'verse-ref' }, '장절'), refInput, refHint),
    ),
    h(
      'section',
      { class: 'step', 'aria-labelledby': 'step-2' },
      stepTitle('step-2', '2', h('span', { class: 'latin' }, 'NIV'), ' 본문 가져오기'),
      appKey
        ? h('p', { class: 'field-hint' }, '구절을 고르면 YouVersion에서 NIV 본문을 자동으로 가져와요. 안 되면 ‘NIV 본문 열기’로 복사해서 붙여넣을 수 있어요.')
        : h(
            'p',
            { class: 'field-hint' },
            '‘NIV 본문 열기’를 누르면 성경 앱(YouVersion)이나 bible.com에서 그 구절이 NIV로 열려요. 구절을 길게 눌러 복사한 뒤 돌아와서 ‘붙여넣기’를 누르세요. ',
            h('a', { href: '#/settings' }, '설정'),
            '에서 YouVersion 앱 키를 넣으면 본문이 자동으로 채워져요.',
          ),
      h(
        'div',
        { class: 'row' },
        appKey ? h('button', { type: 'button', class: 'btn ghost', id: 'fetch-niv', onclick: () => fetchText({ force: true }) }, icon('retry'), '자동으로 가져오기') : null,
        openLink,
        pasteButton,
      ),
      h('div', { class: 'field' }, h('label', { for: 'verse-text' }, 'NIV 본문'), textInput, fetchStatus, pasteWarning, textHint),
      h('div', { class: 'field' }, h('label', { for: 'verse-ko' }, '한글 본문 ', h('span', { class: 'optional' }, koVersionNow ? `선택 · ${koVersionNow.title}` : '선택')), koInput, koHint),
    ),
    h('section', { class: 'step', 'aria-labelledby': 'step-3' }, stepTitle('step-3', '3', '주제 ', h('span', { class: 'optional' }, '선택')), tagInput),
    error,
    h('div', { class: 'row' }, h('button', { type: 'submit', class: 'btn primary' }, '저장')),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const ref = refInput.value.trim();
    const text = textInput.value.replace(/\s+/g, ' ').trim();
    const problem = referenceProblem(ref);
    error.hidden = true;
    if (!ref || problem || !countWords(text)) {
      error.textContent = !ref ? '구절을 골라 주세요.' : problem ? `장절을 확인해 주세요. ${problem}` : 'NIV 본문을 붙여넣어 주세요.';
      error.hidden = false;
      (!ref || problem ? refInput : textInput).focus();
      return;
    }
    const ko = koInput.value.replace(/\s+/g, ' ').trim();
    const saved = store.upsertVerse(state, {
      id: verse?.id,
      ref: parseReference(ref)?.book ? formatReference(ref) : ref,
      text,
      tag: tagInput.value.trim(),
      ko,
      koVersion: ko && ko === koAuto.replace(/\s+/g, ' ').trim() ? koAutoVersion : 0,
    });
    commit(saved.state);
    if (!verse) clearDraft();
    toast('저장했어요');
    go(`#/v/${saved.id}`);
  });

  show(
    h('nav', { class: 'bar' }, h('a', { class: 'back', href: verse ? `#/v/${verse.id}` : '#/' }, icon('back'), verse ? '구절' : '목록')),
    h('h1', { class: 'page-title' }, verse ? '구절 편집' : '새 구절'),
    form,
    verse ? deleteControl(verse) : h('p', { class: 'fine' }, 'NIV 전체 본문은 저작권 때문에 앱에 넣을 수 없어서, 고른 구절을 성경 앱에서 가져오도록 했어요.'),
  );
}

function deleteControl(verse) {
  const confirmBox = h(
    'div',
    { class: 'confirm', hidden: true },
    h('p', {}, '이 구절과 연습 기록을 모두 지울까요? 되돌릴 수 없어요.'),
    h(
      'div',
      { class: 'row' },
      h(
        'button',
        {
          type: 'button',
          class: 'btn danger',
          onclick: () => {
            commit(store.removeVerse(state, verse.id));
            toast('삭제했어요');
            go('#/');
          },
        },
        '삭제',
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'btn ghost',
          onclick: () => {
            confirmBox.hidden = true;
            opener.hidden = false;
          },
        },
        '취소',
      ),
    ),
  );
  const opener = h(
    'button',
    {
      type: 'button',
      class: 'link-button danger-text',
      onclick: () => {
        confirmBox.hidden = false;
        opener.hidden = true;
      },
    },
    '이 구절 삭제',
  );
  return h('div', { class: 'danger-zone' }, opener, confirmBox);
}

// --- Assignments: send, receive, join ---

function isoDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function renderShare() {
  const key = youversionKey();
  const week = new Date();
  week.setDate(week.getDate() + 7);
  const titleInput = h('input', { id: 'share-title', type: 'text', maxlength: '60', value: `${new Date().getMonth() + 1}월 말씀 암송` });
  const dueInput = h('input', { id: 'share-due', type: 'date', value: isoDate(week) });
  const fromInput = h('input', { id: 'share-from', type: 'text', maxlength: '30', placeholder: '예: 구모세', value: myName() });
  const keyInput = h('input', { id: 'share-key', type: 'checkbox', checked: Boolean(key), disabled: !key });
  const boxes = state.verses
    .filter((v) => parseReference(v.ref)?.book)
    .map((v) => ({ verse: v, input: h('input', { type: 'checkbox', value: v.id, 'aria-label': v.ref }) }));
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const output = h('section', { class: 'section', id: 'share-output', hidden: true });

  const make = () => {
    const refs = boxes.filter((b) => b.input.checked).map((b) => formatReference(b.verse.ref));
    const title = titleInput.value.trim() || '말씀 암송 과제';
    error.hidden = Boolean(refs.length);
    if (!refs.length) {
      error.textContent = '보낼 구절을 하나 이상 골라 주세요.';
      return;
    }
    const from = fromInput.value.trim();
    if (from && from !== myName()) commit(store.setSetting(state, 'name', from));
    const code = encodeAssignment({ id: newAssignmentId(), title, due: dueInput.value, refs, from, key: keyInput.checked ? key : '' });
    const url = `${location.origin}${location.pathname}#/join/${code}`;
    const message = invitationMessage({ title, due: dueInput.value, refs, from, url });
    output.replaceChildren(
      h('h2', {}, '과제 링크가 만들어졌어요'),
      h('p', { class: 'message-preview', id: 'share-message' }, message),
      h(
        'div',
        { class: 'row' },
        h('button', { type: 'button', class: 'btn primary', onclick: () => shareText(message, title) }, icon('share'), '카톡으로 보내기'),
        h(
          'button',
          {
            type: 'button',
            class: 'btn ghost',
            onclick: () =>
              navigator.clipboard.writeText(message).then(
                () => toast('복사했어요. 단톡방에 붙여넣어 주세요.'),
                () => toast('복사하지 못했어요. 글을 길게 눌러 복사해 주세요.'),
              ),
          },
          '복사하기',
        ),
      ),
      h('p', { class: 'fine' }, '받은 분이 링크를 누르면 이 구절들이 그분의 앱에 들어가요. 다 외우면 ‘결과 보내기’로 단톡방에 점수를 올릴 수 있어요.'),
    );
    output.hidden = false;
    output.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  show(
    h('nav', { class: 'bar' }, h('a', { class: 'back', href: '#/' }, icon('back'), '목록')),
    h('h1', { class: 'page-title' }, '과제 보내기'),
    h('p', { class: 'fine' }, '함께 외울 구절을 골라 링크로 보내요. 링크에는 장절만 들어가고, 본문은 받는 분 휴대폰이 YouVersion에서 가져와요.'),
    h(
      'form',
      { class: 'editor', novalidate: true, onsubmit: (event) => (event.preventDefault(), make()) },
      h('div', { class: 'field' }, h('label', { for: 'share-title' }, '과제 이름'), titleInput),
      h('div', { class: 'field' }, h('label', { for: 'share-due' }, '마감일 ', h('span', { class: 'optional' }, '선택')), dueInput),
      h('div', { class: 'field' }, h('label', { for: 'share-from' }, '보내는 사람'), fromInput),
      h(
        'fieldset',
        { class: 'field verse-checks' },
        h('legend', {}, '구절'),
        boxes.length
          ? boxes.map(({ verse, input }) =>
              h('label', { class: 'check-row' }, input, h('span', { class: 'check-ref' }, verse.ref), h('span', { class: 'check-ko' }, koreanReference(verse.ref))),
            )
          : h('p', { class: 'fine' }, '먼저 ‘새 구절 추가’로 보낼 구절을 넣어 주세요.'),
      ),
      h(
        'label',
        { class: 'check-row key-row' },
        keyInput,
        h(
          'span',
          {},
          key ? '내 YouVersion 앱 키도 함께 보내기' : 'YouVersion 앱 키가 없어요',
          h('small', {}, key ? '받는 분이 따로 설정하지 않아도 본문이 자동으로 채워져요. 키는 이 링크를 받은 사람만 알 수 있어요.' : '설정에서 키를 넣으면 받는 분도 본문이 자동으로 채워져요.'),
        ),
      ),
      error,
      h('div', { class: 'row' }, h('button', { type: 'submit', class: 'btn primary' }, '링크 만들기')),
    ),
    output,
  );
}

function renderReceive() {
  const input = h('textarea', { id: 'receive-link', rows: '4', placeholder: '단톡방에서 받은 과제 링크를 붙여넣으세요.' });
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const open = (text) => {
    const code = findAssignmentCode(text);
    if (!code || !decodeAssignment(code)) {
      error.textContent = '과제 링크를 찾지 못했어요. 링크 전체를 복사했는지 확인해 주세요.';
      error.hidden = false;
      return;
    }
    go(`#/join/${code}`);
  };
  show(
    h('nav', { class: 'bar' }, h('a', { class: 'back', href: '#/' }, icon('back'), '목록')),
    h('h1', { class: 'page-title' }, '과제 받기'),
    h('p', { class: 'fine' }, '단톡방에서 받은 링크를 누르면 바로 열려요. 홈 화면에 추가한 앱으로 받으려면 링크를 복사해서 여기에 붙여넣으세요.'),
    h('label', { for: 'receive-link', class: 'sr-only' }, '과제 링크'),
    input,
    error,
    h(
      'div',
      { class: 'row' },
      h('button', { type: 'button', class: 'btn primary', onclick: () => open(input.value) }, '과제 열기'),
      h(
        'button',
        {
          type: 'button',
          class: 'btn ghost',
          onclick: async () => {
            try {
              const text = await navigator.clipboard.readText();
              input.value = text;
              open(text);
            } catch {
              toast('칸을 길게 눌러서 붙여넣어 주세요.');
              input.focus();
            }
          },
        },
        icon('clipboard'),
        '붙여넣기',
      ),
    ),
  );
}

/** Adds an assignment's verses (fetching their text) and the assignment itself. */
async function joinAssignment(assignment, onProgress) {
  if (assignment.key && !youversionKey()) commit(store.setSetting(state, 'youversionKey', assignment.key));
  const key = youversionKey();
  const verseIds = [];
  let missingText = 0;
  let problem = null;
  for (const [index, ref] of assignment.refs.entries()) {
    onProgress?.(index + 1, assignment.refs.length);
    let verse = state.verses.find((v) => formatReference(v.ref) === ref);
    if (!verse) {
      let text = '';
      if (key && !problem) {
        try {
          text = (await fetchNivPassage(key, passageId(ref))).text;
        } catch (err) {
          problem = err;
        }
      }
      if (!text) missingText++;
      const added = store.upsertVerse(state, { ref, text, tag: assignment.title });
      commit(added.state);
      verse = store.getVerse(state, added.id);
    }
    verseIds.push(verse.id);
  }
  const record = { id: assignment.id || newAssignmentId(), title: assignment.title, due: assignment.due, from: assignment.from, verseIds, receivedAt: Date.now() };
  commit(store.addAssignment(state, record).state);
  fillKoreanTexts();
  return { missingText, problem };
}

function renderJoin(code) {
  const assignment = decodeAssignment(code);
  const nav = h('nav', { class: 'bar' }, h('a', { class: 'back', href: '#/' }, icon('back'), '목록'));
  if (!assignment) {
    show(nav, h('h1', { class: 'page-title' }, '과제 받기'), h('p', { class: 'notice' }, '과제 링크가 올바르지 않아요. 보낸 분께 링크를 다시 받아 주세요.'));
    return;
  }
  if (IN_KAKAOTALK) {
    // Opening inside KakaoTalk would put the verses in KakaoTalk's own copy of the app.
    const tried = `kakao-out:${code}`;
    try {
      if (!sessionStorage.getItem(tried)) {
        sessionStorage.setItem(tried, '1');
        openOutsideKakao();
      }
    } catch {
      // storage blocked: just show the button
    }
  }
  const already = (state.assignments ?? []).some((a) => assignment.id && a.id === assignment.id);
  const status = h('p', { class: 'field-hint', role: 'status' });
  const add = async (button) => {
    button.disabled = true;
    status.className = 'field-hint is-busy';
    const { missingText, problem } = await joinAssignment(assignment, (done, total) => {
      status.textContent = `구절을 넣는 중… ${done}/${total}`;
    });
    if (missingText) {
      toast(problem ? `${fetchErrorMessage(problem)} 본문이 없는 구절은 눌러서 넣어 주세요.` : `${missingText}구절은 본문을 직접 넣어 주세요.`);
    } else {
      toast('과제를 받았어요');
    }
    go('#/');
  };
  const addButton = h('button', { type: 'button', class: 'btn primary', onclick: (event) => add(event.currentTarget) }, '내 목록에 추가');
  show(
    nav,
    IN_KAKAOTALK ? kakaoNotice() : null,
    h('h1', { class: 'page-title' }, assignment.title),
    h(
      'p',
      { class: 'fine' },
      [assignment.from && `${assignment.from}님이 보낸 과제예요.`, assignment.due && `${dueText(assignment.due)}까지 (${dueLabel(assignment.due)})`].filter(Boolean).join(' '),
    ),
    h(
      'ul',
      { class: 'join-list' },
      assignment.refs.map((ref) => h('li', {}, h('span', { class: 'check-ref' }, ref), h('span', { class: 'check-ko' }, koreanReference(ref)))),
    ),
    already
      ? h('p', { class: 'notice info' }, '이미 받은 과제예요. 목록에서 확인하세요.')
      : h(
          'p',
          { class: 'fine' },
          assignment.key || youversionKey() ? 'NIV 본문은 YouVersion에서 자동으로 가져와요.' : '이 링크에는 YouVersion 키가 없어서, 본문은 구절마다 직접 넣어야 해요.',
        ),
    h('div', { class: 'row' }, already ? h('a', { class: 'btn primary', href: '#/' }, '목록으로') : addButton),
    status,
  );
}

// --- Settings and help ---

function nameSettings() {
  const input = h('input', { id: 'my-name', type: 'text', maxlength: '30', placeholder: '예: 구모세', value: myName() });
  input.addEventListener('change', () => {
    commit(store.setSetting(state, 'name', input.value.trim()));
    toast('이름을 저장했어요');
  });
  return h(
    'section',
    { class: 'section prose' },
    h('h2', {}, '함께 암송하기'),
    h('p', {}, '목록 아래 ‘과제 보내기’로 구절을 골라 단톡방에 링크를 보내면, 받은 분들 앱에 그 구절이 들어가요. 다 외우면 결과 화면의 ‘결과 보내기’로 점수를 단톡방에 올려요.'),
    h('label', { for: 'my-name' }, '결과에 들어갈 내 이름'),
    input,
  );
}

function youversionSettings() {
  const keyInput = h('input', {
    id: 'yv-key',
    type: 'text',
    autocomplete: 'off',
    autocorrect: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    placeholder: 'YouVersion 앱 키 붙여넣기',
    value: youversionKey(),
  });
  const status = h('p', { class: 'field-hint', id: 'yv-key-status', role: 'status' });
  const saveKey = () => commit(store.setSetting(state, 'youversionKey', keyInput.value.trim()));
  keyInput.addEventListener('change', () => {
    saveKey();
    status.className = 'field-hint';
    status.textContent = keyInput.value.trim() ? '저장했어요. ‘연결 확인’을 눌러 보세요.' : '키를 지웠어요. 본문은 직접 붙여넣어야 해요.';
  });
  const koSelect = h('select', { id: 'ko-version' });
  const koStatus = h('p', { class: 'field-hint', id: 'ko-status', role: 'status' });
  const koBlock = h(
    'div',
    { class: 'field', hidden: !youversionKey() },
    h('label', { for: 'ko-version' }, '한글 본문'),
    koSelect,
    koStatus,
  );

  const fillOptions = (versions) => {
    const chosen = state.settings.koreanVersionId;
    const options = [h('option', { value: '-1' }, '보여 주지 않기')];
    for (const v of versions) options.push(h('option', { value: String(v.id) }, `${v.title}${v.abbreviation ? ` (${v.abbreviation})` : ''}`));
    koSelect.replaceChildren(...options);
    const current = koreanVersion();
    if (current && !versions.some((v) => v.id === current.id)) {
      koSelect.append(h('option', { value: String(current.id) }, current.title || String(current.id)));
    }
    koSelect.value = chosen === -1 ? '-1' : String(current?.id ?? preferredKoreanVersion(versions)?.id ?? -1);
  };

  const fillKorean = async () => {
    koStatus.className = 'field-hint is-busy';
    koStatus.textContent = '한글 본문을 가져오는 중…';
    await fillKoreanTexts((done, total) => {
      koStatus.textContent = `한글 본문을 가져오는 중… ${done}/${total}`;
    });
    if (koreanProblem) {
      koStatus.className = 'field-hint is-error';
      koStatus.textContent = koreanProblemMessage(koreanProblem);
    } else if (koreanVersion()) {
      const missing = store.versesNeedingKorean(state, koreanVersion().id).length;
      koStatus.className = 'field-hint is-ok';
      koStatus.textContent = missing ? `한글 본문을 넣었어요. ${missing}구절은 찾지 못했어요.` : `모든 구절에 ${koreanVersion().title} 본문이 들어갔어요.`;
    } else {
      koStatus.className = 'field-hint';
      koStatus.textContent = '한글 본문을 보여 주지 않아요.';
    }
  };

  const showKoreanOptions = async () => {
    const key = youversionKey();
    koBlock.hidden = !key;
    if (!key) return;
    fillOptions(await loadKoreanVersions(key));
    if (!koreanVersion() && state.settings.koreanVersionId !== -1) {
      const pick = preferredKoreanVersion(koreanVersions);
      if (pick) setKoreanVersion(pick);
    }
    await fillKorean();
  };

  koSelect.addEventListener('change', () => {
    const id = Number(koSelect.value);
    const version = (koreanVersions ?? KNOWN_KOREAN_VERSIONS).find((v) => v.id === id) ?? null;
    setKoreanVersion(version);
    fillKorean();
  });

  const test = async () => {
    saveKey();
    const key = youversionKey();
    if (!key) {
      status.className = 'field-hint is-error';
      status.textContent = '앱 키를 먼저 붙여넣어 주세요.';
      koBlock.hidden = true;
      return;
    }
    status.className = 'field-hint is-busy';
    status.textContent = 'John 3:16으로 확인하는 중…';
    try {
      const { text } = await fetchNivPassage(key, 'JHN.3.16');
      status.className = 'field-hint is-ok';
      status.textContent = `연결됐어요. “${text.split(' ').slice(0, 6).join(' ')}…” 이제 구절을 고르면 NIV 본문이 자동으로 채워져요.`;
      koreanVersions = null;
      showKoreanOptions();
    } catch (err) {
      status.className = 'field-hint is-error';
      status.textContent = fetchErrorMessage(err);
    }
  };
  if (youversionKey()) showKoreanOptions();
  return h(
    'section',
    { class: 'section prose' },
    h('h2', {}, '본문 자동으로 가져오기'),
    h('p', {}, 'YouVersion 앱 키를 넣으면, 구절만 고르면 NIV 본문이 자동으로 채워져요. 처음 한 번만 하면 돼요.'),
    h(
      'ol',
      {},
      h('li', {}, h('a', { href: 'https://platform.youversion.com/', target: '_blank', rel: 'noopener' }, 'platform.youversion.com'), '에 YouVersion(성경 앱) 계정으로 로그인해요.'),
      h('li', {}, '앱을 하나 만들고(이름은 아무거나, 예: 말씀 암송) 앱 키(App Key)를 복사해요.'),
      h('li', {}, '번역본 사용 신청이 있으면 NIV를 신청해요.'),
      h('li', {}, '아래 칸에 붙여넣고 ‘연결 확인’을 눌러요.'),
    ),
    h('label', { for: 'yv-key', class: 'sr-only' }, 'YouVersion 앱 키'),
    keyInput,
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn ghost', onclick: test }, '연결 확인')),
    status,
    koBlock,
    h('p', { class: 'fine' }, '키는 이 기기에만 저장돼요. 가져온 본문은 내 암송 연습에만 써 주세요.'),
  );
}

function renderSettings() {
  const fileInput = h('input', { id: 'backup-file', type: 'file', accept: 'application/json,.json', class: 'sr-only' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const { state: merged, added } = store.importState(state, await file.text());
      commit(merged);
      toast(added ? `${added}구절을 가져왔어요` : '기록을 합쳤어요. 새 구절은 없었어요.');
    } catch (err) {
      toast(err.message);
    }
    fileInput.value = '';
  });

  const exportBackup = () => {
    const blob = new Blob([store.exportState(state)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, download: `niv-recite-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const restore = () => {
    const { state: next, added } = store.restoreStarters(state);
    commit(next);
    toast(added ? `기본 구절 ${added}개를 다시 넣었어요` : '기본 구절이 모두 있어요');
  };

  show(
    h('nav', { class: 'bar' }, h('a', { class: 'back', href: '#/' }, icon('back'), '목록')),
    h('h1', { class: 'page-title' }, '설정과 도움말'),
    h(
      'section',
      { class: 'section prose' },
      h('h2', {}, '채점 방식'),
      h(
        'ul',
        {},
        h('li', {}, '본문과 한 단어씩 맞춰 봐요. ‘plans’를 ‘plan’이라고 하면 틀린 거예요.'),
        h('li', {}, '대소문자, 문장부호, 숫자 표기(1 ↔ one)는 보지 않아요.'),
        h('li', {}, '음성으로 할 때는 소리가 같은 단어(Son ↔ sun)를 맞게 처리해요. 마이크로는 구별할 수 없으니까요.'),
        h('li', {}, '장절(John 3:16)을 앞뒤에 말해도 채점에서 빠져요.'),
        h('li', {}, `최근 ${store.MASTERY_STREAK}번을 연속으로 100% 맞히면 ‘암송 완료’가 돼요.`),
      ),
    ),
    h(
      'section',
      { class: 'section prose' },
      h('h2', {}, '구절 추가하기'),
      h(
        'ul',
        {},
        h('li', {}, '‘새 구절 추가’에서 성경 66권 중 책, 장, 절을 고르세요. 여러 절이나 장 전체도 고를 수 있어요.'),
        h('li', {}, '‘NIV 본문 열기’를 누르면 성경 앱(YouVersion)이나 bible.com에서 그 구절이 NIV로 열려요. 길게 눌러 복사한 뒤 돌아와 ‘붙여넣기’를 누르세요.'),
        h('li', {}, 'NIV 전체 본문은 Biblica의 저작물이라 앱 안에 넣어 둘 수 없어서 이렇게 가져와요.'),
      ),
    ),
    nameSettings(),
    youversionSettings(),
    h(
      'section',
      { class: 'section prose' },
      h('h2', {}, '음성 인식이 잘 되려면'),
      h(
        'ul',
        {},
        h('li', {}, 'iPhone은 Safari, 안드로이드와 PC는 Chrome을 쓰세요. 카카오톡 안의 브라우저에서는 안 될 수 있어요.'),
        h('li', {}, '조용한 곳에서 휴대폰을 입 가까이 두고, 단어를 또박또박 말해 주세요.'),
        h('li', {}, '문장 사이에 너무 오래 쉬지 마세요. 일부 안드로이드 폰은 잠깐 멈추면 인식이 끊겼다가 다시 시작되면서 단어를 놓칠 수 있어요.'),
        h('li', {}, '음성은 브라우저의 음성 인식 서비스(Google 또는 Apple)로 보내져 글자로 바뀌어요. 인터넷 연결이 필요해요.'),
        h('li', {}, '잘못 알아들은 단어는 결과 화면에서 눌러 맞음으로 바꿀 수 있어요.'),
      ),
    ),
    h(
      'section',
      { class: 'section prose' },
      h('h2', {}, '백업'),
      h('p', {}, '구절과 기록은 이 브라우저에만 저장돼요. 홈 화면에 추가해서 쓰면 더 안전하고, 기기를 바꿀 때는 백업 파일로 옮기세요.'),
      h(
        'div',
        { class: 'row' },
        h('button', { type: 'button', class: 'btn ghost', onclick: exportBackup }, '백업 파일 저장'),
        h('label', { for: 'backup-file', class: 'btn ghost' }, '백업 불러오기'),
        fileInput,
      ),
    ),
    h(
      'section',
      { class: 'section prose' },
      h('h2', {}, '기본 구절'),
      h('p', {}, '네비게이토 5확신 구절과 많이 외우는 구절 12개가 들어 있어요. 지운 기본 구절을 다시 넣을 수 있어요.'),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn ghost', onclick: restore }, '기본 구절 다시 넣기')),
    ),
    h(
      'section',
      { class: 'section prose' },
      h('h2', {}, '저작권'),
      h('p', { class: 'copyright' }, NIV_NOTICE),
      h('p', { class: 'copyright', id: 'ko-copyright', hidden: !koreanCopyrightText() }, koreanCopyrightText()),
      h('p', { class: 'fine' }, 'NIV 본문은 Biblica의 저작물이에요. 직접 추가한 구절은 이 기기에만 저장되고 어디에도 올라가지 않아요.'),
    ),
  );
}

// --- Start ---

window.addEventListener('hashchange', route);
route();
if (youversionKey()) fillKoreanTexts();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
