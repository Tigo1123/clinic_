import { sendError } from "../utils/apiError.js";
import { logger } from "../utils/logger.js";
import {
  AccessTokenError,
  verifyActiveMfaEnrollmentToken,
  verifyActiveAccessToken,
} from "../services/accessTokens.js";
import { markSensitiveResponse } from "../utils/edgeSecurity.js";

/**
 * Builds the JWT authentication middleware. `verify` is injectable so the
 * failure classification can be tested without a database.
 */
export function createAuthenticate({ verify = verifyActiveAccessToken } = {}) {
  return async function authenticate(req, res, next) {
    // Every route that requires a bearer token is sensitive, including denial
    // responses. Prevent browser and intermediary caches from retaining it.
    markSensitiveResponse(res);
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return sendError(
        res,
        401,
        "AUTHENTICATION_REQUIRED",
        "Access denied. No token provided.",
      );
    }

    const token = authHeader.split(" ")[1];
    try {
      req.user = await verify(token);
      if (
        req.user.mustChangePassword &&
        !["/api/auth/change-password", "/api/auth/logout"].includes(
          req.originalUrl.split("?")[0],
        )
      ) {
        return sendError(
          res,
          403,
          "PASSWORD_CHANGE_REQUIRED",
          "You must change your password before accessing clinic services.",
        );
      }
      return next();
    } catch (error) {
      if (error instanceof AccessTokenError) {
        if (error.code === "SESSION_REVOKED")
          return sendError(res, 401, error.code, error.message);
        return sendError(
          res,
          401,
          "INVALID_TOKEN",
          "Invalid or expired token.",
        );
      }
      // Not a token problem: the database or another dependency failed.
      // Do not tell the client its credentials are invalid.
      logger.error("auth.verification_unavailable", {
        error: { name: error?.name, message: error?.message },
      });
      res.set("Retry-After", "5");
      return sendError(
        res,
        503,
        "SERVICE_UNAVAILABLE",
        "The service is temporarily unavailable. Please try again.",
      );
    }
  };
}

export const authenticate = createAuthenticate();

export function createMfaEnrollmentAuthenticate({ verify = verifyActiveMfaEnrollmentToken } = {}) {
  return async function authenticateMfaEnrollment(req, res, next) {
    markSensitiveResponse(res);
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) {
      return sendError(res, 401, 'MFA_ENROLLMENT_REQUIRED', 'A valid MFA enrollment credential is required.');
    }
    try {
      req.user = await verify(header.slice(7));
      return next();
    } catch (error) {
      if (error instanceof AccessTokenError) {
        return sendError(res, 401, error.code, error.message);
      }
      logger.error('auth.mfa_enrollment_verification_unavailable', {
        error: { name: error?.name, message: error?.message }
      });
      res.set('Retry-After', '5');
      return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'The service is temporarily unavailable. Please try again.');
    }
  };
}

export const authenticateMfaEnrollment = createMfaEnrollmentAuthenticate();

/**
 * Builds the Socket.IO authentication middleware. `verify` is injectable for
 * the same reason as above. Infrastructure failures use the retryable
 * SOCKET_SECURITY_UNAVAILABLE code that the staff socket client already
 * retries with backoff.
 */
export function createSocketAuthenticate({
  verify = verifyActiveAccessToken,
} = {}) {
  return async function authenticateSocketAccessToken(socket, next) {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) {
        const error = new Error("Authentication required.");
        error.data = { code: "AUTHENTICATION_REQUIRED" };
        return next(error);
      }
      socket.user = await verify(token);
      return next();
    } catch (error) {
      if (error instanceof AccessTokenError) {
        const code =
          error.code === "SESSION_REVOKED"
            ? "SESSION_REVOKED"
            : "INVALID_TOKEN";
        const socketError = new Error(
          code === "SESSION_REVOKED"
            ? "Session is no longer active."
            : "Invalid or expired token.",
        );
        socketError.data = { code };
        return next(socketError);
      }
      logger.error("auth.socket_verification_unavailable", {
        error: { name: error?.name, message: error?.message },
      });
      const socketError = new Error(
        "Realtime session security is temporarily unavailable.",
      );
      socketError.data = { code: "SOCKET_SECURITY_UNAVAILABLE" };
      return next(socketError);
    }
  };
}

export const authenticateSocketAccessToken = createSocketAuthenticate();

/**
 * Middleware builder to check allowed roles.
 */
export function checkRoles(...allowedRoles) {
  const roles = allowedRoles.flat();
  return (req, res, next) => {
    if (!req.user) {
      return sendError(
        res,
        401,
        "AUTHENTICATION_REQUIRED",
        "Unauthenticated request.",
      );
    }
    if (!roles.includes(req.user.role)) {
      return sendError(
        res,
        403,
        "FORBIDDEN",
        "Unauthorized role. Access denied.",
      );
    }
    next();
  };
}
