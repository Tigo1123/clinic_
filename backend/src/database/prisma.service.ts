import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import type { PrismaClient } from '../generated/prisma/index.js';
import prisma from '../db.js';

/**
 * Nest token for the single PrismaClient shared with the legacy Express services
 * (src/db.js). Every injection of PrismaService resolves to that same client, so
 * Nest and Express run on one connection pool.
 */
export interface PrismaService extends PrismaClient {}

@Injectable()
export class PrismaService {
  constructor() {
    return prisma as unknown as PrismaService;
  }
}

/**
 * Connects the shared client when the Nest application starts and disconnects it
 * on shutdown. Registered once in AppModule because lifecycle hooks only run on
 * class instances, not on the shared client object itself.
 *
 * Disconnects in onApplicationShutdown, which Nest runs after the HTTP and Socket.IO
 * servers have closed, so in-flight requests keep their database until they finish.
 * onModuleDestroy would run before the servers close.
 */
@Injectable()
export class PrismaConnectionLifecycle implements OnModuleInit, OnApplicationShutdown {
  async onModuleInit() {
    try {
      await prisma.$connect();
    } catch (error) {
      if (process.env.NODE_ENV === 'test') {
        return;
      }
      throw error;
    }
  }

  async onApplicationShutdown() {
    await prisma.$disconnect();
  }
}
