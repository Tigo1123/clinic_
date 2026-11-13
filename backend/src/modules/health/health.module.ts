import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';
import { PrismaModule } from '../../database/prisma.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';

@Module({
  imports: [PrismaModule, RealtimeModule],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
