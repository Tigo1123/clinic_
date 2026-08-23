import { io } from 'socket.io-client';
import { readStaffSession } from './authStorage.js';

const environment = import.meta.env || {};

export const staffSocket = io(
  environment.VITE_STAFF_SOCKET_URL
    || (environment.DEV ? 'http://localhost:5000' : globalThis.window?.location?.origin || 'http://localhost:5000'),
  { autoConnect: false, auth: (callback) => callback({ token: readStaffSession()?.token }) }
);

const TERMINAL_CODES = new Set(['SESSION_REVOKED', 'INVALID_TOKEN', 'AUTHENTICATION_REQUIRED']);
const SECURITY_UNAVAILABLE_CODE = 'SOCKET_SECURITY_UNAVAILABLE';
const MAX_RETRY_DELAY_MS = 10000;

export function createStaffSocketLifecycle(socket, {
  readSession = readStaffSession,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout
} = {}) {
  let terminalSessionHandler = null;
  let terminalHandled = false;
  let sessionActive = false;
  let retryAttempt = 0;
  let retryTimer = null;

  const clearRetry = () => {
    if (retryTimer !== null) clearTimeoutFn(retryTimer);
    retryTimer = null;
  };

  const hasStaffSession = () => Boolean(sessionActive && readSession()?.token);

  const handleTerminalSession = () => {
    if (terminalHandled) return;
    terminalHandled = true;
    sessionActive = false;
    clearRetry();
    socket.io.reconnection(false);
    socket.disconnect();
    terminalSessionHandler?.();
  };

  const scheduleSecurityRetry = () => {
    if (!hasStaffSession() || terminalHandled || retryTimer !== null) return;
    const delay = Math.min(1000 * (2 ** retryAttempt), MAX_RETRY_DELAY_MS);
    retryAttempt += 1;
    retryTimer = setTimeoutFn(() => {
      retryTimer = null;
      if (hasStaffSession() && !terminalHandled && !socket.connected) socket.connect();
    }, delay);
  };

  socket.on('sessionRevoked', handleTerminalSession);
  socket.on('connect_error', (error) => {
    const code = error?.data?.code;
    if (TERMINAL_CODES.has(code)) {
      handleTerminalSession();
    } else if (code === SECURITY_UNAVAILABLE_CODE) {
      scheduleSecurityRetry();
    }
  });
  socket.on('connect', () => {
    retryAttempt = 0;
    clearRetry();
  });
  socket.on('disconnect', (reason) => {
    if (reason === 'io server disconnect' && hasStaffSession()) handleTerminalSession();
  });

  return {
    configureSessionRevocation(handler) {
      terminalSessionHandler = handler;
      return () => {
        if (terminalSessionHandler === handler) terminalSessionHandler = null;
      };
    },
    connect() {
      terminalHandled = false;
      sessionActive = true;
      retryAttempt = 0;
      clearRetry();
      socket.io.reconnection(true);
      if (!socket.connected) socket.connect();
    },
    disconnect() {
      sessionActive = false;
      clearRetry();
      socket.io.reconnection(false);
      socket.disconnect();
    }
  };
}

const lifecycle = createStaffSocketLifecycle(staffSocket);

export function configureStaffSocketSessionRevocation(handler) {
  return lifecycle.configureSessionRevocation(handler);
}

export function connectStaffSocket() {
  lifecycle.connect();
}

export function disconnectStaffSocket() {
  lifecycle.disconnect();
}
