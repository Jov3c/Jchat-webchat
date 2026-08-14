import { io } from 'socket.io-client';
import { getToken } from '../stores/auth.js';

let socket = null;

export function connectSocket() {
  if (socket) return socket;
  socket = io({ transports: ['websocket', 'polling'] });
  socket.on('authenticated', (payload) => { socket._userId = payload.userId; });
  socket.on('sessionReplaced', () => {
    import('../stores/session.js').then(({ setSessionReplaced }) => setSessionReplaced(true));
  });
  return socket;
}

export function getSocket() { return socket || connectSocket(); }
export function authenticate(cb) { getSocket().emit('authenticate', getToken(), cb); }
export function disconnectSocket() {
  if (socket) { socket.disconnect(); socket = null; }
}
