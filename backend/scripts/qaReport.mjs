import { ID, PATIENT_COUNT, STAGES, STAGING_API, STAGING_TARGET } from './qaPatientPlan.mjs';

export const REASONS = new Set([
  'not_started', 'completed', 'workflow_prerequisites_blocked', 'execution_disabled', 'gate_invalid', 'run_interrupted', 'invalid_configuration',
  'request_not_allowed', 'request_failed', 'invalid_response', 'authorization_failure',
  'retry_budget_exhausted', 'retry_after_exceeds_budget', 'mutation_outcome_unknown',
  'address_fixture_unavailable', 'registration_failed', 'capture_failed', 'verification_failed',
  'login_failed', 'identity_mismatch', 'non_synthetic_identity', 'registration_identity_conflict',
  'no_active_doctors', 'no_available_slots', 'slot_conflict', 'appointment_not_created',
  'clinical_staff_action_required', 'released_lab_fixture_required', 'prescription_fixture_required',
  'patient_billing_route_unavailable_payments_disabled', 'prerequisite_failed', 'unexpected_failure'
]);
export const safeReason = value => REASONS.has(value) ? value : /^http_[45]\d\d$/.test(value || '') ? value : 'unexpected_failure';
const uuid = value => ID.test(value || '') ? value : null;
const number = value => Number.isFinite(value) && value >= 0 ? value : 0;
const timestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ? value : null;

export function createQaReport() {
  return { gate: 'BLOCKED', result: 'BLOCKED', workflowStarted: false, runNamespace: null,
    startedAt: new Date().toISOString(), finishedAt: null, patients: [], reason: 'not_started',
    httpStatuses: {}, retries: 0, networkFailures: 0, unexpected4xx: 0, serverErrors: 0,
    securityFailures: 0, latencies: [], gateChecks: 0, notificationsSinkConfirmed: false,
    paymentsDisabledConfirmed: false, lastGateCheckAt: null, concurrency: 0, maxActiveRequests: 0 };
}

// Construct output from known fields only. Never serialize response bodies,
// error messages, credentials, headers, or caller-supplied metadata.
export function publicQaReport(report) {
  const runNamespace = /^qa-\d{8}-[a-f0-9]{8}$/.test(report.runNamespace || '') ? report.runNamespace : null;
  const patients = (report.patients || []).slice(0, PATIENT_COUNT).map((patient, offset) => ({
    index: offset + 1,
    email: runNamespace ? `${runNamespace}+patient-${String(offset + 1).padStart(3, '0')}@example.invalid` : null,
    userId: uuid(patient.userId), patientId: uuid(patient.patientId), appointmentId: uuid(patient.appointmentId),
    registrationAttempted: patient.registrationAttempted === true,
    ambiguousMutation: patient.ambiguousMutation === true,
    stages: Object.fromEntries(STAGES.map(stage => {
      const entry = patient.stages?.[stage];
      return [stage, { status: ['SUCCESS', 'FAILURE', 'BLOCKED'].includes(entry?.status) ? entry.status : 'BLOCKED',
        reason: entry?.status === 'SUCCESS' ? null : safeReason(entry?.reason || 'not_started') }];
    }))
  }));
  const stages = Object.fromEntries(STAGES.map(stage => [stage, {
    success: patients.filter(p => p.stages[stage].status === 'SUCCESS').length,
    failure: patients.filter(p => p.stages[stage].status === 'FAILURE').length,
    blocked: PATIENT_COUNT - patients.filter(p => p.stages[stage].status !== 'BLOCKED').length
  }]));
  const latencies = (report.latencies || []).filter(n => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  const percentile = p => latencies.length ? latencies[Math.ceil(latencies.length * p) - 1] : 0;
  return {
    schemaVersion: 1, apiOrigin: STAGING_API, targetId: STAGING_TARGET, runNamespace,
    mode: report.workflowStarted === true ? 'EXECUTION' : 'PREFLIGHT',
    gate: report.gate === 'PASS' ? 'PASS' : 'BLOCKED',
    result: ['PASS', 'PARTIAL', 'BLOCKED', 'FAILED'].includes(report.result) ? report.result : 'BLOCKED',
    reason: safeReason(report.reason), startedAt: timestamp(report.startedAt), finishedAt: timestamp(report.finishedAt),
    requestedPatients: PATIENT_COUNT, patientsCreated: stages.registration.success,
    patientsVerified: stages.verification.success, loginSuccess: stages.login.success, loginFailure: stages.login.failure,
    workflowStarted: report.workflowStarted === true, stages, patients,
    httpStatusBreakdown: Object.fromEntries(Object.entries(report.httpStatuses || {}).filter(([key]) => /^[1-5]\d\d$/.test(key)).map(([key, count]) => [key, number(count)])),
    retryCount: number(report.retries), networkFailures: number(report.networkFailures),
    unexpected4xx: number(report.unexpected4xx), serverErrors5xx: number(report.serverErrors),
    securityAuthorizationFailures: number(report.securityFailures),
    latencyMs: { count: latencies.length, min: latencies[0] || 0, max: latencies.at(-1) || 0,
      mean: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
      p50: percentile(0.5), p95: percentile(0.95) },
    concurrency: number(report.concurrency), maxActiveRequests: number(report.maxActiveRequests),
    gateChecks: number(report.gateChecks), lastGateCheckAt: timestamp(report.lastGateCheckAt),
    notificationSinkConfirmed: report.notificationsSinkConfirmed === true,
    paymentDisabledConfirmed: report.paymentsDisabledConfirmed === true,
    externalNotificationRequests: 0, externalPaymentRequests: 0,
    cleanupCandidates: patients.filter(p => p.registrationAttempted).map(({ index, email, userId, patientId, appointmentId, ambiguousMutation }) =>
      ({ index, email, userId, patientId, appointmentId, ambiguousMutation })),
    cleanupPerformed: false
  };
}

export function qaMarkdown(report) {
  return `# Shifa staging QA report\n\nRun: ${report.runNamespace || 'preflight'}\n\nResult: ${report.result}; gate: ${report.gate}; mode: ${report.mode}\n\n`
    + `Requested: ${report.requestedPatients}; created: ${report.patientsCreated}; verified: ${report.patientsVerified}; login success/failure: ${report.loginSuccess}/${report.loginFailure}.\n\n`
    + '| Stage | Success | Failure | Blocked |\n| --- | ---: | ---: | ---: |\n'
    + Object.entries(report.stages).map(([stage, count]) => `| ${stage} | ${count.success} | ${count.failure} | ${count.blocked} |`).join('\n')
    + `\n\nHTTP statuses: ${JSON.stringify(report.httpStatusBreakdown)}\n\nRetries: ${report.retryCount}; unexpected 4xx: ${report.unexpected4xx}; 5xx: ${report.serverErrors5xx}; security/authorization failures: ${report.securityAuthorizationFailures}.\n\n`
    + `Latency (ms): ${JSON.stringify(report.latencyMs)}\n\nNotification sink confirmed: ${report.notificationSinkConfirmed}; payments disabled confirmed: ${report.paymentDisabledConfirmed}.\n\n`
    + `Cleanup candidates: ${report.cleanupCandidates.length}. No cleanup performed. See the companion JSON for synthetic identities, exact IDs, per-patient outcomes, and blocked reasons.\n`;
}
