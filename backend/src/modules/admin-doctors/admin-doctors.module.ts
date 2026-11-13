import { Module } from '@nestjs/common';
import { AdminDoctorsController } from './admin-doctors.controller.js';
import { AdminDoctorsService } from './admin-doctors.service.js';
import { PrismaModule } from '../../database/prisma.module.js';
import { AppConfigModule } from '../config/config.module.js';

@Module({
  imports: [PrismaModule, AppConfigModule],
  controllers: [AdminDoctorsController],
  providers: [AdminDoctorsService],
  exports: [AdminDoctorsService],
})
export class AdminDoctorsModule {}
