import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { StaffUsersController } from './staff-users.controller.js';
import { AuditLogsController } from './audit-logs.controller.js';
import { AdminService } from './admin.service.js';
import { PrismaModule } from '../../database/prisma.module.js';
import { AppConfigModule } from '../config/config.module.js';

@Module({
  imports: [PrismaModule, AppConfigModule],
  controllers: [AdminController, StaffUsersController, AuditLogsController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
