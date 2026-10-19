type From = { pathname?: unknown; search?: unknown; hash?: unknown };

const AUTH_PAGES = ['/login', '/register'];

// 只接受站内绝对路径，防止借「登录后回原目标」做开放重定向
export function safeRedirect(from: unknown, fallback = '/notes'): string {
  if (!from || typeof from !== 'object') return fallback;
  const { pathname, search, hash } = from as From;
  if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname.startsWith('//')) return fallback;
  if (pathname.includes('\\') || AUTH_PAGES.includes(pathname)) return fallback;
  const s = typeof search === 'string' && search.startsWith('?') ? search : '';
  const h = typeof hash === 'string' && hash.startsWith('#') ? hash : '';
  return pathname + s + h;
}
