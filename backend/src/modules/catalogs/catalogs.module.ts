import { Module } from '@nestjs/common';
import { CatalogsController } from './catalogs.controller.js';
import { CatalogsService } from './catalogs.service.js';
import { PrismaModule } from '../../database/prisma.module.js';
import { AppConfigModule } from '../config/config.module.js';

@Module({
  imports: [PrismaModule, AppConfigModule],
  controllers: [CatalogsController],
  providers: [CatalogsService],
  exports: [CatalogsService],
})
export class CatalogsModule {}
