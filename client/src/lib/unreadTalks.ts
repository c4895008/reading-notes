import { useSyncExternalStore } from 'react';
import { getUnreadTalks } from '../api/discussions';

// 讨论导航徽标：有未读的进行中讨论数；由外壳轮询，讨论页标记已读后主动刷新
let count = 0;
const listeners = new Set<() => void>();

export function setUnreadTalks(next: number) {
  if (next === count) return;
  count = next;
  listeners.forEach((fn) => fn());
}

export async function refreshUnreadTalks() {
  try {
    setUnreadTalks(await getUnreadTalks());
  } catch {
    // 徽标是辅助信息，拉取失败保持原值
  }
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const useUnreadTalks = () => useSyncExternalStore(subscribe, () => count);
