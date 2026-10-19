import { Router } from 'express';
import { config } from '../config.js';
import { pingDb } from '../db/pool.js';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
  const db = await pingDb();
  res.json({
    data: {
      status: db.connected ? 'ok' : 'degraded',
      time: new Date().toISOString(),
      db: { ...db, database: config.db.database },
    },
  });
});
