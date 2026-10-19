import express from 'express';
import { corsWhitelist } from './middleware/cors.js';
import { apiNotFound, errorHandler } from './middleware/errorHandler.js';
import { requestLog } from './middleware/requestLog.js';
import { apiRouter } from './routes/index.js';
import { AVATAR_DIR } from './services/avatar.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  app.use(requestLog);
  app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Robots-Tag', 'noindex, nofollow');
    next();
  });
  app.use(corsWhitelist);

  // 随机文件名永不复用，可长期缓存；sandbox 兜底，即使被当作页面打开也不执行任何内容
  app.use(
    '/uploads/avatars',
    express.static(AVATAR_DIR, {
      index: false,
      dotfiles: 'deny',
      immutable: true,
      maxAge: '365d',
      setHeaders: (res) => {
        res.set('Content-Security-Policy', "default-src 'none'; sandbox");
        res.set('Cross-Origin-Resource-Policy', 'same-site');
      },
    }),
    (_req, res) => res.status(404).end(),
  );

  app.use(express.json({ limit: '1mb' }));

  app.use('/api', apiRouter);
  app.use('/api', apiNotFound);
  app.use(errorHandler);

  return app;
}
