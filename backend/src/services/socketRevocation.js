import { Client } from 'pg';
import prisma from '../db.js';
import { logger } from '../utils/logger.js';

export const SOCKET_REVOCATION_CHANNEL = 'clinic_auth_revocation_v1';
export const REVOCATION_STATES = Object.freeze({
  STARTING: 'STARTING', READY: 'READY', UNHEALTHY: 'UNHEALTHY', STOPPED: 'STOPPED'
});

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validGeneration(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateRevocationEvent(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  if (Object.keys(value).sort().join(',') !== 'authVersion,type,userId') return null;
  if (value.type !== 'AUTH_VERSION_CHANGED') return null;
  if (typeof value.userId !== 'string' || !USER_ID_PATTERN.test(value.userId)) return null;
  if (!validGeneration(value.authVersion)) return null;
  return value;
}

export function parseRevocationPayload(payload) {
  try {
    return validateRevocationEvent(JSON.parse(String(payload || '')));
  } catch {
    return null;
  }
}

export class SocketRevocationService {
  constructor(io, config, {
    prismaClient = prisma,
    ClientClass = Client,
    timers = { setTimeout, clearTimeout, setInterval, clearInterval }
  } = {}) {
    this.io = io;
    this.config = config;
    this.prisma = prismaClient;
    this.ClientClass = ClientClass;
    this.timers = timers;
    this.state = REVOCATION_STATES.STOPPED;
    this.client = null;
    this.stopping = false;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.reconcileTimer = null;
    this.unhealthyTimer = null;
    this.connecting = null;
    this.connectionGeneration = 0;
    this.readyGeneration = null;
    this.reconcileInFlight = null;
  }

  isReady() { return this.state === REVOCATION_STATES.READY; }

  async start() {
    if (this.connecting || this.isReady()) return this.connecting;
    this.stopping = false;
    this.state = REVOCATION_STATES.STARTING;
    this.connecting = this.#connect().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  async #connect() {
    if (this.stopping) return;
    const generation = ++this.connectionGeneration;
    const client = new this.ClientClass({
      connectionString: this.config.databaseUrl,
      application_name: 'clinic_socket_revocation_listener'
    });
    this.client = client;
    let failed = false;
    const unhealthy = (error) => {
      if (failed || this.stopping || this.client !== client || this.connectionGeneration !== generation) return;
      failed = true;
      this.#markUnhealthy(error, client, generation);
    };
    client.on('error', unhealthy);
    client.on('end', () => unhealthy(new Error('PostgreSQL revocation listener ended.')));
    client.on('notification', (message) => {
      if (message.channel === SOCKET_REVOCATION_CHANNEL) this.handleNotification(message.payload);
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${SOCKET_REVOCATION_CHANNEL}`);
      await this.reconcile();
      if (this.stopping || failed || this.client !== client || this.connectionGeneration !== generation) return;
      this.state = REVOCATION_STATES.READY;
      this.readyGeneration = generation;
      this.reconnectAttempt = 0;
      this.#clearUnhealthyTimer();
      this.#scheduleReconciliation(client, generation);
      logger.info('socket.revocation_listener_ready');
    } catch (error) {
      unhealthy(error);
    }
  }

  handleNotification(rawPayload) {
    const event = typeof rawPayload === 'string'
      ? parseRevocationPayload(rawPayload)
      : validateRevocationEvent(rawPayload);
    if (!event) {
      logger.security('socket.revocation_notification_invalid');
      return 0;
    }
    return this.disconnectStaleGeneration(event.userId, event.authVersion);
  }

  disconnectStaleGeneration(userId, authVersion) {
    const namespace = this.io.of('/');
    const socketIds = namespace.adapter.rooms.get(`user_${userId}`) || new Set();
    let disconnected = 0;
    for (const socketId of socketIds) {
      const socket = namespace.sockets.get(socketId);
      if (!socket) continue;
      if (socket.user?.id !== userId) {
        logger.security('socket.revocation_room_invariant_failed', { socketId });
        continue;
      }
      if (!validGeneration(socket.user.av) || socket.user.av < authVersion) {
        this.#revokeSocket(socket);
        disconnected += 1;
      }
    }
    return disconnected;
  }

  async reconcile() {
    const sockets = [...this.io.of('/').sockets.values()].filter((socket) => socket.user?.id);
    const userIds = [...new Set(sockets.map((socket) => socket.user.id))];
    if (!userIds.length) return { checked: 0, disconnected: 0 };
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, status: true, role: true, authVersion: true }
    });
    const authoritative = new Map(users.map((user) => [user.id, user]));
    let disconnected = 0;
    for (const socket of sockets) {
      const user = authoritative.get(socket.user.id);
      if (!user || user.status !== 'ACTIVE' || user.role !== socket.user.role || user.authVersion !== socket.user.av) {
        this.#revokeSocket(socket);
        disconnected += 1;
      }
    }
    logger.info('socket.reconciliation_completed', { checked: sockets.length, disconnected });
    return { checked: sockets.length, disconnected };
  }

  async stop() {
    this.stopping = true;
    this.state = REVOCATION_STATES.STOPPED;
    this.readyGeneration = null;
    this.reconcileInFlight = null;
    this.connectionGeneration += 1;
    this.#clearTimers();
    const client = this.client;
    this.client = null;
    if (client) await client.end().catch(() => {});
  }

  #revokeSocket(socket) {
    socket.emit('sessionRevoked', { reason: 'CREDENTIALS_CHANGED' });
    socket.disconnect(true);
    logger.security('socket.session_revoked', { socketId: socket.id, userId: socket.user?.id });
  }

  #markUnhealthy(error, expectedClient, expectedGeneration) {
    if (this.stopping || this.client !== expectedClient || this.connectionGeneration !== expectedGeneration) return;
    this.state = REVOCATION_STATES.UNHEALTHY;
    this.readyGeneration = null;
    const failedClient = this.client;
    this.client = null;
    if (failedClient) failedClient.end().catch(() => {});
    this.timers.clearInterval(this.reconcileTimer);
    this.reconcileTimer = null;
    logger.error('socket.revocation_listener_unhealthy', { error });
    if (!this.unhealthyTimer) this.unhealthyTimer = this.timers.setTimeout(() => {
      if (!this.isReady()) this.#disconnectAll();
    }, this.config.unhealthyGraceMs);
    this.#scheduleReconnect();
  }

  #scheduleReconnect() {
    if (this.stopping || this.reconnectTimer) return;
    const delay = Math.min(1000 * (2 ** this.reconnectAttempt), 10000);
    this.reconnectAttempt += 1;
    this.reconnectTimer = this.timers.setTimeout(() => {
      this.reconnectTimer = null;
      this.start().catch(() => {});
    }, delay);
  }

  #scheduleReconciliation(client, generation) {
    this.timers.clearInterval(this.reconcileTimer);
    this.reconcileTimer = this.timers.setInterval(() => {
      this.#runScheduledReconciliation(client, generation);
    }, this.config.reconcileMs);
  }

  #runScheduledReconciliation(client, generation) {
    if (this.stopping || !this.isReady() || this.client !== client || this.readyGeneration !== generation) return;
    if (this.reconcileInFlight?.generation === generation && this.reconcileInFlight.client === client) return;
    const promise = this.reconcile();
    const operation = { client, generation, promise };
    this.reconcileInFlight = operation;
    promise.catch((error) => {
      if (this.stopping || !this.isReady() || this.client !== client || this.readyGeneration !== generation) return;
      logger.error('socket.reconciliation_failed', { error });
      this.#markUnhealthy(error, client, generation);
    }).finally(() => {
      if (this.reconcileInFlight === operation) this.reconcileInFlight = null;
    });
  }

  #disconnectAll() {
    for (const socket of this.io.of('/').sockets.values()) if (socket.user) this.#revokeSocket(socket);
  }

  #clearUnhealthyTimer() {
    this.timers.clearTimeout(this.unhealthyTimer);
    this.unhealthyTimer = null;
  }

  #clearTimers() {
    this.timers.clearTimeout(this.reconnectTimer);
    this.timers.clearInterval(this.reconcileTimer);
    this.#clearUnhealthyTimer();
    this.reconnectTimer = null;
    this.reconcileTimer = null;
  }
}
