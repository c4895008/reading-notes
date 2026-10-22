// 徽章目录（PRD FR-23）；顺序即展示顺序。只增不改义，已授予不回收
export const CATALOG = [
  { code: 'icebreaker', name: '破冰', imagery: '冰晶绽开', condition: '首次在讨论中发送消息（读友侧）' },
  { code: 'companion', name: '同席', imagery: '并坐', condition: '在 3 场不同的讨论中都发送过消息（读友侧）' },
  { code: 'kindler', name: '东道', imagery: '请帖', condition: '首次发起讨论（发起人侧）' },
  { code: 'fullhouse', name: '满座', imagery: '齐聚', condition: '发起的某场讨论中，有 ≥ 3 位读友各发送过消息（发起人侧）' },
];

export const COMPANION_TALKS = 3;
export const FULLHOUSE_READERS = 3;

const ORDER = new Map(CATALOG.map((b, i) => [b.code, i]));
export const isKnownBadge = (code) => ORDER.has(code);

// 目录外的历史代码静默丢弃；按目录顺序输出公开形态
export const publicBadges = (codes) =>
  codes
    .filter(isKnownBadge)
    .sort((a, b) => ORDER.get(a) - ORDER.get(b))
    .map((code) => ({ code, name: CATALOG[ORDER.get(code)].name }));

// readerTalks 只计非本人发起的场；maxReaderSenders 为本人发起的各场中他人发言人数的最大值
export function earnedCodes({ readerTalks = 0, initiated = 0, maxReaderSenders = 0 } = {}) {
  const codes = [];
  if (readerTalks >= 1) codes.push('icebreaker');
  if (readerTalks >= COMPANION_TALKS) codes.push('companion');
  if (initiated >= 1) codes.push('kindler');
  if (maxReaderSenders >= FULLHOUSE_READERS) codes.push('fullhouse');
  return codes;
}

// 事件 → 需要评估的 [用户, 候选徽章]；第一项是动作发起者本人（其新徽章回给客户端）
export function evaluationPlan(event) {
  if (event.type === 'discussion_created') return [{ userId: event.initiatorId, codes: ['kindler'] }];
  if (event.type === 'message_sent') {
    if (event.senderId === event.initiatorId) return [];
    return [
      { userId: event.senderId, codes: ['icebreaker', 'companion'] },
      { userId: event.initiatorId, codes: ['fullhouse'] },
    ];
  }
  return [];
}
