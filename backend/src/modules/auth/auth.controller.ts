import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { AuthService } from './auth.service.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { PreAuthMiddleware } from '../../common/guards/express-middleware.guard.js';
import { createLoginLimiter } from '../../utils/edgeSecurity.js';
import { rateLimits } from '../../config.js';
import { passwordSchema } from '../../utils/passwordPolicy.js';

// Same schemas as src/routes/auth.js.
const loginDtoSchema = z.object({
  username: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(200),
});

const changePasswordDtoSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
}).strict();

const loginLimiter = createLoginLimiter({ windowMs: rateLimits.windowMs, limit: rateLimits.login });

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @PreAuthMiddleware(loginLimiter)
  async login(
    @Body(new ZodValidationPipe(loginDtoSchema)) body: z.infer<typeof loginDtoSchema>,
    @Req() req: Request & { id?: string },
  ) {
    return this.authService.login(body, req.ip, req.id);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentUser() user: any) {
    await this.authService.logout(user);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser() user: any,
    @Body(new ZodValidationPipe(changePasswordDtoSchema)) body: z.infer<typeof changePasswordDtoSchema>,
    @Req() req: Request & { id?: string },
  ) {
    return this.authService.changePassword(user, body, req.ip, req.id);
  }
}
