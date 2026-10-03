// Compares a recitation with the verse text, word by word.
//
// The two word sequences are aligned with an edit-distance table, so each verse
// word ends up correct, wrong (another word was said), or missing, and every
// word that is not in the verse is reported as extra. Nothing is fuzzy-matched:
// "plan" for "plans" is wrong. The only leniencies are ones a listener could not
// hear anyway: case, punctuation, digits vs. words, words written joined or
// apart ("every one"/"everyone"), British spelling, and in voice mode
// homophones ("Son"/"sun").

import { canonicalSpelling, levenshtein, NUMBER_WORDS, numberToWords, soundKey, toUnits } from './text.js';
import { parseReference, spokenBookWords } from './books.js';

const MATCH = 1;
const SUB = 2;
const DEL = 3;
const INS = 4;
const JOIN = 5; // two spoken words make one verse word ("every one" -> "everyone")
const SPLIT = 6; // one spoken word makes two verse words

function substitutionCost(a, b, cache) {
  const key = `${a}\u0000${b}`;
  let cost = cache.get(key);
  if (cost === undefined) {
    // Similar words ("plans"/"plan") cost 0.5–0.8 so they pair up first;
    // unrelated words cost 1. A swap always beats a deletion plus an insertion.
    const distance = levenshtein(a, b) / Math.max(a.length, b.length, 1);
    cost = distance > 0.6 ? 1 : 0.5 + distance / 2;
    cache.set(key, cost);
  }
  return cost;
}

/** Aligns verse keys E with spoken keys S; returns ops with unit indexes. */
export function align(E, S) {
  const n = E.length;
  const m = S.length;
  const width = m + 1;
  const cost = new Float64Array((n + 1) * width);
  const move = new Uint8Array((n + 1) * width);
  const cache = new Map();
  for (let i = 1; i <= n; i++) {
    cost[i * width] = i;
    move[i * width] = DEL;
  }
  for (let j = 1; j <= m; j++) {
    cost[j] = j;
    move[j] = INS;
  }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diag = cost[(i - 1) * width + j - 1];
      let best = Infinity;
      let step = 0;
      if (E[i - 1] === S[j - 1]) {
        best = diag;
        step = MATCH;
      }
      // On a tie, a deletion or insertion wins over a swap. The table is read
      // backwards, so a swap then lands on the first word of a changed phrase:
      // "submit to" said as "acknowledge" is submit→acknowledge, "to" missing.
      const del = cost[(i - 1) * width + j] + 1;
      if (del < best) {
        best = del;
        step = DEL;
      }
      const ins = cost[i * width + j - 1] + 1;
      if (ins < best) {
        best = ins;
        step = INS;
      }
      if (step !== MATCH) {
        const sub = diag + substitutionCost(E[i - 1], S[j - 1], cache);
        if (sub < best) {
          best = sub;
          step = SUB;
        }
      }
      if (j >= 2 && E[i - 1] === S[j - 2] + S[j - 1] && cost[(i - 1) * width + j - 2] < best) {
        best = cost[(i - 1) * width + j - 2];
        step = JOIN;
      }
      if (i >= 2 && S[j - 1] === E[i - 2] + E[i - 1] && cost[(i - 2) * width + j - 1] < best) {
        best = cost[(i - 2) * width + j - 1];
        step = SPLIT;
      }
      cost[i * width + j] = best;
      move[i * width + j] = step;
    }
  }

  const ops = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    switch (move[i * width + j]) {
      case MATCH:
        ops.push({ type: 'match', e: [i - 1], s: [j - 1] });
        i--;
        j--;
        break;
      case SUB:
        ops.push({ type: 'sub', e: [i - 1], s: [j - 1] });
        i--;
        j--;
        break;
      case DEL:
        ops.push({ type: 'del', e: [i - 1], s: [] });
        i--;
        break;
      case INS:
        ops.push({ type: 'ins', e: [], s: [j - 1] });
        j--;
        break;
      case JOIN:
        ops.push({ type: 'match', e: [i - 1], s: [j - 2, j - 1] });
        i--;
        j -= 2;
        break;
      case SPLIT:
        ops.push({ type: 'match', e: [i - 2, i - 1], s: [j - 1] });
        i -= 2;
        j--;
        break;
      default:
        throw new Error('alignment table is inconsistent');
    }
  }
  return ops.reverse();
}

// --- Spoken references ("John three sixteen") before or after the verse ---

const REFERENCE_FILLERS = new Set(['chapter', 'chapters', 'verse', 'verses', 'colon']);
const REFERENCE_JOINERS = new Set(['to', 'through', 'thru', 'and', 'dash', 'till']);
const NUMBERISH = new Set([...NUMBER_WORDS, 'first', 'second', 'third']);

function referenceMatcher(reference) {
  const ref = parseReference(reference);
  if (!ref) return null;
  const numbers = new Set(['hundred']);
  for (const n of ref.numbers) for (const word of numberToWords(n)) numbers.add(word);
  return { book: new Set(spokenBookWords(ref)), numbers };
}

// Returns the index just past a reference that starts at k, or -1.
function matchReferenceAt(words, k, matcher) {
  let i = k;
  let sawName = false;
  while (i < words.length && matcher.book.has(words[i])) {
    const numberish = NUMBERISH.has(words[i]);
    if (numberish && sawName) break; // "first John one nine": "one" is the chapter
    if (!numberish) sawName = true;
    i++;
  }
  if (!sawName) return -1;
  let sawNumber = false;
  while (i < words.length) {
    const word = words[i];
    if (matcher.numbers.has(word)) {
      sawNumber = true;
      i++;
    } else if (REFERENCE_FILLERS.has(word)) {
      i++;
    } else if (sawNumber && REFERENCE_JOINERS.has(word) && matcher.numbers.has(words[i + 1])) {
      i++;
    } else {
      break;
    }
  }
  return sawNumber ? i : -1;
}

/** The part of the spoken words that is the verse itself, without a spoken reference. */
export function findVerseSpan(words, reference) {
  const matcher = reference ? referenceMatcher(reference) : null;
  let start = 0;
  let end = words.length;
  if (!matcher) return { start, end };
  const leadEnd = matchReferenceAt(words, 0, matcher);
  if (leadEnd > 0) start = leadEnd;
  for (let k = Math.max(start, end - 16); k < end; k++) {
    if (matchReferenceAt(words, k, matcher) === end) {
      end = k;
      break;
    }
  }
  return { start, end };
}

function range(from, to) {
  return Array.from({ length: Math.max(0, to - from) }, (_, k) => from + k);
}

/**
 * Compares the verse text with what was said or typed.
 * mode 'voice' also accepts homophones; mode 'type' does not.
 */
export function compareRecitation(expectedText, spokenText, { mode = 'voice', reference = '' } = {}) {
  const expected = toUnits(expectedText);
  const spoken = toUnits(spokenText);
  const key = mode === 'voice' ? soundKey : canonicalSpelling;
  const spokenWords = spoken.units.map((unit) => unit.word);
  const { start, end } = findVerseSpan(spokenWords, reference);

  const core = align(
    expected.units.map((unit) => key(unit.word)),
    spokenWords.slice(start, end).map(key),
  ).map((op) => ({ ...op, s: op.s.map((j) => j + start) }));

  const ops = [];
  if (start > 0) ops.push({ type: 'ref', e: [], s: range(0, start) });
  ops.push(...core);
  if (end < spokenWords.length) ops.push({ type: 'ref', e: [], s: range(end, spokenWords.length) });

  for (const op of ops) {
    if (op.type !== 'match') continue;
    const said = op.s.map((j) => spoken.units[j].word).join('');
    const written = op.e.map((i) => expected.units[i].word).join('');
    if (said !== written) op.variant = true; // e.g. heard "sun" for "Son"
  }
  return { mode, reference, expected, spoken, ops };
}

/** Counts and score. `accepted` holds op indexes the user marked as recognition mistakes. */
export function summarize(result, accepted = new Set()) {
  const total = result.expected.units.length;
  let correct = 0;
  let wrong = 0;
  let missing = 0;
  let extra = 0;
  result.ops.forEach((op, index) => {
    const ok = accepted.has(index);
    if (op.type === 'match') correct += op.e.length;
    else if (op.type === 'sub') ok ? (correct += 1) : (wrong += 1);
    else if (op.type === 'del') ok ? (correct += 1) : (missing += 1);
    else if (op.type === 'ins' && !ok) extra += 1;
  });
  const denominator = total + extra;
  // Floor, so 100 means every word was right.
  const score = denominator ? Math.floor((correct / denominator) * 100) : 0;
  return { total, correct, wrong, missing, extra, score, perfect: total > 0 && wrong + missing + extra === 0 };
}

// What was said for the given spoken units, as the recognizer wrote it
// ("3:16", "Lord's") when the units cover whole tokens.
function spokenText(spoken, indexes, unitsPerToken) {
  if (!indexes.length) return '';
  const perToken = new Map();
  for (const j of indexes) perToken.set(spoken.units[j].token, (perToken.get(spoken.units[j].token) ?? 0) + 1);
  const tokens = [...perToken.keys()];
  if (tokens.every((t) => perToken.get(t) === unitsPerToken.get(t))) {
    return spoken.text.slice(spoken.tokens[tokens[0]].start, spoken.tokens[tokens[tokens.length - 1]].end);
  }
  return indexes.map((j) => spoken.units[j].word).join(' ');
}

/**
 * Display items in reading order:
 *   { kind: 'word', token, text, status: 'ok'|'wrong'|'missing', heard, variant, op, accepted }
 *   { kind: 'extra' | 'ref', heard, op, accepted }
 */
export function buildView(result, accepted = new Set()) {
  const { expected, spoken, ops } = result;
  const unitsPerToken = new Map();
  for (const unit of spoken.units) unitsPerToken.set(unit.token, (unitsPerToken.get(unit.token) ?? 0) + 1);
  const items = [];
  ops.forEach((op, index) => {
    const isAccepted = accepted.has(index);
    const heard = spokenText(spoken, op.s, unitsPerToken);
    if (op.type === 'ins' || op.type === 'ref') {
      items.push({ kind: op.type === 'ref' ? 'ref' : 'extra', heard, op: index, accepted: isAccepted });
      return;
    }
    const status = op.type === 'match' ? 'ok' : op.type === 'sub' ? 'wrong' : 'missing';
    const tokens = [...new Set(op.e.map((i) => expected.units[i].token))];
    for (const token of tokens) {
      const previous = items[items.length - 1];
      if (previous?.kind === 'word' && previous.token === token) {
        // One written token can hold several words ("144,000").
        if (previous.status !== status) previous.status = 'wrong';
        if (heard && !previous.heard.split(' ').includes(heard)) previous.heard = `${previous.heard} ${heard}`.trim();
        previous.accepted = previous.accepted && isAccepted;
        continue;
      }
      items.push({
        kind: 'word',
        token,
        text: expected.tokens[token].text,
        status,
        heard,
        variant: Boolean(op.variant),
        op: index,
        accepted: status !== 'ok' && isAccepted,
      });
    }
  });
  return items;
}
