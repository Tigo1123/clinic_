import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { PrismaClient } from '../src/generated/prisma/index.js';
import { assertIsolatedPostgres } from './assert-isolated-postgres.js';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { schema } = assertIsolatedPostgres({ purpose: 'QA reset', requiredDatabaseFragment: 'qa', requiredSchemaPrefix: 'qa_' });
const prisma = new PrismaClient();
await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
await prisma.$disconnect();

for (const [command, args] of [
  ['npx', ['prisma', 'migrate', 'deploy']],
  ['node', ['prisma/seed.js']],
  ['node', ['scripts/seed-qa.js']]
]) {
  const result = spawnSync(command, args, { cwd: backendDir, env: process.env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`Isolated PostgreSQL QA schema recreated: ${schema}`);
