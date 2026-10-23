import { AppError, validationError } from './errors.js';

// 只接受声明过的字段，未知字段直接拒绝而非静默忽略
export function readBody(body, allowed) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError(400, 'VALIDATION_ERROR', '请求参数不正确');
  }
  const unknown = Object.keys(body).filter((k) => !allowed.includes(k));
  if (unknown.length) {
    throw new AppError(400, 'VALIDATION_ERROR', `不支持的字段：${unknown.join('、')}`, { unknown });
  }
  return body;
}

export const charLength = (s) => [...s].length;

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

export function checkUsername(value) {
  if (typeof value !== 'string' || !value) return '请填写用户名';
  if (!USERNAME_RE.test(value)) return '用户名为 3–20 位字母、数字或下划线';
  return null;
}

export function checkPassword(value) {
  if (typeof value !== 'string' || !value) return '请填写密码';
  if (value.length < 8) return '密码至少 8 位';
  // bcrypt 只取前 72 字节，超出部分会被静默截断
  if (value.length > 64 || Buffer.byteLength(value, 'utf8') > 72) return '密码最长 64 位';
  return null;
}

export function checkNickname(value) {
  if (typeof value !== 'string') return '昵称格式不正确';
  const v = value.trim();
  if (!v) return '请填写昵称';
  if (charLength(v) > 20) return '昵称最多 20 个字';
  if (CONTROL_RE.test(v)) return '昵称包含不支持的字符';
  return null;
}

export const NOTE_LIMITS = { title: 80, quote: 2000, content: 20000 };
export const NOTE_KINDS = ['viewpoint', 'question', 'summary'];
// 引文与正文允许换行与制表符
const MULTILINE_CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const normalizeNewlines = (s) => s.replace(/\r\n?/g, '\n');

// 校验并规整笔记三字段；返回可直接入库的值
export function parseNoteInput(body) {
  const errors = {};
  let title = null;
  let quote = null;
  let content = '';
  let kind = 'viewpoint';

  if (body.kind !== undefined) {
    if (NOTE_KINDS.includes(body.kind)) kind = body.kind;
    else errors.kind = body.kind === null ? '请选择分类' : '分类不正确';
  }

  if (typeof body.title !== 'string' || !body.title.trim()) errors.title = '请填写标题';
  else {
    title = body.title.trim();
    if (charLength(title) > NOTE_LIMITS.title) errors.title = `标题最多 ${NOTE_LIMITS.title} 字`;
    else if (CONTROL_RE.test(title)) errors.title = '标题包含不支持的字符';
  }

  if (body.quote !== undefined && body.quote !== null) {
    if (typeof body.quote !== 'string') errors.quote = '引文格式不正确';
    else {
      quote = normalizeNewlines(body.quote).trim() || null;
      if (quote && charLength(quote) > NOTE_LIMITS.quote) errors.quote = `引文最多 ${NOTE_LIMITS.quote} 字`;
      else if (quote && MULTILINE_CONTROL_RE.test(quote)) errors.quote = '引文包含不支持的字符';
    }
  }

  if (body.content !== undefined && body.content !== null) {
    if (typeof body.content !== 'string') errors.content = '正文格式不正确';
    else {
      // 保留行首缩进，Markdown 代码块与列表依赖它
      content = normalizeNewlines(body.content);
      if (!content.trim()) content = '';
      else content = content.replace(/^\n+/, '').trimEnd();
      if (charLength(content) > NOTE_LIMITS.content) errors.content = `正文最多 ${NOTE_LIMITS.content} 字`;
      else if (MULTILINE_CONTROL_RE.test(content)) errors.content = '正文包含不支持的字符';
    }
  }

  // undefined：不改动（更新）/ 继承父笔记（新建）；null：未归类
  let bookId;
  if (body.book_id !== undefined) {
    if (body.book_id === null || (Number.isSafeInteger(body.book_id) && body.book_id > 0)) bookId = body.book_id;
    else errors.book_id = '书籍不正确';
  }

  assertValid(errors);
  return { title, quote, content, kind, ...(bookId !== undefined ? { book_id: bookId } : {}) };
}

export const BOOK_LIMITS = { title: 80, author: 60 };
export const BOOK_STATUSES = ['reading', 'deep', 'done'];

export function checkBookTitle(value) {
  if (typeof value !== 'string' || !value.trim()) return '请填写书名';
  const title = value.trim();
  if (charLength(title) > BOOK_LIMITS.title) return `书名最多 ${BOOK_LIMITS.title} 字`;
  if (CONTROL_RE.test(title)) return '书名包含不支持的字符';
  return null;
}

export function checkBookAuthor(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return '作者格式不正确';
  const author = value.trim();
  if (charLength(author) > BOOK_LIMITS.author) return `作者最多 ${BOOK_LIMITS.author} 字`;
  if (CONTROL_RE.test(author)) return '作者包含不支持的字符';
  return null;
}

// partial：PATCH 时未出现的字段保持 undefined
export function parseBookInput(body, { partial = false } = {}) {
  const errors = {};
  const out = {};
  if (!partial || body.title !== undefined) {
    errors.title = checkBookTitle(body.title);
    if (!errors.title) out.title = body.title.trim();
  }
  if (body.author !== undefined) {
    errors.author = checkBookAuthor(body.author);
    if (!errors.author) out.author = typeof body.author === 'string' ? body.author.trim() || null : null;
  }
  if (body.status !== undefined) {
    if (body.status === null || BOOK_STATUSES.includes(body.status)) out.status = body.status;
    else errors.status = '阅读状态不正确';
  }
  assertValid(errors);
  if (partial && !Object.keys(out).length) throw validationError({ title: '没有需要修改的内容' });
  return out;
}

export const TAG_NAME_MAX = 40;
export function checkTagName(value) {
  if (typeof value !== 'string' || !value.trim()) throw validationError({ name: '请填写标签名' });
  const name = value.trim();
  if (charLength(name) > TAG_NAME_MAX) throw validationError({ name: `标签名最多 ${TAG_NAME_MAX} 字` });
  if (CONTROL_RE.test(name)) throw validationError({ name: '标签名包含不支持的字符' });
  return name;
}

export function assertValid(fields) {
  const errors = Object.fromEntries(Object.entries(fields).filter(([, msg]) => msg));
  if (Object.keys(errors).length) throw validationError(errors);
}
