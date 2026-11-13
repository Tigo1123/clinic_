import test from 'node:test';
import assert from 'node:assert/strict';

test('NestJS bootstrap and AppModule initializes without conflicting with Express', async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://localhost:5433/clinic_test';
  process.env.SOCKET_REVOCATION_DATABASE_URL = 'postgresql://localhost:5433/clinic_test';
  process.env.JWT_SECRET = 'test-jwt-secret-at-least-thirty-two-characters';
  process.env.MEDICAL_ENCRYPTION_KEY = 'test-medical-key-separate-at-least-thirty-two';

  const { AppModule } = await import('../dist/app.module.js');
  const { NestFactory } = await import('@nestjs/core');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  assert.ok(app, 'ApplicationContext should be instantiated');

  const { AppConfigService } = await import('../dist/modules/config/config.service.js');
  const configService = app.get(AppConfigService);
  assert.ok(configService, 'AppConfigService should be resolvable from DI context');
  assert.equal(typeof configService.clinicTimeZone, 'string');
  assert.ok(configService.facilityBranding);

  const { PrismaService } = await import('../dist/database/prisma.service.js');
  const prismaService = app.get(PrismaService);
  assert.ok(prismaService, 'PrismaService should be resolvable from DI context');

  await app.close();
});
