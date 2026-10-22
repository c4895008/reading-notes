export type NotesView = 'list' | 'tree';

const collapsedKey = (userId: number) => `rn:tree:collapsed:${userId}`;
const LAST_KEY = 'rn:tree:last';

function read(key: string, store: Storage = localStorage) {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string, store: Storage = localStorage) {
  try {
    store.setItem(key, value);
  } catch {
    // 隐私模式或配额已满时只放弃记忆，不影响使用
  }
}

// null 表示从未记录过，由调用方决定默认态
export function loadCollapsed(userId: number): Set<number> | null {
  const raw = read(collapsedKey(userId));
  if (raw === null) return null;
  try {
    const ids = JSON.parse(raw);
    return new Set(Array.isArray(ids) ? ids.filter((n): n is number => Number.isSafeInteger(n)) : []);
  } catch {
    return new Set();
  }
}

export const saveCollapsed = (userId: number, ids: Set<number>) => write(collapsedKey(userId), JSON.stringify([...ids]));

export function expandNodes(userId: number, ids: number[]) {
  const collapsed = loadCollapsed(userId);
  if (!collapsed || !ids.some((id) => collapsed.has(id))) return;
  ids.forEach((id) => collapsed.delete(id));
  saveCollapsed(userId, collapsed);
}

export const loadLastViewed = () => Number(read(LAST_KEY, sessionStorage)) || null;
export const saveLastViewed = (id: number) => write(LAST_KEY, String(id), sessionStorage);
