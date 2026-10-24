import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import prisma from '../src/db.js';
import { normalizeEmail } from '../src/utils/identity.js';
import { passwordSchema } from '../src/utils/passwordPolicy.js';
import { repositoryInventory } from './audit-clinic-readiness.js';

export class FirstAdminError extends Error {}

const inputSchema = z.object({ username: z.string().trim().email().max(254), preferredLanguage: z.enum(['ar', 'en']) });
const EXPECTED_NEON_DATABASE = 'neondb';
const EXPECTED_NEON_SCHEMA = 'public';
const EXPECTED_NEON_TARGET_FINGERPRINT = 'c9f8bb593c61b80e';
const NEON_CONFIRMATION_PREFIX = 'NEON_PRODUCTION';
// Reviewed staging direct host supplied by the operator, 2026-10-24.
// SHA-256("ep-muddy-unit-b4hvj7be.c-6.us-east-2.aws.neon.tech//neondb/public").slice(0, 16).
// Never accept an environment override or reuse the production fingerprint.
const EXPECTED_NEON_STAGING_TARGET_FINGERPRINT = '36b1790f3b5c2037';
const NEON_STAGING_CONFIRMATION_PREFIX = 'NEON_STAGING';
const REPOSITORY_ROOT = fs.realpathSync(fileURLToPath(new URL('../../', import.meta.url)));

function refuse(message) { throw new FirstAdminError(message); }

export function readPassword(filename) {
  if (!filename) refuse('FIRST_ADMIN_PASSWORD_FILE is required.');
  let raw;
  let descriptor;
  try {
    const canonicalFile = fs.realpathSync(filename);
    const relativeFile = path.relative(REPOSITORY_ROOT, canonicalFile);
    if (!relativeFile || (!relativeFile.startsWith(`..${path.sep}`) && relativeFile !== '..' && !path.isAbsolute(relativeFile))) {
      throw new Error('password file must be outside the repository');
    }
    descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const metadata = fs.fstatSync(descriptor);
    if (!metadata.isFile()) throw new Error('unsafe password file');
    if (metadata.size > 4096) throw new Error('password file too large');
    if ((metadata.mode & 0o777) !== 0o600) throw new Error('password file permissions must be 0600');
    raw = fs.readFileSync(descriptor, 'utf8');
  } catch {
    refuse('The protected first-administrator password file is missing, unsafe, or must have mode 0600.');
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  if (raw.endsWith('\n')) raw = raw.slice(0, -1);
  if (raw.endsWith('\r')) raw = raw.slice(0, -1);
  if (raw.endsWith('\r') || /[\r\n]/.test(raw)) refuse('The first-administrator password file must contain one line only.');
  const result = passwordSchema.safeParse(raw);
  if (!result.success) refuse('The supplied first-administrator password does not meet application policy.');
  return result.data;
}

function parseDatabaseUrl(value) {
  let url;
  try { url = new URL(value); } catch { refuse('A valid production DATABASE_URL is required.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || !url.password) {
    refuse('DATABASE_URL must identify an authenticated PostgreSQL target.');
  }
  return url;
}

export function verifyNeonTargetConfiguration(env = process.env) {
  if (env.FIRST_ADMIN_TARGET_MODE !== 'neon-production') refuse('FIRST_ADMIN_TARGET_MODE must explicitly be neon-production.');
  if (env.NODE_ENV !== 'production') refuse('Neon first-administrator provisioning requires NODE_ENV=production.');
  if (env.LAN_DATABASE_NAME) refuse('LAN target settings are not accepted in Neon production mode.');
  if (env.FIRST_ADMIN_EXPECTED_DATABASE !== EXPECTED_NEON_DATABASE) refuse('FIRST_ADMIN_EXPECTED_DATABASE must be neondb.');
  if (env.FIRST_ADMIN_EXPECTED_SCHEMA !== EXPECTED_NEON_SCHEMA) refuse('FIRST_ADMIN_EXPECTED_SCHEMA must be public.');
  const expectedHost = String(env.FIRST_ADMIN_EXPECTED_NEON_HOST || '').toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+neon\.tech$/.test(expectedHost) || expectedHost.includes('-pooler.')) {
    refuse('FIRST_ADMIN_EXPECTED_NEON_HOST must be the exact direct Neon production hostname.');
  }
  const fingerprint = createHash('sha256').update(`${expectedHost}//${EXPECTED_NEON_DATABASE}/${EXPECTED_NEON_SCHEMA}`).digest('hex').slice(0, 16);
  if (fingerprint !== EXPECTED_NEON_TARGET_FINGERPRINT) refuse('The configured Neon host is not the reviewed production target.');
  const runtimeRole = env.RUNTIME_LOGIN_ROLE;
  if (!runtimeRole || !/^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/.test(runtimeRole)) refuse('RUNTIME_LOGIN_ROLE must name the reviewed runtime login.');
  const url = parseDatabaseUrl(env.DATABASE_URL);
  if (url.hostname.toLowerCase() !== expectedHost) refuse('DATABASE_URL host does not match the confirmed Neon production host.');
  if (url.pathname !== `/${EXPECTED_NEON_DATABASE}`) refuse('DATABASE_URL does not target the expected Neon production database.');
  if ((url.searchParams.get('schema') || 'public') !== EXPECTED_NEON_SCHEMA) refuse('DATABASE_URL does not target the expected Neon schema.');
  if (url.searchParams.get('sslmode') !== 'verify-full') refuse('Neon production DATABASE_URL must use sslmode=verify-full.');
  if (/default_transaction_read_only\s*=\s*on/i.test(url.searchParams.get('options') || '')) refuse('Neon production DATABASE_URL must allow the explicitly approved one-time transaction to write.');
  if (env.CONFIRM_FIRST_ADMIN_TARGET !== `${NEON_CONFIRMATION_PREFIX}:${expectedHost}/${EXPECTED_NEON_DATABASE}/${EXPECTED_NEON_SCHEMA}`) {
    refuse('Explicit Neon first-administrator target confirmation is required.');
  }
  if (env.FIRST_ADMIN_USERNAME === undefined || !String(env.FIRST_ADMIN_USERNAME).trim()) refuse('FIRST_ADMIN_USERNAME must be explicitly supplied.');
  return { host: expectedHost, database: EXPECTED_NEON_DATABASE, schema: EXPECTED_NEON_SCHEMA, runtimeRole };
}

export function verifyNeonStagingTargetConfiguration(env = process.env) {
  if (env.FIRST_ADMIN_TARGET_MODE !== 'neon-staging') refuse('FIRST_ADMIN_TARGET_MODE must explicitly be neon-staging.');
  if (env.NODE_ENV !== 'production') refuse('Neon staging first-administrator provisioning requires NODE_ENV=production.');
  if (env.LAN_DATABASE_NAME) refuse('LAN target settings are not accepted in Neon staging mode.');
  if (env.FIRST_ADMIN_EXPECTED_DATABASE !== EXPECTED_NEON_DATABASE) refuse('FIRST_ADMIN_EXPECTED_DATABASE must be neondb.');
  if (env.FIRST_ADMIN_EXPECTED_SCHEMA !== EXPECTED_NEON_SCHEMA) refuse('FIRST_ADMIN_EXPECTED_SCHEMA must be public.');
  const expectedHost = String(env.FIRST_ADMIN_EXPECTED_NEON_HOST || '');
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+neon\.tech$/.test(expectedHost) || expectedHost.includes('-pooler')) {
    refuse('FIRST_ADMIN_EXPECTED_NEON_HOST must be the exact direct Neon staging hostname.');
  }
  const fingerprint = createHash('sha256').update(`${expectedHost}//${EXPECTED_NEON_DATABASE}/${EXPECTED_NEON_SCHEMA}`).digest('hex').slice(0, 16);
  // Explicitly forbid production even if a future staging pin is misconfigured.
  if (fingerprint === EXPECTED_NEON_TARGET_FINGERPRINT || fingerprint !== EXPECTED_NEON_STAGING_TARGET_FINGERPRINT) {
    refuse('The configured Neon host is not the reviewed staging target.');
  }
  const runtimeRole = env.RUNTIME_LOGIN_ROLE;
  if (!runtimeRole || !/^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/.test(runtimeRole)) refuse('RUNTIME_LOGIN_ROLE must name the reviewed runtime login.');
  const url = parseDatabaseUrl(env.DATABASE_URL);
  if (url.hostname !== expectedHost) refuse('DATABASE_URL host does not match the confirmed Neon staging host.');
  if (url.pathname !== `/${EXPECTED_NEON_DATABASE}`) refuse('DATABASE_URL does not target the expected Neon staging database.');
  if ((url.searchParams.get('schema') || 'public') !== EXPECTED_NEON_SCHEMA) refuse('DATABASE_URL does not target the expected Neon staging schema.');
  if (url.searchParams.get('sslmode') !== 'verify-full') refuse('Neon staging DATABASE_URL must use sslmode=verify-full.');
  // Ambiguous repeated connection settings must not select a different schema/TLS policy.
  if (['schema', 'sslmode', 'options'].some(key => url.searchParams.getAll(key).length > 1)) refuse('Neon staging DATABASE_URL must not repeat schema, sslmode, or options.');
  if (/default_transaction_read_only\s*=\s*on/i.test(url.searchParams.get('options') || '')) refuse('Neon staging DATABASE_URL must allow the explicitly approved one-time transaction to write.');
  if (env.CONFIRM_FIRST_ADMIN_TARGET !== `${NEON_STAGING_CONFIRMATION_PREFIX}:${expectedHost}/${EXPECTED_NEON_DATABASE}/${EXPECTED_NEON_SCHEMA}`) {
    refuse('Explicit Neon staging first-administrator target confirmation is required.');
  }
  if (env.FIRST_ADMIN_USERNAME === undefined || !String(env.FIRST_ADMIN_USERNAME).trim()) refuse('FIRST_ADMIN_USERNAME must be explicitly supplied.');
  return { host: expectedHost, database: EXPECTED_NEON_DATABASE, schema: EXPECTED_NEON_SCHEMA, runtimeRole };
}

export function verifyLanTargetConfiguration(env = process.env) {
  const expectedDatabase = env.LAN_DATABASE_NAME;
  if (!expectedDatabase || env.CONFIRM_FIRST_ADMIN_DATABASE !== expectedDatabase) refuse('Explicit first-administrator database confirmation is required.');
  if (!env.RUNTIME_LOGIN_ROLE) refuse('RUNTIME_LOGIN_ROLE is required for first-administrator provisioning.');
  const url = parseDatabaseUrl(env.DATABASE_URL);
  if (url.hostname !== 'postgres') refuse('LAN target must use the private postgres service hostname.');
  if (url.pathname !== `/${expectedDatabase}`) refuse('DATABASE_URL does not target the confirmed LAN database.');
  if ((url.searchParams.get('schema') || 'public') !== (env.DATABASE_SCHEMA || 'public')) refuse('DATABASE_URL does not target the confirmed LAN schema.');
  if (['localhost', '127.0.0.1', '::1'].includes(url.hostname) && env.NODE_ENV === 'production') refuse('Local database hosts are refused in production mode.');
  return { host: url.hostname, database: expectedDatabase, schema: env.DATABASE_SCHEMA || 'public', runtimeRole: env.RUNTIME_LOGIN_ROLE };
}

export function targetConfiguration(env = process.env) {
  if (env.NODE_ENV === 'production' && !['neon-production', 'neon-staging'].includes(env.FIRST_ADMIN_TARGET_MODE)) {
    refuse('Production first-administrator provisioning requires the pinned Neon production target mode.');
  }
  if (env.FIRST_ADMIN_TARGET_MODE === 'neon-production') return { mode: 'neon-production', ...verifyNeonTargetConfiguration(env) };
  if (env.FIRST_ADMIN_TARGET_MODE === 'neon-staging') return { mode: 'neon-staging', ...verifyNeonStagingTargetConfiguration(env) };
  if (env.FIRST_ADMIN_TARGET_MODE === 'lan') return { mode: 'lan', ...verifyLanTargetConfiguration(env) };
  refuse('FIRST_ADMIN_TARGET_MODE must be explicitly neon-production, neon-staging or lan.');
}

async function verifyDatabaseIdentity(client, target) {
  let identity;
  try {
    [identity] = await client.$queryRaw`SELECT current_database()::text AS database, current_schema()::text AS schema, session_user::text AS session_user, current_user::text AS current_user, pg_is_in_recovery() AS recovery, (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser, (SELECT rolcanlogin FROM pg_roles WHERE rolname=session_user) AS can_login, current_setting('transaction_read_only')::boolean AS transaction_read_only, has_table_privilege(current_user, 'public."User"', 'INSERT') AS can_insert_admin, has_table_privilege(current_user, 'public."TenantAuditLog"', 'INSERT') AS can_insert_audit`;
  } catch {
    refuse('Unable to verify the connected database identity.');
  }
  if (identity?.database !== target.database || identity?.schema !== target.schema) refuse('Connected database or schema does not match the confirmed target.');
  if (identity?.session_user !== target.runtimeRole || identity?.current_user !== target.runtimeRole) refuse('Connected database login/effective role does not match RUNTIME_LOGIN_ROLE.');
  if (identity?.recovery || identity?.superuser !== false) refuse('The target must be a primary database and the runtime login must not be a superuser.');
  if (!identity?.can_login || identity?.transaction_read_only || !identity?.can_insert_admin || !identity?.can_insert_audit) {
    refuse('The runtime login cannot perform the narrowly scoped administrator and audit inserts.');
  }
}

async function verifyMigrationState(client, inventory) {
  let history;
  try {
    history = await client.$queryRaw`SELECT migration_name, checksum, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM public."_prisma_migrations" ORDER BY started_at`;
  } catch {
    refuse('Prisma migration history could not be read.');
  }
  const applied = history.filter(row => row.finished && !row.rolled_back);
  const expected = inventory.migrations;
  const pending = expected.filter(m => !applied.some(row => row.migration_name === m.name));
  const unknown = applied.filter(row => !expected.some(m => m.name === row.migration_name));
  const checksumMismatch = applied.filter(row => expected.some(m => m.name === row.migration_name && m.checksum !== row.checksum));
  const failed = history.filter(row => !row.finished && !row.rolled_back);
  if (pending.length || unknown.length || checksumMismatch.length || failed.length || applied.length !== expected.length) {
    refuse('Prisma migration state is incomplete or differs from the repository.');
  }
}

async function assertNoExistingAdmin(tx, username) {
  // Coordinate concurrent invocations; this lock has no persistent data effect.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'clinic:first-admin:v1'})) IS NULL AS "locked"`;
  if (await tx.user.count({ where: { role: 'ADMIN' } }) !== 0) refuse('Administrator provisioning refused because an ADMIN account already exists.');
  if (await tx.user.findFirst({ where: { username: { equals: username, mode: 'insensitive' } } })) refuse('Administrator provisioning refused because the username already exists.');
}

async function checkInput({ username, preferredLanguage, passwordFile, bcryptRounds }) {
  const parsed = inputSchema.safeParse({ username, preferredLanguage });
  if (!parsed.success) refuse('A valid explicitly supplied FIRST_ADMIN_USERNAME and preferred language are required.');
  if (!Number.isInteger(bcryptRounds) || bcryptRounds < 10 || bcryptRounds > 15) refuse('BCRYPT_ROUNDS must be an integer from 10 through 15.');
  const normalizedUsername = normalizeEmail(parsed.data.username);
  if (normalizedUsername === 'admin@example.invalid') refuse('The documented placeholder administrator identity cannot be provisioned.');
  const password = readPassword(passwordFile);
  return { username: normalizedUsername, preferredLanguage: parsed.data.preferredLanguage, password, bcryptRounds };
}

async function runChecks({ client, target, username }) {
  await verifyDatabaseIdentity(client, target);
  const inventory = await repositoryInventory();
  await verifyMigrationState(client, inventory);
  await client.$transaction(async tx => {
    await assertNoExistingAdmin(tx, username);
    // Recheck schema and migration history under the same transaction that would
    // perform the write, preventing a deploy/target change between preflight and use.
    await verifyDatabaseIdentity(tx, target);
    await verifyMigrationState(tx, inventory);
  }, { isolationLevel: 'Serializable' });
  return inventory.migrations.length;
}

export async function preflightFirstAdmin(options = {}) {
  const env = options.env || process.env;
  const username = options.username ?? env.FIRST_ADMIN_USERNAME;
  const preferredLanguage = options.preferredLanguage ?? env.FIRST_ADMIN_PREFERRED_LANGUAGE ?? 'en';
  const passwordFile = options.passwordFile ?? env.FIRST_ADMIN_PASSWORD_FILE;
  const bcryptRounds = options.bcryptRounds ?? Number(env.BCRYPT_ROUNDS || 12);
  const client = options.client || prisma;
  const hashPassword = options.hashPassword || bcrypt.hash;
  const target = targetConfiguration(env);
  const input = await checkInput({ username, preferredLanguage, passwordFile, bcryptRounds });
  await runChecks({ client, target, username: input.username });
  // Exercise the configured hasher in preflight without retaining or exposing a hash.
  await hashPassword(input.password, input.bcryptRounds);
  return { mode: target.mode, database: target.database, schema: target.schema, migrationCount: (await repositoryInventory()).migrations.length };
}

export async function provisionFirstAdmin(options = {}) {
  const env = options.env || process.env;
  const target = targetConfiguration(env);
  const input = await checkInput({
    username: options.username ?? env.FIRST_ADMIN_USERNAME,
    preferredLanguage: options.preferredLanguage ?? env.FIRST_ADMIN_PREFERRED_LANGUAGE ?? 'en',
    passwordFile: options.passwordFile ?? env.FIRST_ADMIN_PASSWORD_FILE,
    bcryptRounds: options.bcryptRounds ?? Number(env.BCRYPT_ROUNDS || 12),
  });
  const client = options.client || prisma;
  await runChecks({ client, target, username: input.username });
  const passwordHash = await (options.hashPassword || bcrypt.hash)(input.password, input.bcryptRounds);

  return client.$transaction(async tx => {
    await assertNoExistingAdmin(tx, input.username);
    await verifyDatabaseIdentity(tx, target);
    await verifyMigrationState(tx, await repositoryInventory());
    const admin = await tx.user.create({
      data: {
        username: input.username,
        passwordHash,
        role: 'ADMIN',
        status: 'ACTIVE',
        preferredLanguage: input.preferredLanguage,
        lastPasswordChange: new Date(),
      },
      select: { id: true, username: true, role: true, status: true },
    });
    await tx.tenantAuditLog.create({
      data: {
        userId: admin.id,
        action: 'FIRST_ADMIN_PROVISIONED',
        details: 'Initial administrator created by the explicit one-shot provisioner.',
        ipAddress: 'first-admin-provisioner',
      },
    });
    return admin;
  }, { isolationLevel: 'Serializable' });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`));
if (isMain) {
  const flags = process.argv.slice(2);
  const preflightOnly = flags.length === 1 && flags[0] === '--preflight';
  const execute = flags.length === 1 && flags[0] === '--execute';
  try {
    if (!preflightOnly && !execute) refuse('Choose exactly one explicit mode: --preflight or --execute.');
    if (preflightOnly) {
      const result = await preflightFirstAdmin();
      console.log(`First-administrator preflight passed for ${result.mode}, ${result.database}/${result.schema}; ${result.migrationCount} migrations verified. No account was created.`);
    } else {
      await provisionFirstAdmin();
      console.log('First administrator provisioned successfully.');
    }
  } catch (error) {
    const safeFailure = error instanceof FirstAdminError
      ? `First-administrator ${preflightOnly ? 'preflight' : 'provisioning'} refused: ${error.message}`
      : `First-administrator ${preflightOnly ? 'preflight' : 'provisioning'} failed safely (${String(error?.code || error?.name || 'UNKNOWN')}).`;
    console.error(safeFailure);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
