import { PrismaClient } from '../src/generated/prisma/index.js';
import { DemoStaffError, seedDemoStaff, validateDemoEnvironment } from './staging-demo-staff.js';

// Deliberately do not load .env or fall back to the application's DATABASE_URL.
let prisma;
try {
  validateDemoEnvironment(process.env);
  prisma = new PrismaClient({ datasources: { db: { url: process.env.DEMO_STAFF_DATABASE_URL } }, log: [] });
  const result = await seedDemoStaff(prisma);
  console.log(JSON.stringify({ event: 'staging_demo_staff_ready', ...result }));
} catch (error) {
  // Raw database errors may contain connection strings or credential fields.
  console.error(error instanceof DemoStaffError ? error.message : 'Demo staff seed failed; transaction rolled back.');
  process.exitCode = 1;
} finally {
  await prisma?.$disconnect();
}
