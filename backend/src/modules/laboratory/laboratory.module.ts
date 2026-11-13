import { Module } from '@nestjs/common';
import { LaboratoryController } from './laboratory.controller.js';
import { LaboratoryService } from './laboratory.service.js';
import { PrismaModule } from '../../database/prisma.module.js';
import { AppConfigModule } from '../config/config.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';

@Module({
  imports: [PrismaModule, AppConfigModule, RealtimeModule],
  controllers: [LaboratoryController],
  providers: [LaboratoryService],
  exports: [LaboratoryService],
})
export class LaboratoryModule {}
