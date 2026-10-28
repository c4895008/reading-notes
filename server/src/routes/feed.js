import { Router } from 'express';
import { ah } from '../errors.js';
import { requireAuth } from '../middleware/auth.js';
import { feedNoteNotFound, getFeedNote, listFeed, setFeedLike } from '../services/feed.js';
import { assertValid, readBody } from '../validate.js';

export const feedRouter = Router();
feedRouter.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
feedRouter.use(requireAuth);

const ID_RE = /^[1-9]\d{0,15}$/;
const PAGE_SIZE = { default: 10, max: 50 };

function noteId(req) {
  const raw = req.params.id;
  const id = Number(raw);
  if (!ID_RE.test(raw) || !Number.isSafeInteger(id)) throw feedNoteNotFound();
  return id;
}

function positiveInt(value, fallback) {
  if (value === undefined) return fallback;
  return typeof value === 'string' && /^[1-9]\d{0,5}$/.test(value) ? Number(value) : NaN;
}

feedRouter.get(
  '/',
  ah(async (req, res) => {
    const query = readBody(req.query, ['page', 'page_size']);
    const page = positiveInt(query.page, 1);
    const pageSize = positiveInt(query.page_size, PAGE_SIZE.default);
    assertValid({
      page: Number.isNaN(page) ? '页码不正确' : null,
      page_size: Number.isNaN(pageSize) || pageSize > PAGE_SIZE.max ? `每页 1–${PAGE_SIZE.max} 条` : null,
    });
    res.json({ data: await listFeed(req.user.id, { page, pageSize }) });
  }),
);

feedRouter.get(
  '/:id',
  ah(async (req, res) => {
    const id = noteId(req);
    readBody(req.query, []);
    res.json({ data: { note: await getFeedNote(req.user.id, id) } });
  }),
);

function likeHandler(liked) {
  return ah(async (req, res) => {
    const id = noteId(req);
    readBody(req.query, []);
    readBody(req.body === undefined ? {} : req.body, []);
    res.json({ data: await setFeedLike(req.user.id, id, liked) });
  });
}

feedRouter.put('/:id/like', likeHandler(true));
feedRouter.delete('/:id/like', likeHandler(false));
