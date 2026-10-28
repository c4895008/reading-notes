import { Router } from 'express';
import { AppError, ah, validationError } from '../errors.js';
import { requireAuth } from '../middleware/auth.js';
import { noteDiscussion } from '../services/discussions.js';
import { isValidIdempotencyKey, once } from '../services/idempotency.js';
import {
  createNote,
  deleteNote,
  getNote,
  listNotes,
  listTree,
  moveNote,
  noteNotFound,
  promoteNote,
  setNoteVisibility,
  updateNote,
} from '../services/notes.js';
import { findTag, setNoteTags, tagNotFound } from '../services/tags.js';
import { NOTE_KINDS, assertValid, charLength, parseNoteInput, readBody } from '../validate.js';

export const notesRouter = Router();
notesRouter.use('/:id/visibility', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
notesRouter.use(requireAuth);

const ID_RE = /^[1-9]\d{0,15}$/;
const PAGE_SIZE = { default: 10, max: 50 };
const QUERY_MAX = 100;
const NOTE_FIELDS = ['title', 'quote', 'content', 'kind'];
const DISCUSSION_FILTERS = ['active', 'ended', 'none'];
const SORTS = ['updated', 'created'];

const optionalOf = (value, allowed) => (value === undefined || value === '' ? null : allowed.includes(value) ? value : NaN);

function noteId(req) {
  const id = Number(req.params.id);
  if (!ID_RE.test(req.params.id) || !Number.isSafeInteger(id)) throw noteNotFound();
  return id;
}

function positiveInt(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return typeof value === 'string' && /^[1-9]\d{0,5}$/.test(value) ? Number(value) : NaN;
}

function parseParentId(value) {
  if (value === null || value === undefined) return null;
  if (Number.isSafeInteger(value) && value > 0) return value;
  throw validationError({ parent_id: '父笔记格式不正确' });
}

function idempotencyKey(req) {
  const key = req.get('Idempotency-Key');
  if (key !== undefined && !isValidIdempotencyKey(key)) throw new AppError(400, 'VALIDATION_ERROR', '请求标识不正确');
  return key;
}

const runOnce = (scope, key, fn) => (key ? once(scope, key, fn) : fn());

notesRouter.get(
  '/',
  ah(async (req, res) => {
    const { view = 'list', q = '' } = req.query;
    const page = positiveInt(req.query.page, 1);
    const pageSize = positiveInt(req.query.page_size, PAGE_SIZE.default);
    const query = typeof q === 'string' ? q.trim() : null;
    const kind = optionalOf(req.query.kind, NOTE_KINDS);
    const discussion = optionalOf(req.query.discussion, DISCUSSION_FILTERS);
    const sort = optionalOf(req.query.sort, SORTS);
    assertValid({
      view: view === 'list' || view === 'tree' ? null : '不支持的视图',
      q:
        query === null
          ? '搜索词格式不正确'
          : charLength(query) > QUERY_MAX
            ? `搜索词最多 ${QUERY_MAX} 字`
            : view === 'tree' && query
              ? '搜索请使用列表视图'
              : null,
      page: Number.isNaN(page) ? '页码不正确' : null,
      page_size: Number.isNaN(pageSize) || pageSize > PAGE_SIZE.max ? `每页 1–${PAGE_SIZE.max} 条` : null,
      kind: Number.isNaN(kind) ? '分类不正确' : null,
      discussion: Number.isNaN(discussion) ? '讨论状态不正确' : null,
      sort: Number.isNaN(sort) ? '排序方式不正确' : null,
    });
    const userId = req.user.id;
    const data =
      view === 'tree'
        ? await listTree(userId)
        : await listNotes(userId, {
            q: query,
            page,
            pageSize,
            tag: await ownedTagId(req),
            kind,
            discussion,
            sort: sort ?? undefined,
          });
    res.json({ data });
  }),
);

// tag 查询参数：必须是本人拥有的标签，否则按不存在处理
async function ownedTagId(req) {
  const raw = req.query.tag;
  if (raw === undefined || raw === '') return undefined;
  if (typeof raw !== 'string' || !/^[1-9]\d{0,15}$/.test(raw)) throw validationError({ tag: '标签不正确' });
  const tag = await findTag(req.user.id, Number(raw));
  if (!tag) throw tagNotFound();
  return tag.id;
}

notesRouter.post(
  '/',
  ah(async (req, res) => {
    const key = idempotencyKey(req);
    const body = readBody(req.body, [...NOTE_FIELDS, 'parent_id']);
    const parentId = parseParentId(body.parent_id);
    const input = parseNoteInput(body);
    const userId = req.user.id;
    const note = await runOnce(`note:create:${userId}`, key, () => createNote(userId, input, parentId));
    res.status(201).json({ data: { note } });
  }),
);

notesRouter.get(
  '/:id',
  ah(async (req, res) => {
    const userId = req.user.id;
    const id = noteId(req);
    const [note, discussion] = await Promise.all([getNote(userId, id), noteDiscussion(userId, id)]);
    res.json({ data: { note: { ...note, discussion } } });
  }),
);

notesRouter.put(
  '/:id',
  ah(async (req, res) => {
    const id = noteId(req);
    const input = parseNoteInput(readBody(req.body, NOTE_FIELDS));
    res.json({ data: { note: await updateNote(req.user.id, id, input) } });
  }),
);

notesRouter.put(
  '/:id/visibility',
  ah(async (req, res) => {
    const id = noteId(req);
    const { visibility } = readBody(req.body, ['visibility']);
    assertValid({ visibility: visibility === 'private' || visibility === 'friends' ? null : '可见性不正确' });
    res.json({ data: await setNoteVisibility(req.user.id, id, visibility) });
  }),
);

notesRouter.put(
  '/:id/tags',
  ah(async (req, res) => {
    const id = noteId(req);
    const { tag_ids: raw } = readBody(req.body, ['tag_ids']);
    if (!Array.isArray(raw) || raw.some((v) => !Number.isSafeInteger(v) || v <= 0)) {
      throw validationError({ tag_ids: '标签列表格式不正确' });
    }
    if (raw.length > 20) throw validationError({ tag_ids: '一条笔记最多 20 个标签' });
    const tags = await setNoteTags(req.user.id, id, [...new Set(raw)]);
    res.json({ data: { tags } });
  }),
);

notesRouter.post(
  '/:id/promote',
  ah(async (req, res) => {
    const id = noteId(req);
    const key = idempotencyKey(req);
    const input = parseNoteInput(readBody(req.body, NOTE_FIELDS));
    const userId = req.user.id;
    const note = await runOnce(`note:promote:${userId}:${id}`, key, () => promoteNote(userId, id, input));
    res.status(201).json({ data: { note } });
  }),
);

notesRouter.put(
  '/:id/parent',
  ah(async (req, res) => {
    const id = noteId(req);
    const body = readBody(req.body, ['parent_id']);
    if (!('parent_id' in body)) throw validationError({ parent_id: '请选择父笔记' });
    const parentId = parseParentId(body.parent_id);
    res.json({ data: { note: await moveNote(req.user.id, id, parentId) } });
  }),
);

notesRouter.delete(
  '/:id',
  ah(async (req, res) => {
    res.json({ data: await deleteNote(req.user.id, noteId(req)) });
  }),
);
