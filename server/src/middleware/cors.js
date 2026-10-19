import cors from 'cors';
import { config } from '../config.js';
import { AppError } from '../errors.js';

const allowed = new Set(config.corsOrigins);

export const corsWhitelist = cors({
  origin(origin, cb) {
    // 无 Origin 的请求（同源经 Vite 代理、curl、服务端调用）放行
    if (!origin || allowed.has(origin)) return cb(null, true);
    cb(new AppError(403, 'CORS_FORBIDDEN', '来源不被允许'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  maxAge: 600,
});
