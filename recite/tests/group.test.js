import test from 'node:test';
import assert from 'node:assert/strict';
import * as group from '../lib/group.js';

const fixedRandom = (byte) => ({ getRandomValues: (bytes) => bytes.fill(byte) });

test('ids and leader codes', () => {
  assert.match(group.newGroupId(), /^[A-Za-z0-9]{20}$/);
  const code = group.newLeaderCode();
  assert.match(code, /^[A-HJ-NP-Z2-9]{10}$/);
  assert.equal(group.newLeaderCode(fixedRandom(0)), 'AAAAAAAAAA');
  assert.equal(group.formatLeaderCode('ABCDEFGHJK'), 'ABCDE-FGHJK');
  assert.equal(group.normalizeLeaderCode(' abcde-fghjk '), 'ABCDEFGHJK');
  assert.equal(group.normalizeLeaderCode('ABCDE FGHJK'), 'ABCDEFGHJK');
  assert.equal(group.normalizeLeaderCode('ABCDE-FGHJ0'), '', '0 is never in a code');
  assert.equal(group.normalizeLeaderCode('ABCDE'), '');
});

test('invite links carry the group and optionally the app key', () => {
  const code = group.encodeInvite({ groupId: 'AbCdEfGhIjKlMnOpQrSt', name: '목요 암송', key: 'yv-key' });
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(group.decodeInvite(code), { groupId: 'AbCdEfGhIjKlMnOpQrSt', name: '목요 암송', key: 'yv-key' });
  assert.equal(group.decodeInvite(group.encodeInvite({ groupId: 'AbCdEfGhIjKlMnOpQrSt', name: 'x' })).key, '');
  assert.equal(group.decodeInvite('nonsense'), null);
  assert.equal(group.decodeInvite(group.encodeInvite({ groupId: '../secrets', name: 'x' })), null);
  assert.equal(group.findInviteCode(`초대합니다\nhttps://kmoses2.github.io/MSLVCL/recite/#/g/${code}`), code);
  assert.equal(group.findInviteCode('https://example.com/#/join/abc'), '');
});

test('dates', () => {
  assert.equal(group.isoDate(new Date(2026, 9, 8, 23, 59)), '2026-10-08');
  assert.equal(group.addDays('2026-10-26', 7), '2026-11-02');
  assert.equal(group.dateText('2026-11-02'), '11월 2일');
  assert.equal(group.dayStart('2026-10-12'), new Date(2026, 9, 12).getTime());
});

test('weeks: cleaned, sorted, and today picks the latest started one', () => {
  const weeks = group.sanitizeWeeks([
    { start: '2026-10-19', ref: '요 1:2-3', note: '' },
    { start: '2026-10-12', ref: 'John 1:1', note: ' 1주차 ' },
    { start: 'someday', ref: 'John 1:4' },
    { start: '2026-10-26', ref: 'Nowhere 1:1' },
    null,
    { start: '2026-10-12', ref: 'jn 1:1' },
  ]);
  assert.deepEqual(weeks, [
    { start: '2026-10-12', ref: 'John 1:1', note: '' },
    { start: '2026-10-19', ref: 'John 1:2-3', note: '' },
  ]);
  assert.deepEqual(group.weekStatus(weeks, '2026-10-11'), { current: null, number: 0, next: weeks[0] });
  assert.deepEqual(group.weekStatus(weeks, '2026-10-12'), { current: weeks[0], number: 1, next: weeks[1] });
  assert.deepEqual(group.weekStatus(weeks, '2026-12-01'), { current: weeks[1], number: 2, next: null });

  const changed = group.putWeek(weeks, { start: '2026-10-19', ref: 'John 1:2', note: '2주차' });
  assert.equal(changed.length, 2);
  assert.equal(changed[1].ref, 'John 1:2');
  assert.deepEqual(group.dropWeek(changed, '2026-10-12').map((w) => w.start), ['2026-10-19']);
});

test('a new week keeps the weekday and fills this week first', () => {
  assert.equal(group.suggestedStart([], '2026-10-08'), '2026-10-08');
  const weeks = [{ start: '2026-10-11', ref: 'John 1:1', note: '' }];
  assert.equal(group.suggestedStart(weeks, '2026-10-12'), '2026-10-18', 'next week, planned ahead');
  assert.equal(group.suggestedStart(weeks, '2026-10-20'), '2026-10-18', 'this week has no verse yet');
  assert.equal(group.suggestedStart(weeks, '2026-11-03'), '2026-11-01');
});

test('results per week count only tries since that week started', () => {
  const weeks = [
    { start: '2026-10-12', ref: 'John 1:1', note: '' },
    { start: '2026-10-19', ref: 'John 1:2', note: '' },
    { start: '2026-10-26', ref: 'John 1:1', note: '복습' },
  ];
  const verses = [
    { id: 'a', ref: 'John 1:1' },
    { id: 'b', ref: 'john 1:2' },
  ];
  const at = (iso, hour) => group.dayStart(iso) + hour * 3600000;
  const attempts = {
    a: [
      { at: at('2026-10-11', 9), score: 100, perfect: true },
      { at: at('2026-10-13', 9), score: 80, perfect: false },
      { at: at('2026-10-14', 9), score: 100, perfect: true },
      { at: at('2026-10-15', 9), score: 100, perfect: true },
    ],
    b: [{ at: at('2026-10-20', 9), score: 90, perfect: false }],
  };
  assert.deepEqual(group.weekResults(weeks, verses, attempts), {
    '2026-10-12': { best: 100, perfect: true, at: at('2026-10-14', 9) },
    '2026-10-19': { best: 90, perfect: false, at: at('2026-10-20', 9) },
  });
});

test('merging results never makes them worse', () => {
  const saved = { '2026-10-12': { best: 100, perfect: true, at: 5 }, '2026-10-19': { best: 70, perfect: false, at: 9 }, bogus: { best: 1 } };
  const fresh = { '2026-10-12': { best: 90, perfect: false, at: 8 }, '2026-10-19': { best: 100, perfect: true, at: 12 }, '2026-10-26': { best: 40, perfect: false, at: 20 } };
  const merged = group.mergeResults(saved, fresh);
  assert.deepEqual(merged, {
    '2026-10-12': { best: 100, perfect: true, at: 5 },
    '2026-10-19': { best: 100, perfect: true, at: 12 },
    '2026-10-26': { best: 40, perfect: false, at: 20 },
  });
  assert.ok(group.sameResults(merged, group.mergeResults(merged, {})));
  assert.ok(!group.sameResults(merged, saved));
  assert.deepEqual(group.mergeResults({ x: { best: 250 } }), {});
  assert.deepEqual(group.mergeResults({ '2026-10-12': { best: 250, perfect: 'yes' } }), { '2026-10-12': { best: 100, perfect: true, at: 0 } });
});

test('the board: perfect first by time, then by score, then not started', () => {
  const members = group.sanitizeMembers([
    { id: 'u1', data: { name: '구모세', results: { '2026-10-12': { best: 100, perfect: true, at: 30 } } } },
    { id: 'u2', data: { name: '김철수', results: { '2026-10-12': { best: 100, perfect: true, at: 10 } } } },
    { id: 'u3', data: { name: '이영희', results: { '2026-10-12': { best: 85, perfect: false, at: 5 } } } },
    { id: 'u4', data: { name: '박민수', results: {} } },
    { id: 'u5', data: { name: '  ' } },
    { id: 'u6', data: { name: '최지혜', results: { '2026-10-12': { best: 95, perfect: false, at: 1 }, someday: { best: 1 } } } },
  ]);
  assert.equal(members.length, 5, 'a blank name is dropped');
  assert.deepEqual(Object.keys(members.at(-1).results), ['2026-10-12']);
  assert.deepEqual(
    group.boardRows(members, '2026-10-12').map((r) => r.name),
    ['김철수', '구모세', '최지혜', '이영희', '박민수'],
  );
  assert.equal(group.doneCount(members, '2026-10-12'), 2);
});

test('chat messages', () => {
  const invite = group.inviteMessage({ groupName: '목요 암송', leaderName: '구모세', week: { ref: 'John 1:1' }, url: 'https://x/#/g/abc' });
  assert.equal(
    invite,
    '[말씀 암송] 목요 암송\n구모세님이 함께 말씀을 외우는 모임에 초대했어요.\n이번 주 말씀: John 1:1 (요한복음 1:1)\n\n링크를 누르고 이름을 적으면, 매주 외울 말씀이 앱 맨 위에 떠요. 누가 외웠는지도 함께 볼 수 있어요.\nhttps://x/#/g/abc',
  );
  assert.ok(!group.inviteMessage({ groupName: 'g', url: 'u' }).includes('이번 주 말씀'));
  assert.equal(
    group.weekMessage({ groupName: '목요 암송', number: 3, week: { start: '2026-10-26', ref: 'John 1:3', note: '' }, url: 'https://x/' }),
    '[목요 암송] 3주차 말씀\nJohn 1:3 (요한복음 1:3)\n10월 26일부터 함께 외워요. 앱을 열면 맨 위에 있어요.\nhttps://x/',
  );
});
