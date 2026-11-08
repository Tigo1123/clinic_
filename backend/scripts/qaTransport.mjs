import { StagingQaGateError, verifyLocalQaGate, verifyStagingQaGate } from './stagingQaGate.mjs';
import { assertSyntheticPatient, permittedQaRequest, STAGING_API, STAGING_TARGET } from './qaPatientPlan.mjs';
import { normalizeQaMarker } from '../src/utils/qaEnvironmentMarkers.js';

export class QaRunError extends Error {
  constructor(reason, status = null) { super(reason); this.reason = reason; this.status = status; }
}

export const SENSITIVE_INTERVAL_MS = 95_000; // Below 10 requests / 15 minutes per IP.
export const LONG_PAUSE_TOLERANCE_MS = 60_000;
const REQUEST_INTERVAL_MS = 250;
const MAX_RETRIES = 2;
const MAX_RETRY_WAIT_MS = 20 * 60_000;
const GATE_RETRY_DELAYS_MS = [2000, 5000];
const HEALTH = new Set(['/api/health/load-test-target', '/api/health', '/api/health/ready']);

export function createQaTransport({ env, report, fetchImpl = fetch, now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), signal, mode = 'staging', databaseProbe }) {
  let stopped = null;
  let tail = Promise.resolve();
  let workflowTail = Promise.resolve();
  let lastRequest = -Infinity;
  let cooldownUntil = 0;
  let gatePromise;
  let localPreflightPassed = false;
  const lanes = new Map();
  let checkpoint = now();
  const scheduledWakes = new Map();

  function stop(reason) { stopped ||= reason; }
  function longPause() {
    report.gate = 'BLOCKED';
    report.reason = 'run_long_pause_detected';
    stop('run_long_pause_detected');
    throw new QaRunError(stopped);
  }
  function assertRunning() {
    if (signal?.aborted) stop('run_interrupted');
    if (stopped) throw new QaRunError(stopped);
    const current = now();
    const expected = scheduledWakes.size ? Math.min(...scheduledWakes.values()) : Infinity;
    if (current > checkpoint + LONG_PAUSE_TOLERANCE_MS || current > expected + LONG_PAUSE_TOLERANCE_MS
        || current < checkpoint - LONG_PAUSE_TOLERANCE_MS) longPause();
    checkpoint = current;
    return current;
  }
  async function scheduledSleep(ms) {
    const started = assertRunning();
    const ticket = Symbol();
    const expected = started + ms;
    scheduledWakes.set(ticket, expected);
    try {
      await sleep(ms);
      const current = now();
      if (current > Math.min(...scheduledWakes.values()) + LONG_PAUSE_TOLERANCE_MS
          || current < checkpoint - LONG_PAUSE_TOLERANCE_MS) longPause();
      // Only a validated scheduled wake may advance continuity past an idle
      // interval. Another worker's pending sleep cannot exempt a stage/request.
      checkpoint = current;
      assertRunning();
    } finally {
      scheduledWakes.delete(ticket);
    }
  }

  // Single network queue bounds total in-flight HTTP requests, including gate
  // probes and retries, regardless of the number of patient workers.
  function rawFetch(input, options = {}) {
    const operation = tail.then(async () => {
      assertRunning();
      let url;
      try { url = new URL(input); } catch { throw new QaRunError('request_not_allowed'); }
      const method = options.method || 'GET';
      const allowedOrigin = mode === 'local' ? env.QA_API_ORIGIN : STAGING_API;
      const expectedTarget = mode === 'local' ? 'clinic-local-disposable' : STAGING_TARGET;
      if ((env.QA_EXPECTED_TARGET_ID !== STAGING_TARGET && !(mode === 'local' && env.QA_EXPECTED_TARGET_ID === expectedTarget))
          || !permittedQaRequest(url, method, allowedOrigin)) throw new QaRunError('request_not_allowed');
      const delay = REQUEST_INTERVAL_MS - (now() - lastRequest);
      if (delay > 0) await scheduledSleep(delay);
      const started = assertRunning();
      lastRequest = started;
      const networkWake = Symbol();
      scheduledWakes.set(networkWake, started + 20_000);
      report.maxActiveRequests = Math.max(report.maxActiveRequests, 1);
      let response;
      try {
        response = await fetchImpl(url.href, { ...options, method, redirect: 'error', cache: 'no-store',
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000) });
        assertRunning();
        // Consume the bounded JSON response inside the timeout and queue. No
        // response bodies are logged or copied into reports.
        const text = await response.text();
        assertRunning();
        if ([401, 403].includes(response.status)) { report.securityFailures++; stop('authorization_failure'); }
        if (text.length > 2_000_000) throw new QaRunError('invalid_response');
        response = new Response([204, 205, 304].includes(response.status) ? null : text,
          { status: response.status, headers: response.headers });
      } catch (error) {
        if (error instanceof QaRunError) {
          if (error.reason === 'run_long_pause_detected' && method !== 'GET') error.mutationOutcomeUnknown = true;
          throw error;
        }
        try { assertRunning(); }
        catch (pause) {
          if (pause.reason === 'run_long_pause_detected' && method !== 'GET') pause.mutationOutcomeUnknown = true;
          throw pause;
        }
        if (signal?.aborted) { stop('run_interrupted'); throw new QaRunError('run_interrupted'); }
        report.networkFailures++;
        if (method !== 'GET') throw new QaRunError('mutation_outcome_unknown');
        throw new QaRunError('request_failed');
      } finally {
        scheduledWakes.delete(networkWake);
        report.latencies.push(Math.max(0, now() - started));
      }
      const status = response.status;
      report.httpStatuses[status] = (report.httpStatuses[status] || 0) + 1;
      if (status >= 500) report.serverErrors++;
      if (status >= 400 && status < 500 && status !== 429
          && !(status === 409 && url.pathname === '/api/patient/appointments')) report.unexpected4xx++;
      if (url.pathname === '/api/health/load-test-target') {
        let target;
        try { target = await response.clone().json(); } catch { throw new QaRunError('gate_invalid'); }
        report.notificationsSinkConfirmed = target.notifications === 'sink';
        report.paymentsDisabledConfirmed = target.payments === 'disabled';
        // The old preflight permits ledger-only, but this authorized run pins
        // the stricter disabled-payment configuration requested by the operator.
        if (!response.ok || (normalizeQaMarker(env.QA_EXECUTE_PATIENT_WORKFLOWS) === 'true' && target.payments !== 'disabled')) throw new QaRunError('gate_invalid');
      }
      return response;
    });
    tail = operation.catch(() => {});
    return operation;
  }

  async function checkGate() {
    if (signal?.aborted) report.gate = 'BLOCKED';
    assertRunning();
    if (!gatePromise) {
      gatePromise = (async () => {
        // Invalidate any earlier PASS while the current full sequence is
        // unresolved. All workflow requests await this shared promise.
        report.gate = 'CHECKING';
        function fail(reason) {
          report.gate = 'BLOCKED';
          stop(reason);
          throw new QaRunError(reason);
        }
        for (let attempt = 0; attempt <= GATE_RETRY_DELAYS_MS.length; attempt++) {
          let transportFailed = false;
          report.gateChecks++;
          try {
            const gateCheck = mode === 'local' ? verifyLocalQaGate : verifyStagingQaGate;
            const result = await gateCheck({ env, databaseProbe,
              ...(mode === 'local' ? { initialPreflight: !localPreflightPassed } : {}),
              fetchImpl: async (...args) => {
              try { return await rawFetch(...args); }
              catch (error) {
                // Gate helpers intentionally hide fetch exceptions.
                // Preserve only this local classification, never the exception.
                transportFailed = error instanceof QaRunError && error.reason === 'request_failed';
                throw error;
              }
            } });
            assertRunning();
            report.gate = 'PASS';
            if (mode === 'local') localPreflightPassed = true;
            report.lastGateCheckAt = new Date(now()).toISOString();
            return result;
          } catch (error) {
            if (signal?.aborted || stopped === 'run_interrupted') fail('run_interrupted');
            if (stopped === 'run_long_pause_detected') fail(stopped);
            if (!transportFailed || stopped) fail(mode === 'local' && error instanceof StagingQaGateError ? error.code : 'gate_invalid');
            if (attempt === GATE_RETRY_DELAYS_MS.length) fail('gate_transport_retry_exhausted');
            report.gateRetryCount = (report.gateRetryCount || 0) + 1;
            try { await scheduledSleep(GATE_RETRY_DELAYS_MS[attempt]); assertRunning(); }
            catch { fail(signal?.aborted || stopped === 'run_interrupted' ? 'run_interrupted' : stopped === 'run_long_pause_detected' ? stopped : 'gate_invalid'); }
          }
        }
      })().finally(() => { gatePromise = null; });
    }
    return gatePromise;
  }

  async function waitUntil(due) {
    while (due > now()) {
      assertRunning();
      await scheduledSleep(Math.min(30_000, due - now()));
      // Keep watching the safety gate during long rate-limit/pacing waits.
      await checkGate();
    }
    assertRunning();
  }

  async function pace(path) {
    const lane = ['/api/patient-auth/register', '/api/patient-auth/verify', '/api/auth/login'].includes(path) ? path : null;
    if (lane) {
      await waitUntil(lanes.get(lane) || 0);
    }
    await waitUntil(cooldownUntil);
  }

  async function workflowFetch(input, options = {}) {
    assertRunning();
    const url = new URL(input);
    if (HEALTH.has(url.pathname)) throw new QaRunError('request_not_allowed');
    const method = options.method || 'GET';
    const allowedOrigin = mode === 'local' ? env.QA_API_ORIGIN : STAGING_API;
    if (!permittedQaRequest(url, method, allowedOrigin)) throw new QaRunError('request_not_allowed');
    if (url.pathname === '/api/patient-auth/register') {
      let body;
      try { body = JSON.parse(options.body); } catch { throw new QaRunError('non_synthetic_identity'); }
      try {
        assertSyntheticPatient({ ...body, username: body.email }, report.runNamespace, Number(body.email?.match(/patient-(\d{3})@example\.invalid$/)?.[1]));
      } catch { throw new QaRunError('non_synthetic_identity'); }
    }
    const capture = url.pathname.startsWith('/api/qa/verification-capture/');
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // Serialize pacing + safety recheck + send as one operation. Measuring
      // lane spacing from actual completion avoids bursts after slow probes.
      const operation = workflowTail.then(async () => {
        await pace(url.pathname);
        await checkGate();
        assertRunning();
        try { return await rawFetch(input, options); }
        finally {
          if (['/api/patient-auth/register', '/api/patient-auth/verify', '/api/auth/login'].includes(url.pathname)) {
            lanes.set(url.pathname, now() + SENSITIVE_INTERVAL_MS);
          }
        }
      });
      workflowTail = operation.catch(() => {});
      const response = await operation;
      const transient = method === 'GET' && (response.status === 429 || (response.status >= 500 && !capture));
      if (!transient) {
        if (response.status >= 500 && method === 'POST') throw new QaRunError('mutation_outcome_unknown', response.status);
        return response;
      }
      if (attempt === MAX_RETRIES) throw new QaRunError('retry_budget_exhausted', response.status);
      const retryAfter = response.headers.get('retry-after');
      let delay = response.status === 429 ? SENSITIVE_INTERVAL_MS : 2000 * 2 ** attempt;
      if (retryAfter) {
        const required = /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - now();
        if (!Number.isFinite(required) || required > MAX_RETRY_WAIT_MS) throw new QaRunError('retry_after_exceeds_budget', response.status);
        delay = Math.max(delay, required);
      }
      cooldownUntil = Math.max(cooldownUntil, now() + delay);
      report.retries++;
      await waitUntil(cooldownUntil);
    }
  }

  async function json(path, { method = 'GET', body, token, expectedStatus = 200 } = {}) {
    const apiOrigin = mode === 'local' ? env.QA_API_ORIGIN : STAGING_API;
    const response = await workflowFetch(`${apiOrigin}${path}`, {
      method, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    if (!response.ok) throw new QaRunError(`http_${response.status}`, response.status);
    if (response.status !== expectedStatus) throw new QaRunError('invalid_response');
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) throw new QaRunError('invalid_response');
    try { return await response.json(); } catch { throw new QaRunError('invalid_response'); }
  }

  return { checkGate, workflowFetch, json, stop, assertRunning, get stopped() { return stopped; } };
}
