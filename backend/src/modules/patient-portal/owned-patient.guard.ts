import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  createParamDecorator,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

/**
 * Mirrors Express `requireOwnedPatient`. Runs as a guard (not inside the
 * handler) so that the owned-patient check happens before any body/param
 * validation pipe, matching the Express middleware ordering.
 */
@Injectable()
export class OwnedPatientGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    if (req.user?.role !== 'PATIENT') {
      throw new HttpException(
        { error: { code: 'PATIENT_ROLE_REQUIRED', message: 'A patient account is required.' } },
        HttpStatus.FORBIDDEN,
      );
    }
    const patient = await this.prisma.patient.findUnique({ where: { userId: req.user.id } });
    if (!patient) {
      throw new HttpException(
        {
          error: {
            code: 'PATIENT_RECORD_NOT_LINKED',
            message: 'This account is not linked to a patient record.',
          },
        },
        HttpStatus.CONFLICT,
      );
    }
    req.patient = patient;
    return true;
  }
}

/** The patient row attached by OwnedPatientGuard. */
export const OwnedPatient = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().patient,
);
