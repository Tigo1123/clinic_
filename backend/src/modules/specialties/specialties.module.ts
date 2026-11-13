import { Module } from '@nestjs/common';
import { SpecialtiesController } from './specialties.controller.js';
import { SpecialtiesService } from './specialties.service.js';
import { PrismaModule } from '../../database/prisma.module.js';
import { AppConfigModule } from '../config/config.module.js';

@Module({
  imports: [PrismaModule, AppConfigModule],
  controllers: [SpecialtiesController],
  providers: [SpecialtiesService],
  exports: [SpecialtiesService],
})
export class SpecialtiesModule {}
