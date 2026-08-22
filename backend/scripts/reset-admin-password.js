import bcrypt from 'bcryptjs';
import prisma from '../src/db.js';
import { passwordSchema } from '../src/utils/passwordPolicy.js';

const ADMIN_USERNAME = 'admin@cms.com';

class AdminResetError extends Error {}

async function resetAdminPassword() {
  const passwordResult = passwordSchema.safeParse(
    process.env.ADMIN_RESET_PASSWORD
  );

  if (!passwordResult.success) {
    throw new AdminResetError(
      process.env.ADMIN_RESET_PASSWORD
        ? 'ADMIN_RESET_PASSWORD does not meet the application password requirements.'
        : 'ADMIN_RESET_PASSWORD is required.'
    );
  }

  const account = await prisma.user.findUnique({
    where: { username: ADMIN_USERNAME },
    select: { id: true, role: true, status: true }
  });

  if (!account) throw new AdminResetError('Target admin account does not exist.');
  if (account.role !== 'ADMIN') throw new AdminResetError('Target account is not an ADMIN.');
  if (account.status !== 'ACTIVE') throw new AdminResetError('Target admin account is not ACTIVE.');

  const bcryptRounds = Number(process.env.BCRYPT_ROUNDS || 12);
  const passwordHash = await bcrypt.hash(passwordResult.data, bcryptRounds);
  const result = await prisma.user.updateMany({
    where: {
      id: account.id,
      username: ADMIN_USERNAME,
      role: 'ADMIN',
      status: 'ACTIVE'
    },
    data: {
      passwordHash,
      lastPasswordChange: new Date(),
      authVersion: { increment: 1 }
    }
  });

  if (result.count !== 1) {
    throw new AdminResetError('Target admin account changed during validation; no password was reset.');
  }

  console.log('Targeted admin password reset completed.');
}

try {
  await resetAdminPassword();
} catch (error) {
  console.error(
    error instanceof AdminResetError
      ? `Admin password reset failed: ${error.message}`
      : 'Admin password reset failed due to an unexpected backend error.'
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
