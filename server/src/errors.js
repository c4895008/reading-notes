export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const validationError = (fields) =>
  new AppError(400, 'VALIDATION_ERROR', Object.values(fields)[0] || '请求参数不正确', { fields });

// Express 4 不捕获 async 处理器的 rejection，统一转交错误中间件
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
