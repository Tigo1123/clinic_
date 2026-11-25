import { io } from 'socket.io-client';
import { readPatientSession } from '../authStorage.js';
import { createSocketLifecycle, resolveSocketUrl } from '../socketLifecycle.js';

const environment = import.meta.env || {};

export const patientSocket = io(
  resolveSocketUrl(environment.VITE_PATIENT_SOCKET_URL || environment.VITE_API_BASE_URL),
  { autoConnect: false, auth: (callback) => callback({ token: readPatientSession()?.token }) }
);

export function createPatientSocketLifecycle(socket, options = {}) {
  return createSocketLifecycle(socket, {
    readSession: readPatientSession,
    ...options
  });
}

const lifecycle = createPatientSocketLifecycle(patientSocket);

export function configurePatientSocketSessionRevocation(handler) {
  return lifecycle.configureSessionRevocation(handler);
}

export function connectPatientSocket() {
  lifecycle.connect();
}

export function disconnectPatientSocket() {
  lifecycle.disconnect();
}
