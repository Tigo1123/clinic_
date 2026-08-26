import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '../src/generated/prisma/index.js';
import {
  ReferenceBootstrapError,
  parseReferenceManifest,
  runReferenceBootstrap,
  validateReferenceBootstrapEnvironment
} from '../src/services/referenceBootstrap.js';

const MAX_MANIFEST_BYTES = 256 * 1024;

function loadManifest(environment) {
  const manifestPath = String(environment.REFERENCE_BOOTSTRAP_MANIFEST || '').trim();
  if (!manifestPath) throw new ReferenceBootstrapError('REFERENCE_BOOTSTRAP_MANIFEST_REQUIRED', 'REFERENCE_BOOTSTRAP_MANIFEST is required.');
  const resolved = path.resolve(manifestPath);
  const stats = fs.statSync(resolved);
  if (!stats.isFile() || stats.size > MAX_MANIFEST_BYTES) {
    throw new ReferenceBootstrapError('REFERENCE_BOOTSTRAP_MANIFEST_INVALID', 'Reference manifest must be a JSON file no larger than 256 KiB.');
  }
  return parseReferenceManifest(JSON.parse(fs.readFileSync(resolved, 'utf8')));
}

function countReport(result) {
  return {
    states: {
      expected: result.report.states.expected,
      existing: result.report.states.existing.length,
      missing: result.report.states.missing.length,
      conflicts: result.report.states.conflicting.length
    },
    clinicalServices: {
      requested: result.report.services.requested,
      existing: result.report.services.existing.length,
      missing: result.report.services.missing.length,
      conflicts: result.report.services.conflicting.length
    }
  };
}

function printResult(result) {
  const counts = countReport(result);
  console.log('REFERENCE BOOTSTRAP TARGET');
  console.log(`Environment: ${result.environment}`);
  console.log(`Database: ${result.database}`);
  console.log(`Mode: ${result.mode}`);
  console.log('States:');
  console.log(`Expected: ${counts.states.expected}`);
  console.log(`Existing: ${counts.states.existing}`);
  console.log(`Missing: ${counts.states.missing}`);
  console.log(`Conflicts: ${counts.states.conflicts}`);
  console.log('ClinicalServices:');
  console.log(`Requested: ${counts.clinicalServices.requested}`);
  console.log(`Existing: ${counts.clinicalServices.existing}`);
  console.log(`Missing: ${counts.clinicalServices.missing}`);
  console.log(`Conflicts: ${counts.clinicalServices.conflicts}`);
}

let prisma;
try {
  const options = validateReferenceBootstrapEnvironment(process.env);
  const databaseUrl = String(process.env.REFERENCE_BOOTSTRAP_DATABASE_URL || '').trim();
  if (!databaseUrl) {
    throw new ReferenceBootstrapError(
      'REFERENCE_BOOTSTRAP_DATABASE_URL_REQUIRED',
      'REFERENCE_BOOTSTRAP_DATABASE_URL is required; DATABASE_URL is not used as a fallback.'
    );
  }
  const manifest = loadManifest(process.env);
  prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const result = await runReferenceBootstrap({ prisma, manifest, environment: {
    ...process.env,
    REFERENCE_BOOTSTRAP_DRY_RUN: options.dryRun ? 'true' : 'false'
  } });
  printResult(result);
  if (result.report.states.conflicting.length > 0 || result.report.services.conflicting.length > 0) {
    throw new ReferenceBootstrapError(
      'REFERENCE_BOOTSTRAP_CONFLICT',
      'Reference conflicts must be resolved before write mode can be used.',
      result.report
    );
  }
} catch (error) {
  if (error instanceof ReferenceBootstrapError || error instanceof SyntaxError || error?.name === 'ZodError') {
    console.error(`Reference bootstrap refused: ${error.code || 'REFERENCE_BOOTSTRAP_INPUT_INVALID'}: ${error.message}`);
  } else {
    console.error('Reference bootstrap failed safely. Review server-side operational logs.');
  }
  process.exitCode = 1;
} finally {
  await prisma?.$disconnect();
}
