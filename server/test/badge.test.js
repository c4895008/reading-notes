import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CATALOG, COMPANION_TALKS, FULLHOUSE_READERS, earnedCodes, evaluationPlan, isKnownBadge, publicBadges } from '../src/services/badge.js';

test('目录：恰好 4 枚，代码唯一，名称/意象/条件齐全', () => {
  assert.deepEqual(
    CATALOG.map((b) => b.code),
    ['icebreaker', 'companion', 'kindler', 'fullhouse'],
  );
  assert.deepEqual(
    CATALOG.map((b) => b.name),
    ['破冰', '同席', '东道', '满座'],
  );
  for (const b of CATALOG) assert.ok(b.imagery && b.condition);
});

test('earnedCodes：零统计 / 缺省参数 → 无徽章', () => {
  assert.deepEqual(earnedCodes(), []);
  assert.deepEqual(earnedCodes({}), []);
  assert.deepEqual(earnedCodes({ readerTalks: 0, initiated: 0, maxReaderSenders: 0 }), []);
});

test('破冰：读友侧首场发言即达成', () => {
  assert.deepEqual(earnedCodes({ readerTalks: 1 }), ['icebreaker']);
});

test('同席：读友侧第 3 场达成，第 2 场不达成', () => {
  assert.equal(COMPANION_TALKS, 3);
  assert.deepEqual(earnedCodes({ readerTalks: 2 }), ['icebreaker']);
  assert.deepEqual(earnedCodes({ readerTalks: 3 }), ['icebreaker', 'companion']);
  assert.deepEqual(earnedCodes({ readerTalks: 10 }), ['icebreaker', 'companion']);
});

test('东道：首次发起即达成', () => {
  assert.deepEqual(earnedCodes({ initiated: 1 }), ['kindler']);
  assert.deepEqual(earnedCodes({ initiated: 5 }), ['kindler']);
});

test('满座：单场第 3 位读友发言达成，2 位不达成', () => {
  assert.equal(FULLHOUSE_READERS, 3);
  assert.deepEqual(earnedCodes({ maxReaderSenders: 2 }), []);
  assert.deepEqual(earnedCodes({ maxReaderSenders: 3 }), ['fullhouse']);
});

test('发起人侧统计不计入读友侧徽章', () => {
  assert.deepEqual(earnedCodes({ initiated: 3, maxReaderSenders: 3 }), ['kindler', 'fullhouse']);
});

test('evaluationPlan：发起笔谈只评估发起人的东道', () => {
  assert.deepEqual(evaluationPlan({ type: 'discussion_created', initiatorId: 1 }), [{ userId: 1, codes: ['kindler'] }]);
});

test('evaluationPlan：读友发言评估发送者的破冰/同席，与发起人的满座；发送者在前', () => {
  assert.deepEqual(evaluationPlan({ type: 'message_sent', senderId: 2, initiatorId: 1 }), [
    { userId: 2, codes: ['icebreaker', 'companion'] },
    { userId: 1, codes: ['fullhouse'] },
  ]);
});

test('evaluationPlan：发起人在自己的笔谈里发言不触发任何评估', () => {
  assert.deepEqual(evaluationPlan({ type: 'message_sent', senderId: 1, initiatorId: 1 }), []);
});

test('evaluationPlan：状态流转、提炼等事件不在 4 枚目录的触发点内', () => {
  assert.deepEqual(evaluationPlan({ type: 'transition' }), []);
  assert.deepEqual(evaluationPlan({ type: 'promote' }), []);
});

test('publicBadges：按目录顺序、只含 code/name、丢弃目录外代码', () => {
  assert.deepEqual(publicBadges(['fullhouse', 'unknown', 'icebreaker']), [
    { code: 'icebreaker', name: '破冰' },
    { code: 'fullhouse', name: '满座' },
  ]);
  assert.deepEqual(publicBadges([]), []);
  assert.equal(isKnownBadge('kindler'), true);
  assert.equal(isKnownBadge('streak'), false);
});
