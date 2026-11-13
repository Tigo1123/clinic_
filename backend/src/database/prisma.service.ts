import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
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
 */
@Injectable()
export class PrismaConnectionLifecycle implements OnModuleInit, OnModuleDestroy {
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

  async onModuleDestroy() {
    await prisma.$disconnect();
  }
}
