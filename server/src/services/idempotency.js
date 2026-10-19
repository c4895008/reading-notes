const TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 10_000;
const entries = new Map();

const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
export const isValidIdempotencyKey = (key) => KEY_RE.test(key);

function prune(now) {
  for (const [k, v] of entries) if (v.expires <= now) entries.delete(k);
  while (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value);
}

// 同一作用域 + 键在有效期内只执行一次，重复提交拿到同一结果；失败不缓存以便重试
export function once(scope, key, fn) {
  const now = Date.now();
  const k = `${scope}:${key}`;
  const hit = entries.get(k);
  if (hit && hit.expires > now) return hit.promise;
  if (entries.size >= MAX_ENTRIES) prune(now);

  const promise = Promise.resolve().then(fn);
  entries.set(k, { expires: now + TTL_MS, promise });
  promise.catch(() => entries.delete(k));
  return promise;
}
