import { io } from 'socket.io-client';

export const staffSocket = io(
  import.meta.env.VITE_STAFF_SOCKET_URL || (import.meta.env.DEV ? 'http://localhost:5000' : window.location.origin),
  { autoConnect: false, auth: (callback) => callback({ token: localStorage.getItem('cms_token') }) }
);
