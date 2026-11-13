import { Controller, Get, HttpStatus, Req, Res } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator.js';
import { Response, Request } from 'express';
import { HealthService } from './health.service.js';
import { logger } from '../../utils/logger.js';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  live() {
    return { status: 'alive' };
  }

  @Get(['', 'ready'])
  async ready(
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request & { id?: string },
  ) {
    const dbHealthy = await this.healthService.checkDatabase();
    if (!dbHealthy) {
      logger.error('health.database_failed', { requestId: req.id });
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'unhealthy' };
    }

    if (!this.healthService.isRevocationReady()) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'unhealthy' };
    }

    return { status: 'healthy' };
  }
}
