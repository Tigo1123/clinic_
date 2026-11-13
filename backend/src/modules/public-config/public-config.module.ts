import { Module } from '@nestjs/common';
import { PublicConfigController } from './public-config.controller.js';
import { AppConfigModule } from '../config/config.module.js';

@Module({
  imports: [AppConfigModule],
  controllers: [PublicConfigController],
})
export class PublicConfigModule {}
