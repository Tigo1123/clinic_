import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { SocketRevocationService } from '../realtime/socket-revocation.service.js';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly socketRevocation: SocketRevocationService,
  ) {}

  async checkDatabase(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  isRevocationReady(): boolean {
    return this.socketRevocation.isReady();
  }
}
