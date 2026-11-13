import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './database/prisma.module.js';
import { PrismaConnectionLifecycle } from './database/prisma.service.js';
import { AppConfigModule } from './modules/config/config.module.js';
import { CryptoModule } from './modules/crypto/crypto.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { PublicConfigModule } from './modules/public-config/public-config.module.js';
import { SpecialtiesModule } from './modules/specialties/specialties.module.js';
import { CatalogsModule } from './modules/catalogs/catalogs.module.js';
import { AdminDoctorsModule } from './modules/admin-doctors/admin-doctors.module.js';
import { AdminSchedulingModule } from './modules/admin-scheduling/admin-scheduling.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { PatientAuthModule } from './modules/patient-auth/patient-auth.module.js';
import { PatientsModule } from './modules/patients/patients.module.js';
import { PatientPortalModule } from './modules/patient-portal/patient-portal.module.js';
import { AppointmentsModule } from './modules/appointments/appointments.module.js';
import { RecordsModule } from './modules/records/records.module.js';
import { UploadModule } from './modules/upload/upload.module.js';
import { PharmacyModule } from './modules/pharmacy/pharmacy.module.js';
import { LaboratoryModule } from './modules/laboratory/laboratory.module.js';
import { BillingModule } from './modules/billing/billing.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { ApiExceptionFilter } from './common/filters/api-exception.filter.js';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { MustChangePasswordGuard } from './common/guards/must-change-password.guard.js';
import { RolesGuard } from './common/guards/roles.guard.js';

@Module({
  imports: [
    PrismaModule,
    AppConfigModule,
    CryptoModule,
    AuthModule,
    RealtimeModule,
    HealthModule,
    PublicConfigModule,
    SpecialtiesModule,
    CatalogsModule,
    AdminDoctorsModule,
    AdminSchedulingModule,
    AdminModule,
    PatientAuthModule,
    PatientsModule,
    PatientPortalModule,
    AppointmentsModule,
    RecordsModule,
    UploadModule,
    PharmacyModule,
    LaboratoryModule,
    BillingModule,
    NotificationsModule,
  ],
  providers: [
    PrismaConnectionLifecycle,
    {
      provide: APP_FILTER,
      useClass: ApiExceptionFilter,
    },
    // Global auth: every route requires a valid token unless marked @Public(),
    // then the must-change-password gate applies. Order matters.
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: MustChangePasswordGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
