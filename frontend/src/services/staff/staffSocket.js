import { io } from 'socket.io-client';
import { readStaffSession } from '../authStorage.js';
import { createSocketLifecycle, resolveSocketUrl } from '../socketLifecycle.js';

const environment = import.meta.env || {};

export const staffSocket = io(
  resolveSocketUrl(environment.VITE_STAFF_SOCKET_URL),
  { autoConnect: false, auth: (callback) => callback({ token: readStaffSession()?.token }) }
);

export function createStaffSocketLifecycle(socket, options = {}) {
  return createSocketLifecycle(socket, {
    readSession: readStaffSession,
    ...options
  });
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
