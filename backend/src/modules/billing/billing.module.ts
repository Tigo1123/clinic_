import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';

@Module({
  imports: [PrismaModule, RealtimeModule],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
