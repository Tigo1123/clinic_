import { io } from 'socket.io-client';
import { readStaffSession } from './authStorage';

export const staffSocket = io(
  import.meta.env.VITE_STAFF_SOCKET_URL || (import.meta.env.DEV ? 'http://localhost:5000' : window.location.origin),
  { autoConnect: false, auth: (callback) => callback({ token: readStaffSession()?.token }) }
);
