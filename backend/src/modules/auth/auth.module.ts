import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { MfaController } from './mfa.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { MustChangePasswordGuard } from '../../common/guards/must-change-password.guard.js';
import { PrismaModule } from '../../database/prisma.module.js';
import { AppConfigModule } from '../config/config.module.js';
import { CryptoModule } from '../crypto/crypto.module.js';

@Global()
@Module({
  imports: [PrismaModule, AppConfigModule, CryptoModule],
  controllers: [AuthController, MfaController],
  providers: [AuthService, JwtAuthGuard, MustChangePasswordGuard],
  exports: [AuthService, JwtAuthGuard, MustChangePasswordGuard],
})
export class AuthModule {}
