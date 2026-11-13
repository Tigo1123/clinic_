import { Module } from '@nestjs/common';
import { PatientsController } from './patients.controller.js';
import { PatientsService } from './patients.service.js';
import { PrismaModule } from '../../database/prisma.module.js';
import { AppConfigModule } from '../config/config.module.js';
import { CryptoModule } from '../crypto/crypto.module.js';

@Module({
  imports: [PrismaModule, AppConfigModule, CryptoModule],
  controllers: [PatientsController],
  providers: [PatientsService],
  exports: [PatientsService],
})
export class PatientsModule {}
