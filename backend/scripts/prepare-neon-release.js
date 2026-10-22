// Filesystem-only release freeze. No connection, migration or bootstrap execution.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import dotenv from 'dotenv';
import { repositoryInventory } from './audit-clinic-readiness.js';

const pending = ['20261022100000_patient_workflow_query_indexes','20261022110000_admin_catalog_configuration'];
const inventory = await repositoryInventory();
if (inventory.migrations.length !== 26 || JSON.stringify(inventory.migrations.slice(-2).map(m=>m.name)) !== JSON.stringify(pending)) throw Error('Migration set changed; release requires review');
const directory = await fs.mkdtemp('/tmp/shifa-neon-release-');
await fs.chmod(directory,0o700);
await fs.copyFile('prisma/schema.prisma',directory+'/schema.prisma');
await fs.mkdir(directory+'/migrations');
await fs.copyFile('prisma/migrations/migration_lock.toml',directory+'/migrations/migration_lock.toml');
for(const migration of inventory.migrations) {
  await fs.mkdir(directory+'/migrations/'+migration.name);
  await fs.copyFile('prisma/migrations/'+migration.name+'/migration.sql',directory+'/migrations/'+migration.name+'/migration.sql');
}
const reference = await fs.readFile('reference-data/production-specialties.sql');
await fs.writeFile(directory+'/production-specialties.sql',reference);
const configuredUrl = new URL(dotenv.parse(await fs.readFile('.env')).DATABASE_URL);
if (!configuredUrl.hostname.endsWith('.neon.tech')) throw Error('Configured Neon URL required without printing it');
const directHostname = configuredUrl.hostname.replace('-pooler.', '.');
const directFingerprint = hash(`${directHostname}${configuredUrl.pathname}/public`).digest('hex').slice(0,16);
const manifest = {
  directFingerprint,
  preparedAt:new Date().toISOString(),databaseWritesExecuted:false,target:'Configured Neon neondb/public; verify fingerprint against fresh preflight before approval/execution',
  bundleDirectory:directory,schemaChecksum:inventory.schemaChecksum,reviewedPending:pending,
  migrations:inventory.migrations,
  reference:{file:'backend/reference-data/production-specialties.sql',checksum:createHash('sha256').update(reference).digest('hex'),expectedNewSpecialties:5,existingRowsPolicy:'Preserve UUID/status/timestamps for exact matches; abort on label/code conflicts'},
};
await fs.writeFile(directory+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');
await fs.mkdir('../docs/clinic-readiness/neon-production-release',{recursive:true});
await fs.writeFile('../docs/clinic-readiness/neon-production-release/release-manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({bundleDirectory:directory,pending,specialtySqlChecksum:manifest.reference.checksum,remoteWrites:0}));
