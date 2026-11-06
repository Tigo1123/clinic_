import { randomUUID } from 'node:crypto';

const RUN_ID_PATTERN = /^qa-\d{8}-[a-f0-9]{8}$/;

export function createQaRunNamespace(now = new Date(), uuid = randomUUID()) {
  const date = now.toISOString().slice(0, 10).replaceAll('-', '');
  const suffix = uuid.replaceAll('-', '').slice(0, 8).toLowerCase();
  if (!/^[a-f0-9]{8}$/.test(suffix)) throw new Error('A valid run identifier is required.');
  return `qa-${date}-${suffix}`;
}

export function qaPatientIdentifiers(runNamespace, index) {
  if (!RUN_ID_PATTERN.test(runNamespace || '')) throw new Error('A namespaced QA run ID is required.');
  if (!Number.isInteger(index) || index < 1 || index > 100) throw new Error('Patient index must be between 1 and 100.');
  const suffix = String(index).padStart(3, '0');
  const marker = `${runNamespace}-patient-${suffix}`;
  return {
    marker,
    username: `${marker}@example.invalid`,
    email: `${runNamespace}+patient-${suffix}@example.invalid`,
    fullNameEn: `QA ${runNamespace} Patient ${suffix}`
  };
}
