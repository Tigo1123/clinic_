import { Injectable, Module, MiddlewareConsumer, NestMiddleware, NestModule } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PatientAuthController } from './patient-auth.controller.js';
import { PatientAuthService } from './patient-auth.service.js';
import { PrismaModule } from '../../database/prisma.module.js';
import { AppConfigModule } from '../config/config.module.js';
import { markSensitiveResponse } from '../../utils/edgeSecurity.js';

// Mirrors the Express router-level markSensitiveResponse. Middleware runs before
// guards, so rate-limited (429) responses also get Cache-Control: no-store.
@Injectable()
class SensitiveResponseMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction) {
    markSensitiveResponse(res);
    next();
  }
}

@Module({
  imports: [PrismaModule, AppConfigModule],
  controllers: [PatientAuthController],
  providers: [PatientAuthService],
  exports: [PatientAuthService],
})
export class PatientAuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(SensitiveResponseMiddleware).forRoutes(PatientAuthController);
  }
}
