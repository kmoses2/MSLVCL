import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeAssignment,
  dueLabel,
  dueText,
  encodeAssignment,
  findAssignmentCode,
  invitationMessage,
  progressMessage,
  resultMessage,
} from '../lib/assignment.js';

const sample = { id: 'a-1', title: '10월 둘째 주 암송', due: '2026-10-15', refs: ['John 3:16', 'Romans 8:28'], from: '구모세', key: 'secret-key' };

test('a link code round-trips, Korean text included', () => {
  const code = encodeAssignment(sample);
  assert.match(code, /^[A-Za-z0-9_-]+$/, 'safe to put in a URL');
  assert.deepEqual(decodeAssignment(code), sample);
  const noKey = decodeAssignment(encodeAssignment({ ...sample, key: '', due: '', from: '' }));
  assert.equal(noKey.key, '');
  assert.equal(noKey.due, '');
});

test('references are normalized and impossible ones dropped', () => {
  const code = encodeAssignment({ ...sample, refs: ['jn 3:16', '요 3:16', 'Hezekiah 1:1', 'Romans 8:28'] });
  assert.deepEqual(decodeAssignment(code).refs, ['John 3:16', 'Romans 8:28']);
});

test('broken codes are rejected', () => {
  assert.equal(decodeAssignment('not-a-code'), null);
  assert.equal(decodeAssignment(''), null);
  assert.equal(decodeAssignment(encodeAssignment({ ...sample, refs: ['Nothing 1:1'] })), null);
});

test('findAssignmentCode reads pasted links and bare codes', () => {
  const code = encodeAssignment(sample);
  const message = invitationMessage({ ...sample, url: `https://kmoses2.github.io/MSLVCL/recite/#/join/${code}` });
  assert.equal(findAssignmentCode(message), code);
  assert.equal(findAssignmentCode(`  ${code}  `), code);
  assert.equal(findAssignmentCode('hello'), '');
});

test('due dates read as D-day', () => {
  const today = new Date(2026, 9, 12, 21, 30);
  assert.equal(dueLabel('2026-10-15', today), 'D-3');
  assert.equal(dueLabel('2026-10-12', today), '오늘 마감');
  assert.equal(dueLabel('2026-10-11', today), '마감 지남');
  assert.equal(dueLabel('', today), '');
  assert.equal(dueText('2026-10-05'), '10월 5일');
});

test('messages for the group chat', () => {
  const invite = invitationMessage({ ...sample, url: 'https://example.com/#/join/x' });
  assert.match(invite, /^\[말씀 암송\] 10월 둘째 주 암송/);
  assert.match(invite, /구모세님이 보낸 암송 과제예요\. 10월 15일까지/);
  assert.match(invite, /• John 3:16 \(요한복음 3:16\)/);
  assert.ok(!invite.includes('secret-key'), 'the key only travels inside the link');

  const attempt = { at: new Date(2026, 9, 8, 20, 15).getTime(), mode: 'voice', score: 100, perfect: true, wrong: 0, missing: 0, extra: 0 };
  const perfect = resultMessage({ name: '김철수', ref: 'John 3:16', assignmentTitle: '10월 둘째 주 암송', attempt });
  assert.match(perfect, /^\[10월 둘째 주 암송\] 김철수\nJohn 3:16 \(요한복음 3:16\) · 100% 완벽\n/);
  assert.match(perfect, /음성으로 암송$/);
  const partial = resultMessage({ name: '김철수', ref: 'John 3:16', attempt: { ...attempt, score: 92, perfect: false, wrong: 1, missing: 1, mode: 'type' } });
  assert.match(partial, /^\[말씀 암송\] 김철수\n.* · 92% \(틀림 1, 빠뜨림 1\)/);
  assert.match(partial, /입력으로 암송$/);

  const progress = progressMessage({
    name: '김철수',
    title: '10월 둘째 주 암송',
    due: '2026-10-15',
    items: [
      { ref: 'John 3:16', done: true, best: 100 },
      { ref: 'Romans 8:28', done: false, best: 80 },
      { ref: 'Joshua 1:9', done: false, best: 0 },
    ],
  });
  assert.equal(
    progress,
    '[10월 둘째 주 암송] 김철수 · 1/3 완료 (10월 15일까지)\n✅ John 3:16 · 최고 100%\n⬜ Romans 8:28 · 최고 80%\n⬜ Joshua 1:9',
  );
});
