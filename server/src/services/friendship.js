import { AppError } from '../errors.js';

export const FRIENDSHIP = { PENDING: 0, ACCEPTED: 1, REJECTED: 2, WITHDRAWN: 3, REMOVED: 4 };

// 与迁移中 live_pair 生成列同一算法：无论方向，同一对用户得到同一个键
export const pairKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

export const requestNotFound = () => new AppError(404, 'REQUEST_NOT_FOUND', '这份申请已失效');

// live：这对用户之间「待处理或已同意」的那条记录，没有则为 null
export function relationOf(live, meId) {
  if (!live) return { relation: 'none' };
  if (live.status === FRIENDSHIP.ACCEPTED) return { relation: 'friend' };
  return { relation: live.requester_id === meId ? 'pending_out' : 'pending_in', request_id: live.id };
}

export function checkSend(meId, target, live) {
  if (!target || target.status !== 1) throw new AppError(404, 'USER_NOT_FOUND', '没有找到这位用户');
  if (target.id === meId) throw new AppError(400, 'CANNOT_ADD_SELF', '不能添加自己为读友');
  const { relation, request_id } = relationOf(live, meId);
  if (relation === 'friend') throw new AppError(409, 'ALREADY_FRIENDS', '你们已经是读友了');
  if (relation === 'pending_out') {
    throw new AppError(409, 'REQUEST_EXISTS', '已经发出过申请，等待对方回应', { request_id });
  }
  if (relation === 'pending_in') {
    throw new AppError(409, 'REQUEST_INCOMING', '对方已经向你发出申请，同意即可成为读友', { request_id });
  }
}

const TRANSITIONS = {
  accept: { by: 'addressee_id', to: FRIENDSHIP.ACCEPTED },
  reject: { by: 'addressee_id', to: FRIENDSHIP.REJECTED },
  withdraw: { by: 'requester_id', to: FRIENDSHIP.WITHDRAWN },
};

// 只有待处理的申请能被处理：同意、拒绝归接收方，撤回归申请方；其余一律视为失效，不泄露申请是否存在
export function planRespond(row, meId, action) {
  const t = TRANSITIONS[action];
  if (!t || !row || row.status !== FRIENDSHIP.PENDING || row[t.by] !== meId) throw requestNotFound();
  return { by: t.by, status: t.to };
}
