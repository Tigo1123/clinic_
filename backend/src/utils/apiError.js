export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function sendError(res, status, code, message, details) {
  const error = { code, message };
  if (details) error.details = details;
  return res.status(status).json({ error });
}

export function notFoundHandler(req, res) {
  return sendError(res, 404, 'ROUTE_NOT_FOUND', 'API route not found.');
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err?.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') return sendError(res, 413, 'FILE_TOO_LARGE', 'The uploaded file exceeds the configured size limit.');
    return sendError(res, 400, 'UPLOAD_INVALID', 'The upload request is invalid.');
  }
  if (err instanceof ApiError) {
    return sendError(res, err.status, err.code, err.message, err.details);
  }
  console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: 'ERROR', event: 'http.unhandled_error', requestId: req.id, method: req.method, path: req.path, error: { name: err?.name, message: err?.message } }));
  return sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'An unexpected server error occurred.');
}
