import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { SocketRevocationService } from './socket-revocation.service.js';
import { createSocketAuthenticate } from '../../middleware/auth.js';
import { validateEnvironment } from '../../config.js';
import { logger } from '../../utils/logger.js';

export interface AuthenticatedSocketUser {
  id: string;
  username: string;
  role: string;
  doctorId: string | null;
  av: number;
}

const STAFF_QUEUE_ROLES = ['ADMIN', 'RECEPTIONIST'];

// Same allowed origins as Express (src/server.js). Resolved lazily because the decorator
// is evaluated at import time, before the environment is necessarily loaded.
let cachedOrigins: string[] | null = null;
function allowedOrigins(): string[] {
  cachedOrigins ??= validateEnvironment().allowedOrigins;
  return cachedOrigins;
}

@WebSocketGateway({
  cors: {
    origin: (_origin: string | undefined, callback: (err: Error | null, origin?: string[]) => void) =>
      callback(null, allowedOrigins()),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  },
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  constructor(private readonly socketRevocation: SocketRevocationService) {}

  afterInit(server: Server) {
    // Handshake authentication and the readiness gate mirror src/server.js exactly.
    server.use(createSocketAuthenticate() as any);
    server.use((_socket, next) => {
      if (this.socketRevocation.isReady()) return next();
      const error: Error & { data?: { code: string } } = new Error(
        'Realtime session security is temporarily unavailable.',
      );
      error.data = { code: 'SOCKET_SECURITY_UNAVAILABLE' };
      return next(error);
    });
    this.socketRevocation.setServer(server);
    logger.info('realtime.gateway_initialized');
  }

  handleConnection(socket: Socket & { user?: AuthenticatedSocketUser }) {
    logger.info('socket.connected', { socketId: socket.id, userId: socket.user?.id });

    socket.join(`user_${socket.user!.id}`);
    socket.join(`role_${socket.user!.role}`);
    if (socket.user!.doctorId) socket.join(`doctor_${socket.user!.doctorId}`);
  }

  handleDisconnect(socket: Socket & { user?: AuthenticatedSocketUser }) {
    logger.info('socket.disconnected', {
      socketId: socket.id,
      userId: socket.user?.id,
    });
  }

  emitQueueUpdate(payload: any, doctorIds: (string | null | undefined)[] = []) {
    if (!this.server) return;

    let target: any = this.server;
    for (const role of STAFF_QUEUE_ROLES) {
      target = target.to(`role_${role}`);
    }
    for (const doctorId of new Set(doctorIds.filter(Boolean))) {
      target = target.to(`doctor_${doctorId}`);
    }
    target.emit('queueUpdated', payload);
  }

  emitNotification(userId: string, notification: any) {
    if (!this.server) return;
    this.server.to(`user_${userId}`).emit('notification', notification);
  }
}
