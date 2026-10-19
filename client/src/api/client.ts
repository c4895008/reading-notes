export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: { fields?: Record<string, string>; [key: string]: unknown },
  ) {
    super(message);
  }
}

type ErrorBody = { error?: { code?: string; message?: string; details?: ApiError['details'] } };

const TOKEN_KEY = 'rn_token';
let token: string | null = localStorage.getItem(TOKEN_KEY);
let onUnauthorized: ((message: string) => void) | null = null;

export const getToken = () => token;

export function setToken(next: string | null) {
  token = next;
  if (next) localStorage.setItem(TOKEN_KEY, next);
  else localStorage.removeItem(TOKEN_KEY);
}

export function setUnauthorizedHandler(fn: ((message: string) => void) | null) {
  onUnauthorized = fn;
}

type Options = Omit<RequestInit, 'body'> & { body?: unknown };

export async function request<T>(path: string, { body, ...init }: Options = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (body !== undefined && !(body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const sentToken = token;
  if (sentToken) headers.set('Authorization', `Bearer ${sentToken}`);

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', '网络连接中断，请稍后再试。');
  }

  const payload = (await res.json().catch(() => null)) as ({ data: T } & ErrorBody) | null;

  if (!res.ok) {
    const err = payload?.error;
    const error = new ApiError(res.status, err?.code ?? 'HTTP_ERROR', err?.message ?? '服务暂时不可用，请稍后再试。', err?.details);
    // 只有携带了凭证的请求才视为「登录失效」；登录接口本身的 401 交给页面处理
    if (res.status === 401 && sentToken && sentToken === token) onUnauthorized?.(error.message);
    throw error;
  }
  if (!payload) throw new ApiError(res.status, 'BAD_RESPONSE', '服务返回了无法识别的内容。');
  return payload.data;
}
