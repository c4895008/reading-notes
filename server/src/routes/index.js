import { Router } from 'express';
import { authRouter } from './auth.js';
import { discussionsRouter } from './discussions.js';
import { feedRouter } from './feed.js';
import { friendsRouter, usersRouter } from './friends.js';
import { healthRouter } from './health.js';
import { meRouter } from './me.js';
import { notesRouter } from './notes.js';
import { tagsRouter } from './tags.js';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/notes', notesRouter);
apiRouter.use('/feed', feedRouter);
apiRouter.use('/tags', tagsRouter);
apiRouter.use('/users/me', meRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/friends', friendsRouter);
apiRouter.use('/discussions', discussionsRouter);
