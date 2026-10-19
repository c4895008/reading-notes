import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FRIENDSHIP, checkSend, pairKey, planRespond, relationOf } from '../src/services/friendship.js';

const ME = 7;
const OTHER = 3;
const target = { id: OTHER, status: 1 };
const pending = (requester_id, addressee_id) => ({ id: 11, requester_id, addressee_id, status: FRIENDSHIP.PENDING });
const accepted = { id: 12, requester_id: OTHER, addressee_id: ME, status: FRIENDSHIP.ACCEPTED };

const codeOf = (fn) => {
  try {
    fn();
  } catch (err) {
    return `${err.status} ${err.code}`;
  }
  return 'ok';
};

test('pairKey 与方向无关', () => {
  assert.equal(pairKey(7, 3), '3:7');
  assert.equal(pairKey(3, 7), '3:7');
  assert.equal(pairKey(9, 10), '9:10');
});

test('relationOf 按视角给出关系', () => {
  assert.deepEqual(relationOf(null, ME), { relation: 'none' });
  assert.deepEqual(relationOf(accepted, ME), { relation: 'friend' });
  assert.deepEqual(relationOf(pending(ME, OTHER), ME), { relation: 'pending_out', request_id: 11 });
  assert.deepEqual(relationOf(pending(OTHER, ME), ME), { relation: 'pending_in', request_id: 11 });
});

test('checkSend：只有无现存关系时可以发送', () => {
  assert.equal(codeOf(() => checkSend(ME, target, null)), 'ok');
  assert.equal(codeOf(() => checkSend(ME, null, null)), '404 USER_NOT_FOUND');
  assert.equal(codeOf(() => checkSend(ME, { id: OTHER, status: 0 }, null)), '404 USER_NOT_FOUND');
  assert.equal(codeOf(() => checkSend(ME, { id: ME, status: 1 }, null)), '400 CANNOT_ADD_SELF');
  assert.equal(codeOf(() => checkSend(ME, target, accepted)), '409 ALREADY_FRIENDS');
  assert.equal(codeOf(() => checkSend(ME, target, pending(ME, OTHER))), '409 REQUEST_EXISTS');
  assert.equal(codeOf(() => checkSend(ME, target, pending(OTHER, ME))), '409 REQUEST_INCOMING');
});

test('planRespond：接收方同意或拒绝，申请方撤回', () => {
  const incoming = pending(OTHER, ME);
  const outgoing = pending(ME, OTHER);
  assert.deepEqual(planRespond(incoming, ME, 'accept'), { by: 'addressee_id', status: FRIENDSHIP.ACCEPTED });
  assert.deepEqual(planRespond(incoming, ME, 'reject'), { by: 'addressee_id', status: FRIENDSHIP.REJECTED });
  assert.deepEqual(planRespond(outgoing, ME, 'withdraw'), { by: 'requester_id', status: FRIENDSHIP.WITHDRAWN });
});

test('planRespond：越权与失效一律 404，不泄露申请是否存在', () => {
  const outgoing = pending(ME, OTHER);
  const incoming = pending(OTHER, ME);
  assert.equal(codeOf(() => planRespond(outgoing, ME, 'accept')), '404 REQUEST_NOT_FOUND');
  assert.equal(codeOf(() => planRespond(outgoing, ME, 'reject')), '404 REQUEST_NOT_FOUND');
  assert.equal(codeOf(() => planRespond(incoming, ME, 'withdraw')), '404 REQUEST_NOT_FOUND');
  assert.equal(codeOf(() => planRespond(incoming, 99, 'accept')), '404 REQUEST_NOT_FOUND');
  assert.equal(codeOf(() => planRespond(null, ME, 'accept')), '404 REQUEST_NOT_FOUND');
  for (const status of [FRIENDSHIP.ACCEPTED, FRIENDSHIP.REJECTED, FRIENDSHIP.WITHDRAWN, FRIENDSHIP.REMOVED]) {
    assert.equal(codeOf(() => planRespond({ ...incoming, status }, ME, 'accept')), '404 REQUEST_NOT_FOUND');
    assert.equal(codeOf(() => planRespond({ ...outgoing, status }, ME, 'withdraw')), '404 REQUEST_NOT_FOUND');
  }
  assert.equal(codeOf(() => planRespond(incoming, ME, 'remove')), '404 REQUEST_NOT_FOUND');
});
