import { AppError } from '../errors.js';
import { config } from '../config.js';

export function apiNotFound(req, _res, next) {
  next(new AppError(404, 'NOT_FOUND', '接口不存在'));
}

// Express 依据参数个数（4 个）识别错误处理中间件
export function errorHandler(err, req, res, _next) {
  let error = err;

  if (!(err instanceof AppError)) {
    if (err.type === 'entity.too.large') {
      error = new AppError(413, 'PAYLOAD_TOO_LARGE', '请求内容过大');
    } else if (err.type === 'entity.parse.failed') {
      error = new AppError(400, 'INVALID_JSON', '请求格式不正确');
    } else {
      // 只记录错误本身，不记录请求体（可能含密码、笔记、消息）
      console.error(`[error] ${req.method} ${req.path}`, err.stack || err);
      error = new AppError(500, 'INTERNAL_ERROR', '服务暂时不可用，请稍后再试');
    }
  }

  const body = { error: { code: error.code, message: error.message } };
  if (error.details !== undefined) body.error.details = error.details;
  if (error.status === 500 && !config.isProd && err.message) body.error.debug = err.message;

  res.status(error.status).json(body);
}
