import { z } from 'zod';

export const REFERENCE_BOOTSTRAP_STATES = Object.freeze([
  { id: 1, labelAr: 'الخرطوم', labelEn: 'Khartoum' },
  { id: 2, labelAr: 'الجزيرة', labelEn: 'Gezira' },
  { id: 3, labelAr: 'البحر الأحمر', labelEn: 'Red Sea' },
  { id: 4, labelAr: 'كسلا', labelEn: 'Kassala' },
  { id: 5, labelAr: 'القضارف', labelEn: 'Al Qadarif' },
  { id: 6, labelAr: 'سنار', labelEn: 'Sennar' },
  { id: 7, labelAr: 'النيل الأزرق', labelEn: 'Blue Nile' },
  { id: 8, labelAr: 'النيل الأبيض', labelEn: 'White Nile' },
  { id: 9, labelAr: 'نهر النيل', labelEn: 'River Nile' },
  { id: 10, labelAr: 'الشمالية', labelEn: 'Northern' },
  { id: 11, labelAr: 'غرب كردفان', labelEn: 'West Kordofan' },
  { id: 12, labelAr: 'شمال كردفان', labelEn: 'North Kordofan' },
  { id: 13, labelAr: 'جنوب كردفان', labelEn: 'South Kordofan' },
  { id: 14, labelAr: 'شمال دارفور', labelEn: 'North Darfur' },
  { id: 15, labelAr: 'غرب دارفور', labelEn: 'West Darfur' },
  { id: 16, labelAr: 'جنوب دارفور', labelEn: 'South Darfur' },
  { id: 17, labelAr: 'شرق دارفور', labelEn: 'East Darfur' },
  { id: 18, labelAr: 'وسط دارفور', labelEn: 'Central Darfur' }
]);

const serviceSchema = z.object({
  labelAr: z.string().trim().min(1).max(150),
  labelEn: z.string().trim().min(1).max(150),
  category: z.enum(['CONSULTATION', 'LABORATORY', 'RADIOLOGY', 'CLINICAL_PROCEDURE']),
  status: z.literal('INACTIVE'),
  baseFeeSdg: z.null()
}).strict();

const manifestSchema = z.object({
  version: z.literal(1),
  services: z.array(serviceSchema).max(100)
}).strict();

export class ReferenceBootstrapError extends Error {
  constructor(code, message, report) {
    super(message);
    this.name = 'ReferenceBootstrapError';
    this.code = code;
    this.report = report;
  }
}

export function parseReferenceManifest(input) {
  const manifest = manifestSchema.parse(input);
  const identities = new Set();
  const arabicLabels = new Set();
  const englishLabels = new Set();
  for (const service of manifest.services) {
    const identity = serviceIdentity(service);
    const labelAr = canonicalLabel(service.labelAr);
    const labelEn = canonicalLabel(service.labelEn);
    if (identities.has(identity) || arabicLabels.has(labelAr) || englishLabels.has(labelEn)) {
      throw new ReferenceBootstrapError(
        'REFERENCE_SERVICE_MANIFEST_DUPLICATE',
        'The manifest contains a duplicate or ambiguous canonical ClinicalService label.'
      );
    }
    identities.add(identity);
    arabicLabels.add(labelAr);
    englishLabels.add(labelEn);
  }
  return manifest;
}

function canonicalLabel(value) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
}

function serviceIdentity(service) {
  return `${service.category}\u0000${canonicalLabel(service.labelAr)}\u0000${canonicalLabel(service.labelEn)}`;
}

function stateMatches(actual, expected) {
  return actual.labelAr === expected.labelAr && actual.labelEn === expected.labelEn;
}

function classifyStates(existingStates) {
  const byId = new Map(existingStates.map((state) => [state.id, state]));
  const existing = [];
  const missing = [];
  const conflicting = [];
  for (const expected of REFERENCE_BOOTSTRAP_STATES) {
    const actual = byId.get(expected.id);
    const identityAtAnotherId = existingStates.find((state) => (
      state.id !== expected.id
      && (state.labelAr === expected.labelAr || state.labelEn === expected.labelEn)
    ));
    if (!actual && identityAtAnotherId) conflicting.push({ expected, actual: identityAtAnotherId });
    else if (!actual) missing.push(expected);
    else if (stateMatches(actual, expected)) existing.push(expected);
    else conflicting.push({ expected, actual });
  }
  return { expected: REFERENCE_BOOTSTRAP_STATES.length, existing, missing, conflicting };
}

function classifyServices(existingServices, requestedServices) {
  const existing = [];
  const missing = [];
  const conflicting = [];
  for (const requested of requestedServices) {
    const requestedAr = canonicalLabel(requested.labelAr);
    const requestedEn = canonicalLabel(requested.labelEn);
    const candidates = existingServices.filter((candidate) => (
      canonicalLabel(candidate.labelAr) === requestedAr
      || canonicalLabel(candidate.labelEn) === requestedEn
    ));
    const exact = candidates.filter((candidate) => serviceIdentity(candidate) === serviceIdentity(requested));
    if (candidates.length === 0) missing.push(requested);
    else if (candidates.length === 1 && exact.length === 1) existing.push({ requested, actual: exact[0] });
    else conflicting.push({ requested, candidates });
  }
  return { requested: requestedServices.length, existing, missing, conflicting };
}

async function inspectReferenceData(client, manifest) {
  const [states, services] = await Promise.all([
    client.state.findMany({
      select: { id: true, labelAr: true, labelEn: true },
      orderBy: { id: 'asc' }
    }),
    client.clinicalService.findMany({
      select: { id: true, labelAr: true, labelEn: true, category: true, status: true, baseFeeSdg: true }
    })
  ]);
  return {
    states: classifyStates(states),
    services: classifyServices(services, manifest.services)
  };
}

function assertConflictFree(report) {
  if (report.states.conflicting.length > 0) {
    throw new ReferenceBootstrapError(
      'REFERENCE_STATE_CONFLICT',
      'An expected State ID exists with incompatible labels.',
      report
    );
  }
  if (report.services.conflicting.length > 0) {
    throw new ReferenceBootstrapError(
      'REFERENCE_SERVICE_CONFLICT',
      'A ClinicalService label matches an incompatible or ambiguous catalog identity.',
      report
    );
  }
}

export function validateReferenceBootstrapEnvironment(environment) {
  const enabled = environment.REFERENCE_BOOTSTRAP_ENABLED === 'true';
  if (!enabled) {
    throw new ReferenceBootstrapError('REFERENCE_BOOTSTRAP_DISABLED', 'Reference bootstrap is disabled.');
  }
  const deploymentEnvironment = environment.REFERENCE_BOOTSTRAP_ENVIRONMENT;
  if (!['development', 'test', 'staging', 'production'].includes(deploymentEnvironment)) {
    throw new ReferenceBootstrapError(
      'REFERENCE_BOOTSTRAP_ENVIRONMENT_INVALID',
      'REFERENCE_BOOTSTRAP_ENVIRONMENT must be development, test, staging, or production.'
    );
  }
  if (deploymentEnvironment === 'production'
      && environment.REFERENCE_BOOTSTRAP_PRODUCTION_CONFIRM !== 'I_ACKNOWLEDGE_REFERENCE_DATA_PRODUCTION_WRITE') {
    throw new ReferenceBootstrapError(
      'REFERENCE_BOOTSTRAP_PRODUCTION_REFUSED',
      'Production reference bootstrap requires the explicit production confirmation phrase.'
    );
  }
  const expectedDatabase = String(environment.REFERENCE_BOOTSTRAP_EXPECTED_DATABASE || '').trim();
  if (!expectedDatabase) {
    throw new ReferenceBootstrapError(
      'REFERENCE_BOOTSTRAP_DATABASE_REQUIRED',
      'REFERENCE_BOOTSTRAP_EXPECTED_DATABASE is required.'
    );
  }
  return {
    deploymentEnvironment,
    expectedDatabase,
    dryRun: environment.REFERENCE_BOOTSTRAP_DRY_RUN !== 'false'
  };
}

export async function runReferenceBootstrap({ prisma, manifest: manifestInput, environment }) {
  const options = validateReferenceBootstrapEnvironment(environment);
  const manifest = parseReferenceManifest(manifestInput);
  const rows = await prisma.$queryRaw`SELECT current_database() AS name`;
  const actualDatabase = rows[0]?.name;
  if (actualDatabase !== options.expectedDatabase) {
    throw new ReferenceBootstrapError(
      'REFERENCE_BOOTSTRAP_DATABASE_MISMATCH',
      'Connected database does not match REFERENCE_BOOTSTRAP_EXPECTED_DATABASE.'
    );
  }

  if (options.dryRun) {
    const report = await inspectReferenceData(prisma, manifest);
    return { environment: options.deploymentEnvironment, database: actualDatabase, mode: 'DRY RUN', report };
  }

  const report = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtext(${'clinic:reference-bootstrap:v1'})) IS NULL AS "locked"
    `;
    const laboratoryLabelLocks = manifest.services
      .filter((service) => service.category === 'LABORATORY')
      .flatMap((service) => [canonicalLabel(service.labelAr), canonicalLabel(service.labelEn)])
      .map((label) => `lab-service:${label}`)
      .sort();
    for (const lockKey of laboratoryLabelLocks) {
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtext(${lockKey})) IS NULL AS "locked"
      `;
    }
    const before = await inspectReferenceData(tx, manifest);
    assertConflictFree(before);
    for (const state of before.states.missing) {
      await tx.state.create({ data: state });
    }
    for (const service of before.services.missing) {
      await tx.clinicalService.create({
        data: {
          labelAr: service.labelAr,
          labelEn: service.labelEn,
          category: service.category,
          status: 'INACTIVE',
          baseFeeSdg: null,
          baseFeeUsd: null
        }
      });
    }
    return inspectReferenceData(tx, manifest);
  });

  return { environment: options.deploymentEnvironment, database: actualDatabase, mode: 'WRITE', report };
}
