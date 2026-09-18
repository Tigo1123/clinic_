import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import prisma from '../src/db.js';
import { normalizeEmail } from '../src/utils/identity.js';
import { passwordSchema } from '../src/utils/passwordPolicy.js';

class FirstAdminError extends Error {}

const inputSchema = z.object({
  username: z.string().trim().email().max(254),
  preferredLanguage: z.enum(['ar', 'en'])
});

export function readPassword(filename) {
  if (!filename) throw new FirstAdminError('FIRST_ADMIN_PASSWORD_FILE is required.');
  let raw;
  try {
    const metadata = fs.lstatSync(filename);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('unsafe password file');
    if (metadata.size > 4096) throw new Error('password file too large');
    if ((metadata.mode & 0o777) !== 0o600) throw new Error('password file permissions must be 0600');
    raw = fs.readFileSync(filename, 'utf8');
  } catch {
    throw new FirstAdminError('The protected first-administrator password file is missing, unsafe, or must have mode 0600.');
  }
  if (raw.endsWith('\n')) raw = raw.slice(0, -1);
  if (raw.endsWith('\r')) raw = raw.slice(0, -1);
  if (raw.endsWith('\r') || /[\r\n]/.test(raw)) {
    throw new FirstAdminError('The first-administrator password file must contain one line only.');
  }
  const password = raw;
  const result = passwordSchema.safeParse(password);
  if (!result.success) throw new FirstAdminError('The supplied first-administrator password does not meet application policy.');
  return result.data;
}

async function verifyDatabaseIdentity() {
  const expectedDatabase = process.env.LAN_DATABASE_NAME;
  const confirmation = process.env.CONFIRM_FIRST_ADMIN_DATABASE;
  const expectedRole = process.env.RUNTIME_LOGIN_ROLE;
  if (!expectedDatabase || !confirmation || confirmation !== expectedDatabase) {
    throw new FirstAdminError('Explicit first-administrator database confirmation is required.');
  }
  if (!expectedRole) throw new FirstAdminError('RUNTIME_LOGIN_ROLE is required for first-administrator provisioning.');
  const identity = (await prisma.$queryRaw`SELECT current_database() AS database, session_user AS session_user, current_user AS current_user`)[0];
  if (identity?.database !== expectedDatabase) throw new FirstAdminError('First-administrator provisioning refused because the connected database is not the confirmed LAN database.');
  if (identity?.session_user !== expectedRole || identity?.current_user !== expectedRole) {
    throw new FirstAdminError('First-administrator provisioning refused because the database login identity is not the confirmed LAN runtime login.');
  }
}

export async function provisionFirstAdmin({
  username = process.env.FIRST_ADMIN_USERNAME,
  preferredLanguage = process.env.FIRST_ADMIN_PREFERRED_LANGUAGE || 'en',
  passwordFile = process.env.FIRST_ADMIN_PASSWORD_FILE,
  bcryptRounds = Number(process.env.BCRYPT_ROUNDS || 12)
} = {}) {
  const parsed = inputSchema.safeParse({ username, preferredLanguage });
  if (!parsed.success) throw new FirstAdminError('A valid FIRST_ADMIN_USERNAME and preferred language are required.');
  if (!Number.isInteger(bcryptRounds) || bcryptRounds < 10 || bcryptRounds > 15) {
    throw new FirstAdminError('BCRYPT_ROUNDS must be an integer from 10 through 15.');
  }
  if (normalizeEmail(parsed.data.username) === 'admin@example.invalid') {
    throw new FirstAdminError('The documented placeholder administrator identity cannot be provisioned.');
  }

  const normalizedUsername = normalizeEmail(parsed.data.username);
  await verifyDatabaseIdentity();
  const passwordHash = await bcrypt.hash(readPassword(passwordFile), bcryptRounds);

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'clinic:first-admin:v1'})) IS NULL AS "locked"`;
    if (await tx.user.count({ where: { role: 'ADMIN' } }) !== 0) {
      throw new FirstAdminError('Administrator provisioning refused because an ADMIN account already exists.');
    }
    if (await tx.user.findFirst({ where: { username: { equals: normalizedUsername, mode: 'insensitive' } } })) {
      throw new FirstAdminError('Administrator provisioning refused because the username already exists.');
    }

    const admin = await tx.user.create({
      data: {
        username: normalizedUsername,
        passwordHash,
        role: 'ADMIN',
        status: 'ACTIVE',
        preferredLanguage: parsed.data.preferredLanguage,
        lastPasswordChange: new Date()
      },
      select: { id: true, username: true, role: true, status: true }
    });
    await tx.tenantAuditLog.create({
      data: {
        userId: admin.id,
        action: 'FIRST_ADMIN_PROVISIONED',
        details: 'Initial administrator created by the explicit LAN one-shot provisioner.',
        ipAddress: 'local-bootstrap'
      }
    });
    return admin;
  }, { isolationLevel: 'Serializable' });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`));
if (isMain) {
  try {
    const admin = await provisionFirstAdmin();
    console.log(`First LAN administrator provisioned: ${admin.username}`);
  } catch (error) {
    const safeFailure = error instanceof FirstAdminError
      ? `First administrator provisioning refused: ${error.message}`
      : `First administrator provisioning failed safely (${String(error?.code || error?.name || 'UNKNOWN')}/${String(error?.meta?.code || 'NO_DB_CODE')}).`;
    console.error(safeFailure);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
