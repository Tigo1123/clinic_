import { Global, Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway.js';
import { SocketRevocationService } from './socket-revocation.service.js';
import { PrismaModule } from '../../database/prisma.module.js';
import { AppConfigModule } from '../config/config.module.js';

@Global()
@Module({
  imports: [PrismaModule, AppConfigModule],
  providers: [RealtimeGateway, SocketRevocationService],
  exports: [RealtimeGateway, SocketRevocationService],
})
export class RealtimeModule {}
