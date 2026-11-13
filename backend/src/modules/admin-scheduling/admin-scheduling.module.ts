import { Module } from '@nestjs/common';
import { AdminSchedulingController } from './admin-scheduling.controller.js';
import { AdminSchedulingService } from './admin-scheduling.service.js';
import { PrismaModule } from '../../database/prisma.module.js';
import { AppConfigModule } from '../config/config.module.js';

@Module({
  imports: [PrismaModule, AppConfigModule],
  controllers: [AdminSchedulingController],
  providers: [AdminSchedulingService],
  exports: [AdminSchedulingService],
})
export class AdminSchedulingModule {}
