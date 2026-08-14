import { io } from 'socket.io-client';

export const staffSocket = io(
  import.meta.env.VITE_STAFF_SOCKET_URL || (window.location.hostname === 'localhost'
    ? 'http://localhost:5000'
    : `${window.location.protocol}//${window.location.hostname}:5000`),
  { autoConnect: false, auth: (callback) => callback({ token: localStorage.getItem('cms_token') }) }
);
