import { Module } from '@nestjs/common';
import { PharmacyController } from './pharmacy.controller.js';
import { PrescriptionsController } from './prescriptions.controller.js';
import { PharmacyService } from './pharmacy.service.js';
import { PrismaModule } from '../../database/prisma.module.js';
import { AppConfigModule } from '../config/config.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';

@Module({
  imports: [PrismaModule, AppConfigModule, RealtimeModule],
  controllers: [PharmacyController, PrescriptionsController],
  providers: [PharmacyService],
  exports: [PharmacyService],
})
export class PharmacyModule {}
