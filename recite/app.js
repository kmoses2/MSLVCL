// NIV recitation checker: verse list, practice (voice or typing), verse editor
// and settings. Plain DOM, no framework; screens are picked by the URL hash.

import { buildView, compareRecitation, summarize } from './lib/compare.js';
import { countWords, firstLetters, tokenize } from './lib/text.js';
import { formatReference, koreanReference, parseReference } from './lib/books.js';
import { cleanPastedVerse } from './lib/cleanup.js';
import { createListener, isSpeechSupported } from './lib/speech.js';
import { NIV_NOTICE } from './lib/starter.js';
import * as store from './lib/store.js';

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
const speechOk = isSpeechSupported();
const IN_APP_BROWSER = /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\//i.test(navigator.userAgent);

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
  app.replaceChildren(
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
    h('p', { class: 'tally' }, `${state.verses.length}구절 · 암송 완료 ${mastered}`),
    state.verses.length
      ? h('ol', { class: 'deck' }, state.verses.map((verse) => h('li', {}, verseCard(verse, progress.get(verse.id)))))
      : h('p', { class: 'empty' }, '아직 구절이 없어요. 외우고 싶은 NIV 구절을 추가해 보세요.'),
    h('a', { class: 'add-card', href: '#/add' }, icon('plus'), '새 구절 추가'),
    h('p', { class: 'footnote' }, 'NIV® © Biblica, Inc. · 구절과 기록은 이 기기에만 저장돼요 · ', h('a', { href: '#/settings' }, '도움말')),
  );
}

function verseCard(verse, progress) {
  const filled = Math.min(progress.streak, store.MASTERY_STREAK);
  return h(
    'a',
    { class: `card is-${progress.status}`, href: `#/v/${verse.id}` },
    h('div', { class: 'card-head' }, h('span', { class: 'ref' }, verse.ref), verse.tag ? h('span', { class: 'tag' }, verse.tag) : null),
    koreanReference(verse.ref) ? h('p', { class: 'ref-ko' }, koreanReference(verse.ref)) : null,
    h('p', { class: 'teaser', 'aria-hidden': 'true' }, firstLetters(verse.text)),
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
  app.replaceChildren(
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
  const body = h('div', { class: 'practice' });
  app.replaceChildren(
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
  const parts = [h('header', { class: 'verse-head' }, h('h1', { class: 'ref' }, verse.ref), meta ? h('p', { class: 'verse-meta' }, meta) : null)];
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
    IN_APP_BROWSER
      ? h('p', { class: 'notice info' }, '카카오톡 같은 앱 안의 브라우저에서는 음성 인식이 안 될 수 있어요. 메뉴에서 ‘다른 브라우저로 열기’를 눌러 Safari나 Chrome으로 열어 주세요.')
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
      h('a', { class: 'btn ghost', href: '#/' }, '목록으로'),
    ),
  );
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

function renderEditor(id) {
  const verse = id ? store.getVerse(state, id) : null;
  if (id && !verse) {
    renderNotFound();
    return;
  }
  const refInput = h('input', {
    id: 'verse-ref',
    type: 'text',
    autocomplete: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
    placeholder: '예: John 3:16 또는 요 3:16',
    value: verse?.ref ?? '',
  });
  const refHint = h('p', { class: 'field-hint', id: 'verse-ref-hint' });
  const textInput = h('textarea', {
    id: 'verse-text',
    class: 'verse-input',
    rows: '7',
    spellcheck: 'false',
    autocorrect: 'off',
    placeholder: '성경 앱이나 웹사이트에서 NIV 본문을 복사해 붙여넣으세요.',
    value: verse?.text ?? '',
  });
  const textHint = h('p', { class: 'field-hint', id: 'verse-text-hint' });
  const tagInput = h('input', { id: 'verse-tag', type: 'text', maxlength: '24', placeholder: '예: 구원의 확신', value: verse?.tag ?? '' });
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });

  const refreshHints = () => {
    const ref = refInput.value.trim();
    const parsed = parseReference(ref);
    if (parsed?.book) refHint.textContent = `${formatReference(ref)} · ${koreanReference(ref)}`;
    else refHint.textContent = ref ? '책 이름을 알아보지 못했어요. 적은 그대로 저장돼요.' : '영어나 한글 약어로 적어도 돼요.';
    const words = countWords(textInput.value);
    textHint.textContent = words
      ? `${words}단어 · 한 단어씩 채점하니 본문이 정확한지 꼭 확인해 주세요.`
      : '붙여넣으면 절 번호, 각주 표시([a]), 링크는 자동으로 지워져요.';
  };
  refInput.addEventListener('input', refreshHints);
  textInput.addEventListener('input', refreshHints);
  textInput.addEventListener('paste', (event) => {
    const pasted = event.clipboardData?.getData('text/plain');
    if (!pasted) return;
    event.preventDefault();
    const { text, reference } = cleanPastedVerse(pasted);
    textInput.setRangeText(text, textInput.selectionStart, textInput.selectionEnd, 'end');
    if (reference && !refInput.value.trim()) refInput.value = reference;
    refreshHints();
  });
  refreshHints();

  const form = h(
    'form',
    { class: 'editor', novalidate: true },
    h('div', { class: 'field' }, h('label', { for: 'verse-ref' }, '장절'), refInput, refHint),
    h('div', { class: 'field' }, h('label', { for: 'verse-text' }, 'NIV 본문'), textInput, textHint),
    h('div', { class: 'field' }, h('label', { for: 'verse-tag' }, '주제 ', h('span', { class: 'optional' }, '선택')), tagInput),
    error,
    h('div', { class: 'row' }, h('button', { type: 'submit', class: 'btn primary' }, '저장')),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const ref = refInput.value.trim();
    const text = textInput.value.replace(/\s+/g, ' ').trim();
    error.hidden = true;
    if (!ref || !countWords(text)) {
      error.textContent = !ref ? '장절을 적어 주세요.' : 'NIV 본문을 붙여넣어 주세요.';
      error.hidden = false;
      (!ref ? refInput : textInput).focus();
      return;
    }
    const saved = store.upsertVerse(state, {
      id: verse?.id,
      ref: parseReference(ref)?.book ? formatReference(ref) : ref,
      text,
      tag: tagInput.value.trim(),
    });
    commit(saved.state);
    toast('저장했어요');
    go(`#/v/${saved.id}`);
  });

  app.replaceChildren(
    h('nav', { class: 'bar' }, h('a', { class: 'back', href: verse ? `#/v/${verse.id}` : '#/' }, icon('back'), verse ? '구절' : '목록')),
    h('h1', { class: 'page-title' }, verse ? '구절 편집' : '새 구절'),
    form,
    verse ? deleteControl(verse) : h('p', { class: 'fine' }, 'NIV 본문은 YouVersion(성경 앱)이나 BibleGateway에서 번역본을 NIV로 고른 뒤 복사하면 돼요.'),
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

// --- Settings and help ---

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

  app.replaceChildren(
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
      h('p', { class: 'fine' }, 'NIV 본문은 Biblica의 저작물이에요. 직접 추가한 구절은 이 기기에만 저장되고 어디에도 올라가지 않아요.'),
    ),
  );
}

// --- Start ---

window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
