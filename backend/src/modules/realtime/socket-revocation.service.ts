import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { Server } from 'socket.io';
import {
  SocketRevocationService as LegacySocketRevocationService,
  SOCKET_REVOCATION_CHANNEL,
  REVOCATION_STATES,
  parseRevocationPayload,
} from '../../services/socketRevocation.js';
import { AppConfigService } from '../config/config.service.js';

export { SOCKET_REVOCATION_CHANNEL, REVOCATION_STATES, parseRevocationPayload };

/**
 * Thin Nest lifecycle wrapper around the legacy src/services/socketRevocation.js
 * (the single source of truth, also used by the Express server). The legacy
 * instance is created once the gateway hands over the Socket.IO server.
 */
@Injectable()
export class SocketRevocationService implements OnApplicationBootstrap, OnModuleDestroy {
  private legacy: any = null;
  private starting: Promise<void> | null = null;

  constructor(private readonly config: AppConfigService) {}

  /** Called by the gateway in afterInit; starts the legacy listener. */
  setServer(io: Server) {
    if (this.legacy) return;
    this.legacy = new (LegacySocketRevocationService as any)(io, this.config.socketRevocation);
    this.starting = Promise.resolve(this.legacy.start()).catch(() => undefined);
  }

  isReady(): boolean {
    return this.legacy?.isReady() ?? false;
  }

  getState(): string {
    return this.legacy?.state ?? REVOCATION_STATES.STOPPED;
  }

  async start(): Promise<void> {
    await this.legacy?.start();
  }

  async stop(): Promise<void> {
    await this.starting;
    await this.legacy?.stop();
  }

  handleNotification(rawPayload?: unknown): number {
    return this.legacy?.handleNotification(rawPayload) ?? 0;
  }

  disconnectStaleGeneration(userId: string, authVersion: number): number {
    return this.legacy?.disconnectStaleGeneration(userId, authVersion) ?? 0;
  }

  reconcile(): Promise<{ checked: number; disconnected: number }> {
    return this.legacy ? this.legacy.reconcile() : Promise.resolve({ checked: 0, disconnected: 0 });
  }

  async onApplicationBootstrap() {
    await this.starting;
  }

  async onModuleDestroy() {
    await this.stop();
  }
}
