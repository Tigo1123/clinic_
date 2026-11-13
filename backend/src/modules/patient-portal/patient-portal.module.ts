import { Module } from '@nestjs/common';
import { PatientPortalController } from './patient-portal.controller.js';
import { PatientPortalService } from './patient-portal.service.js';
import { PrismaModule } from '../../database/prisma.module.js';
import { AppConfigModule } from '../config/config.module.js';

@Module({
  imports: [PrismaModule, AppConfigModule],
  controllers: [PatientPortalController],
  providers: [PatientPortalService],
  exports: [PatientPortalService],
})
export class PatientPortalModule {}
