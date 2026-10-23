import { Router } from 'express';
import { ah } from '../errors.js';
import { requireAuth } from '../middleware/auth.js';
import { bookNotFound, createBook, deleteBook, listBooks, updateBook } from '../services/books.js';
import { parseBookInput, readBody } from '../validate.js';

export const booksRouter = Router();
booksRouter.use(requireAuth);

const ID_RE = /^[1-9]\d{0,15}$/;
const FIELDS = ['title', 'author', 'status'];

function bookId(req) {
  const id = Number(req.params.id);
  if (!ID_RE.test(req.params.id) || !Number.isSafeInteger(id)) throw bookNotFound();
  return id;
}

booksRouter.get(
  '/',
  ah(async (req, res) => {
    res.json({ data: await listBooks(req.user.id) });
  }),
);

booksRouter.post(
  '/',
  ah(async (req, res) => {
    const input = parseBookInput(readBody(req.body, FIELDS));
    const { book, existed } = await createBook(req.user.id, input);
    res.status(existed ? 200 : 201).json({ data: { book } });
  }),
);

booksRouter.patch(
  '/:id',
  ah(async (req, res) => {
    const id = bookId(req);
    const input = parseBookInput(readBody(req.body, FIELDS), { partial: true });
    res.json({ data: { book: await updateBook(req.user.id, id, input) } });
  }),
);

booksRouter.delete(
  '/:id',
  ah(async (req, res) => {
    await deleteBook(req.user.id, bookId(req));
    res.json({ data: { deleted: true } });
  }),
);
