import { Router } from 'express';
import { ah } from '../errors.js';
import { requireAuth } from '../middleware/auth.js';
import { createTag, deleteTag, listTags, renameTag, tagNotFound } from '../services/tags.js';
import { checkTagName, readBody } from '../validate.js';

export const tagsRouter = Router();
tagsRouter.use(requireAuth);

const ID_RE = /^[1-9]\d{0,15}$/;

function tagId(req) {
  const id = Number(req.params.id);
  if (!ID_RE.test(req.params.id) || !Number.isSafeInteger(id)) throw tagNotFound();
  return id;
}

tagsRouter.get(
  '/',
  ah(async (req, res) => {
    res.json({ data: { items: await listTags(req.user.id) } });
  }),
);

tagsRouter.post(
  '/',
  ah(async (req, res) => {
    const { name } = readBody(req.body, ['name']);
    const { tag, existed } = await createTag(req.user.id, checkTagName(name));
    res.status(existed ? 200 : 201).json({ data: { tag } });
  }),
);

tagsRouter.patch(
  '/:id',
  ah(async (req, res) => {
    const { name } = readBody(req.body, ['name']);
    res.json({ data: { tag: await renameTag(req.user.id, tagId(req), checkTagName(name)) } });
  }),
);

tagsRouter.delete(
  '/:id',
  ah(async (req, res) => {
    await deleteTag(req.user.id, tagId(req));
    res.json({ data: { deleted: true } });
  }),
);
