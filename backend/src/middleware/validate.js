import { ZodError } from 'zod';
import { sendError } from '../utils/apiError.js';

export function validate(schema, source = 'body') {
  return (req, res, next) => {
    try {
      req[source] = schema.parse(req[source]);
      next();
    } catch (error) {
      if (!(error instanceof ZodError)) return next(error);
      return sendError(res, 422, 'VALIDATION_ERROR', 'Request validation failed.',
        error.issues.map(({ path, message }) => ({ field: path.join('.'), message })));
    }
  };
}
