import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DISCUSSION,
  INVITE_LIMIT,
  MESSAGE_LIMIT,
  TRANSITION_ACTIONS,
  assertCanInvite,
  assertCanSend,
  excerpt,
  isEligible,
  parseInviteeIds,
  parseMessageInput,
  planInvite,
  planTransition,
} from '../src/services/discussion.js';

const ME = 7;
const codeOf = (fn) => {
  try {
    fn();
  } catch (err) {
    return `${err.status} ${err.code}`;
  }
  return 'ok';
};

test('isEligible：有参与记录，且是发起人或与发起人互为读友', () => {
  assert.equal(isEligible({ hasRow: true, isInitiator: true, isFriend: false }), true);
  assert.equal(isEligible({ hasRow: true, isInitiator: false, isFriend: true }), true);
  assert.equal(isEligible({ hasRow: true, isInitiator: false, isFriend: false }), false, '解除读友后资格失效');
  assert.equal(isEligible({ hasRow: false, isInitiator: false, isFriend: true }), false, '是读友但未受邀');
  assert.equal(isEligible({ hasRow: false, isInitiator: true, isFriend: false }), false);
});

test('parseInviteeIds：去重、格式与上限', () => {
  assert.deepEqual(parseInviteeIds(undefined, { required: false }), []);
  assert.deepEqual(parseInviteeIds([], { required: false }), []);
  assert.deepEqual(parseInviteeIds([3, 5, 3, 5, 9], { required: false }), [3, 5, 9]);
  const full = Array.from({ length: INVITE_LIMIT }, (_, i) => i + 1);
  assert.equal(parseInviteeIds([...full, ...full], { required: true }).length, INVITE_LIMIT, '去重后恰好 20 人可通过');
  assert.equal(codeOf(() => parseInviteeIds([...full, 21], { required: false })), '400 VALIDATION_ERROR');
  assert.equal(codeOf(() => parseInviteeIds(undefined, { required: true })), '400 VALIDATION_ERROR');
  assert.equal(codeOf(() => parseInviteeIds([], { required: true })), '400 VALIDATION_ERROR');
  for (const bad of ['3', [0], [-1], [1.5], ['3'], [null], [2 ** 53], { 0: 1 }]) {
    assert.equal(codeOf(() => parseInviteeIds(bad, { required: false })), '400 VALIDATION_ERROR', JSON.stringify(bad));
  }
});

test('planInvite：已在场者与发起人自己跳过，其余写入', () => {
  assert.deepEqual(planInvite(ME, [3, 5], { participantIds: [], friendIds: [3, 5] }), { add: [3, 5], skipped: [] });
  assert.deepEqual(planInvite(ME, [3, 5, ME], { participantIds: [ME, 3], friendIds: [3, 5] }), { add: [5], skipped: [3, ME] });
  assert.deepEqual(planInvite(ME, [], { participantIds: [], friendIds: [] }), { add: [], skipped: [] });
});

test('planInvite：在场但已不是读友的人只跳过，不因此拒绝整单', () => {
  assert.deepEqual(planInvite(ME, [3, 5], { participantIds: [3], friendIds: [5] }), { add: [5], skipped: [3] });
});

test('planInvite：含任一非读友整单 403', () => {
  assert.equal(codeOf(() => planInvite(ME, [3, 99], { participantIds: [], friendIds: [3] })), '403 INVITEE_NOT_FRIEND');
  try {
    planInvite(ME, [3, 98, 99], { participantIds: [], friendIds: [3] });
  } catch (err) {
    assert.deepEqual(err.details, { user_ids: [98, 99] });
  }
});

test('assertCanInvite：仅发起人、仅进行中', () => {
  const d = (initiator_id, status) => ({ initiator_id, status });
  assert.equal(codeOf(() => assertCanInvite(d(ME, DISCUSSION.ACTIVE), ME)), 'ok');
  assert.equal(codeOf(() => assertCanInvite(d(3, DISCUSSION.ACTIVE), ME)), '403 NOT_INITIATOR');
  assert.equal(codeOf(() => assertCanInvite(d(3, DISCUSSION.ENDED), ME)), '403 NOT_INITIATOR');
  assert.equal(codeOf(() => assertCanInvite(d(ME, DISCUSSION.ENDED), ME)), '409 DISCUSSION_NOT_ACTIVE');
  assert.equal(codeOf(() => assertCanInvite(d(ME, DISCUSSION.ARCHIVED), ME)), '409 DISCUSSION_NOT_ACTIVE');
});

test('planTransition：合法流转全覆盖', () => {
  const { ACTIVE, ENDED, ARCHIVED } = DISCUSSION;
  const d = (status) => ({ initiator_id: ME, status });
  assert.equal(planTransition(d(ACTIVE), ME, 'end'), ENDED);
  assert.equal(planTransition(d(ENDED), ME, 'reopen'), ACTIVE);
  assert.equal(planTransition(d(ENDED), ME, 'archive'), ARCHIVED);
  assert.equal(planTransition(d(ARCHIVED), ME, 'unarchive'), ENDED);
});

test('planTransition：非法流转 409，矩阵其余格全部拒绝', () => {
  const legal = new Set(['1:end', '2:reopen', '2:archive', '3:unarchive']);
  for (const status of Object.values(DISCUSSION)) {
    for (const action of TRANSITION_ACTIONS) {
      if (legal.has(`${status}:${action}`)) continue;
      assert.equal(codeOf(() => planTransition({ initiator_id: ME, status }, ME, action)), '409 INVALID_TRANSITION', `${status} ${action}`);
    }
  }
});

test('planTransition：读友对任何状态、任何动作都是 403', () => {
  for (const status of Object.values(DISCUSSION)) {
    for (const action of TRANSITION_ACTIONS) {
      assert.equal(codeOf(() => planTransition({ initiator_id: 3, status }, ME, action)), '403 NOT_INITIATOR');
    }
  }
});

test('assertCanSend：仅进行中可发言', () => {
  assert.equal(codeOf(() => assertCanSend({ status: DISCUSSION.ACTIVE })), 'ok');
  assert.equal(codeOf(() => assertCanSend({ status: DISCUSSION.ENDED })), '409 DISCUSSION_NOT_ACTIVE');
  assert.equal(codeOf(() => assertCanSend({ status: DISCUSSION.ARCHIVED })), '409 DISCUSSION_NOT_ACTIVE');
});

test('parseMessageInput：规整换行、去首尾空白、保留中间换行', () => {
  const r = parseMessageInput({ content: '  第一行\r\n第二行\r第三行  \n', client_message_id: 'abcdef0123456789' });
  assert.deepEqual(r, { content: '第一行\n第二行\n第三行', clientMessageId: 'abcdef0123456789' });
});

test('parseMessageInput：空白、超长、控制字符、缺标识均 400', () => {
  const ok = 'abcdef0123456789';
  const fieldOf = (body) => {
    try {
      parseMessageInput(body);
    } catch (err) {
      return Object.keys(err.details.fields).join(',');
    }
    return 'ok';
  };
  assert.equal(fieldOf({ content: ' \n\t ', client_message_id: ok }), 'content');
  assert.equal(fieldOf({ content: 1, client_message_id: ok }), 'content');
  assert.equal(fieldOf({ content: '字'.repeat(MESSAGE_LIMIT), client_message_id: ok }), 'ok');
  assert.equal(fieldOf({ content: '字'.repeat(MESSAGE_LIMIT + 1), client_message_id: ok }), 'content');
  assert.equal(fieldOf({ content: '😀'.repeat(MESSAGE_LIMIT), client_message_id: ok }), 'ok', '按字符而非 UTF-16 计数');
  assert.equal(fieldOf({ content: 'a\u0007b', client_message_id: ok }), 'content');
  assert.equal(fieldOf({ content: '<script>alert(1)</script>', client_message_id: ok }), 'ok', '原样存储，渲染时转义');
  assert.equal(fieldOf({ content: 'hi' }), 'client_message_id');
  assert.equal(fieldOf({ content: 'hi', client_message_id: 'short' }), 'client_message_id');
  assert.equal(fieldOf({ content: 'hi', client_message_id: 'a'.repeat(65) }), 'client_message_id');
  assert.equal(fieldOf({ content: 'hi', client_message_id: 'has space 123' }), 'client_message_id');
});

test('excerpt：折叠空白、按字符截到 40 字', () => {
  assert.equal(excerpt('短句'), '短句');
  assert.equal(excerpt('第一行\n\n  第二行'), '第一行 第二行');
  assert.equal(excerpt('字'.repeat(40)), '字'.repeat(40));
  assert.equal(excerpt('字'.repeat(41)), `${'字'.repeat(40)}…`);
  assert.equal(excerpt('😀'.repeat(41)), `${'😀'.repeat(40)}…`);
});
