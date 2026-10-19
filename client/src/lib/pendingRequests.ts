import { useSyncExternalStore } from 'react';
import { listRequests } from '../api/friends';

// 读友导航徽标：待处理的收到申请数；读友页加载后直接写入，其余时间由外壳轮询
let count = 0;
const listeners = new Set<() => void>();

export function setPendingCount(next: number) {
  if (next === count) return;
  count = next;
  listeners.forEach((fn) => fn());
}

export async function refreshPendingCount() {
  try {
    setPendingCount((await listRequests('in', 1, 1)).total);
  } catch {
    // 徽标是辅助信息，拉取失败保持原值
  }
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const usePendingCount = () => useSyncExternalStore(subscribe, () => count);
