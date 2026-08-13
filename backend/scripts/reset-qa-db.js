import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const qaDatabase = path.join(backendDir, 'prisma', 'qa.db');

if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL !== 'file:./qa.db') {
  throw new Error('QA reset refused: set NODE_ENV=qa and DATABASE_URL=file:./qa.db.');
}

fs.rmSync(qaDatabase, { force: true });

for (const [command, args] of [
  ['npx', ['prisma', 'migrate', 'deploy']],
  ['node', ['prisma/seed.js']],
  ['node', ['scripts/seed-qa.js']]
]) {
  const result = spawnSync(command, args, { cwd: backendDir, env: process.env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`QA database recreated at ${qaDatabase}`);
