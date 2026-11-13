import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { ZodError } from 'zod';
import { ApiError } from '../../utils/apiError.js';
import { CLINICAL_DATA_UNREADABLE_CODE } from '../../utils/encryption.js';
import { logger } from '../../utils/logger.js';

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: any;
  };
}

const PRISMA_CODE_PATTERN = /^P\d{4}$/;

function isPrismaError(err: any): boolean {
  return (
    err?.name === 'PrismaClientKnownRequestError' ||
    (typeof err?.code === 'string' && PRISMA_CODE_PATTERN.test(err.code))
  );
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { id?: string; route?: unknown }>();

    if (response.headersSent) {
      return;
    }

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_SERVER_ERROR';
    let message = 'An unexpected server error occurred.';
    let details: any = undefined;

    const err = exception as any;
    const path = (request.originalUrl || request.url || '').split('?')[0];

    // 1. Clinical decryption failures
    if (
      err?.code === CLINICAL_DATA_UNREADABLE_CODE ||
      err?.name === 'ClinicalDataDecryptionError'
    ) {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      code = CLINICAL_DATA_UNREADABLE_CODE;
      message = 'Clinical information is unavailable.';
    }
    // 2. Existing ApiError domain class
    else if (err instanceof ApiError || (err?.status && err?.code && !err?.getStatus)) {
      status = err.status || HttpStatus.INTERNAL_SERVER_ERROR;
      code = err.code || 'API_ERROR';
      message = err.message || 'An error occurred.';
      details = err.details;
    }
    // 3. Zod validation error
    else if (err instanceof ZodError || err?.name === 'ZodError') {
      status = HttpStatus.UNPROCESSABLE_ENTITY; // 422
      code = 'VALIDATION_ERROR';
      message = 'Request validation failed.';
      details = (err as ZodError).issues?.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })) || err.errors;
    }
    // 4. Multer upload errors (raw MulterError)
    else if (err?.name === 'MulterError') {
      if (err.code === 'LIMIT_FILE_SIZE') {
        status = HttpStatus.PAYLOAD_TOO_LARGE; // 413
        code = 'FILE_TOO_LARGE';
        message = 'The uploaded file exceeds the configured size limit.';
      } else {
        status = HttpStatus.BAD_REQUEST; // 400
        code = 'UPLOAD_INVALID';
        message = 'The upload request is invalid.';
      }
    }
    // 5. Prisma database errors
    else if (isPrismaError(err)) {
      switch (err.code) {
        case 'P2002':
          status = HttpStatus.CONFLICT; // 409
          code = 'CONFLICT';
          message = 'A resource with this identifier already exists.';
          details = err.meta?.target ? { target: err.meta.target } : undefined;
          break;
        case 'P2025':
          status = HttpStatus.NOT_FOUND; // 404
          code = 'NOT_FOUND';
          message = 'Resource not found.';
          break;
        case 'P2028':
        case 'P2034':
          status = HttpStatus.CONFLICT; // 409
          code = 'TRANSACTION_CONFLICT';
          message = 'Transaction contention. Please retry.';
          break;
        default:
          status = HttpStatus.INTERNAL_SERVER_ERROR;
          code = 'DATABASE_ERROR';
          message = 'A database error occurred.';
      }
    }
    // 6. NestJS built-in HttpExceptions
    else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'object' && res !== null) {
        const resObj = res as Record<string, any>;
        // Already in the { error: { code, message } } contract.
        if (resObj.error && typeof resObj.error === 'object' && resObj.error.code) {
          return response.status(status).json(resObj);
        }
        // Legacy Express shape ({ error: string, code? }) sent unchanged. Nest's own
        // default bodies also carry a string `error` but always include `statusCode`.
        if (typeof resObj.error === 'string' && resObj.statusCode === undefined) {
          return response.status(status).json(resObj);
        }
        // Router-level 404 (no matched Nest route): same body as Express notFoundHandler.
        if (status === HttpStatus.NOT_FOUND && !request.route && path.startsWith('/api')) {
          return response.status(status).json({
            error: { code: 'ROUTE_NOT_FOUND', message: 'API route not found.' },
          });
        }
        // Nest's FileInterceptor re-wraps multer errors as HttpExceptions on the upload route.
        if (path === '/api/upload' && !resObj.code && status === HttpStatus.PAYLOAD_TOO_LARGE) {
          return response.status(status).json({
            error: {
              code: 'FILE_TOO_LARGE',
              message: 'The uploaded file exceeds the configured size limit.',
            },
          });
        }
        if (path === '/api/upload' && !resObj.code && status === HttpStatus.BAD_REQUEST) {
          return response.status(status).json({
            error: { code: 'UPLOAD_INVALID', message: 'The upload request is invalid.' },
          });
        }

        if (resObj.code) {
          code = resObj.code;
        } else {
          code = this.defaultCodeForStatus(status);
        }
        message = resObj.message || exception.message;
        details = resObj.details;
      } else {
        code = this.defaultCodeForStatus(status);
        message = String(res) || exception.message;
      }
    }
    // 7. General unhandled errors
    else {
      logger.error('http.unhandled_error', {
        requestId: request.id,
        method: request.method,
        path: request.url,
        error: { name: err?.name, message: err?.message },
      });
    }

    const payload: ErrorEnvelope = {
      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
      },
    };

    return response.status(status).json(payload);
  }

  private defaultCodeForStatus(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'BAD_REQUEST';
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHORIZED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'ROUTE_NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'VALIDATION_ERROR';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'RATE_LIMITED';
      default:
        return status >= 500 ? 'INTERNAL_SERVER_ERROR' : 'API_ERROR';
    }
  }
}
