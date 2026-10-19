import { AppError } from '../errors.js';

// P0 内存实现：固定窗口计数，单进程有效；重启即清零
export function createLimiter({ windowMs, max }) {
  const buckets = new Map();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, b] of buckets) if (b.resetAt <= now) buckets.delete(key);
  }, 60_000);
  sweep.unref();

  const current = (key) => {
    const b = buckets.get(key);
    if (!b || b.resetAt <= Date.now()) return null;
    return b;
  };

  return {
    isLimited(key) {
      const b = current(key);
      return b ? b.count >= max : false;
    },
    hit(key) {
      let b = current(key);
      if (!b) {
        b = { count: 0, resetAt: Date.now() + windowMs };
        buckets.set(key, b);
      }
      b.count += 1;
    },
    reset(key) {
      buckets.delete(key);
    },
  };
}

export const tooManyRequests = () => new AppError(429, 'RATE_LIMITED', '尝试太频繁，请稍后再试');

// 每次请求都计数的通用中间件
export function rateLimit({ windowMs, max, key = (req) => req.ip }) {
  const limiter = createLimiter({ windowMs, max });
  return (req, _res, next) => {
    const k = key(req);
    if (limiter.isLimited(k)) return next(tooManyRequests());
    limiter.hit(k);
    next();
  };
}
