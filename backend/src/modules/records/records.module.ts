import { Module } from '@nestjs/common';
import { RecordsController } from './records.controller.js';
import { RecordsService } from './records.service.js';
import { PrismaModule } from '../../database/prisma.module.js';
import { AppConfigModule } from '../config/config.module.js';
import { CryptoModule } from '../crypto/crypto.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';

@Module({
  imports: [PrismaModule, AppConfigModule, CryptoModule, RealtimeModule],
  controllers: [RecordsController],
  providers: [RecordsService],
  exports: [RecordsService],
})
export class RecordsModule {}
