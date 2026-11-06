import { createQaRunNamespace } from './qaRunNamespace.mjs';
import { fetchQaVerificationCode } from './stagingQaGate.mjs';
import { normalizeQaMarker } from '../src/utils/qaEnvironmentMarkers.js';
import { assertSyntheticPatient, ID, PATIENT_COUNT, registrationBody, safeConcurrency, STAGES, syntheticPatient } from './qaPatientPlan.mjs';
import { createQaReport, publicQaReport, safeReason } from './qaReport.mjs';
import { createQaTransport, QaRunError } from './qaTransport.mjs';

function requireValue(condition, reason = 'invalid_response') {
  if (!condition) throw new QaRunError(reason);
}
function requireList(value) { requireValue(Array.isArray(value)); return value; }
const success = () => ({ status: 'SUCCESS', reason: null });
const blocked = reason => ({ status: 'BLOCKED', reason });

function futureDates(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: 'Africa/Khartoum', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(now)).map(({ type, value }) => [type, value]));
  return Array.from({ length: 7 }, (_, index) => new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + index + 1)).toISOString().slice(0, 10));
}

export async function runPatientQa({ env = process.env, fetchImpl = fetch, now = Date.now, sleep, signal } = {}) {
  // Snapshot runner pins and credentials. Never write this object to a report.
  env = Object.freeze({ ...env });
  const report = createQaReport();
  const client = createQaTransport({ env, report, fetchImpl, now, sleep, signal });
  let gate;
  try {
    // Mandatory first step, including preflight-only invocations. No patient
    // identity, password, address discovery, or workflow request precedes it.
    gate = await client.checkGate();
    report.runNamespace = createQaRunNamespace(new Date(now()));
    if (normalizeQaMarker(env.QA_EXECUTE_PATIENT_WORKFLOWS) !== 'true') {
      report.result = 'PASS'; report.reason = 'execution_disabled';
      return finish();
    }
    try { report.concurrency = safeConcurrency(env.QA_MAX_CONCURRENCY ?? '2'); }
    catch { throw new QaRunError('invalid_configuration'); }
    report.patients = Array.from({ length: PATIENT_COUNT }, () => ({ stages: Object.fromEntries(STAGES.map(stage => [stage, blocked('not_started')])) }));
    const addresses = await client.json('/api/patient-auth/address-states');
    const addressStateId = addresses?.states?.find(state => Number.isInteger(state.id) && state.id >= 1 && state.id <= 18)?.id;
    if (!addressStateId) throw new QaRunError('address_fixture_unavailable');
    report.workflowStarted = true;

    const usedSlots = new Set();
    let slotPool;
    // Bound discovery to three existing active doctors over the next seven
    // clinic days. Share the snapshot across workers, never fabricate capacity.
    async function availableSlot(doctors) {
      if (!slotPool) {
        slotPool = (async () => {
          const pool = [];
          for (const doctor of doctors.filter(d => ID.test(d.id || '') && d.status === 'ACTIVE').slice(0, 3)) {
            for (const date of futureDates(now())) {
              const slots = requireList(await client.json(`/api/appointments/slots?doctorId=${doctor.id}&date=${date}`));
              for (const time of slots.filter(time => typeof time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))) {
                pool.push({ doctorId: doctor.id, appointmentDate: date, appointmentTime: time });
              }
            }
          }
          return pool;
        })();
      }
      const pool = await slotPool;
      const slot = pool.find(item => !usedSlots.has(JSON.stringify(item)));
      if (slot) usedSlots.add(JSON.stringify(slot));
      return slot;
    }

    async function patientWorkflow(index) {
      const entry = report.patients[index - 1];
      const patient = syntheticPatient(report.runNamespace, index, addressStateId);
      assertSyntheticPatient(patient, report.runNamespace, index);
      let stage = 'registration';
      let token;
      async function perform(name, work) {
        stage = name;
        try {
          const value = await work();
          entry.stages[name] = success();
          return value;
        } catch (error) {
          if (error.reason === 'identity_mismatch') { report.securityFailures++; client.stop('identity_mismatch'); }
          throw error;
        }
      }
      try {
        client.assertRunning();
        const registered = await perform('registration', async () => {
          // Mark before sending: cleanup candidates include ambiguous failures.
          entry.registrationAttempted = true;
          const response = await client.json('/api/patient-auth/register', { method: 'POST', body: registrationBody(patient), expectedStatus: 201 });
          requireValue(response?.state === 'VERIFICATION_REQUIRED' && ID.test(response.challengeId || ''));
          return response;
        });
        const code = await perform('capture', () => fetchQaVerificationCode({ gateResult: gate, challengeId: registered.challengeId,
          env, fetchImpl: client.workflowFetch }));
        const verified = await perform('verification', async () => {
          const response = await client.json('/api/patient-auth/verify', { method: 'POST', body: { challengeId: registered.challengeId, code } });
          requireValue(['CLAIMED', 'VERIFIED'].includes(response?.state) && ID.test(response.patient?.id || ''), 'identity_mismatch');
          // Prove this is our new synthetic patient before using its record ID.
          requireValue(response.patient.phone === patient.phone && response.patient.fullNameEn ===
            `${patient.firstNameEn} ${patient.fatherNameEn} ${patient.grandfatherNameEn} ${patient.familyNameEn}`, 'identity_mismatch');
          entry.patientId = response.patient.id;
          return response;
        });
        await perform('login', async () => {
          const response = await client.json('/api/auth/login', { method: 'POST', body: { username: patient.email, password: patient.password } });
          requireValue(typeof response?.token === 'string' && response.token.length > 0 && response.user?.role === 'PATIENT'
            && response.user.username === patient.email && response.user.patientLinked === true
            && response.user.patientId === verified.patient.id && ID.test(response.user.id || ''), 'identity_mismatch');
          token = response.token;
          entry.userId = response.user.id;
        });
        // Remaining read stages are independent; failed prerequisites only block
        // dependent stages. Authentication/security failures still stop everyone.
        async function readStage(name, path, validate) {
          try {
            return await perform(name, async () => {
              const response = await client.json(path, { token });
              validate(response);
              return response;
            });
          } catch (error) {
            if (client.stopped) throw error;
            entry.stages[name] = { status: 'FAILURE', reason: safeReason(error.reason) };
            return null;
          }
        }
        const profile = await readStage('profile', '/api/patient/me', value => requireValue(value?.id === entry.patientId && value.phone === patient.phone, 'identity_mismatch'));
        if (!profile) throw new QaRunError('identity_mismatch');
        const doctors = await readStage('doctors', '/api/patient/doctors', requireList);
        await readStage('specialties', '/api/patient/specialties', requireList);
        if (!doctors) {
          entry.stages.slots = blocked('prerequisite_failed');
          entry.stages.appointmentCreate = blocked('prerequisite_failed');
        } else if (!doctors.some(d => ID.test(d.id || '') && d.status === 'ACTIVE')) {
          entry.stages.slots = blocked('no_active_doctors');
          entry.stages.appointmentCreate = blocked('no_active_doctors');
        } else {
          let slot;
          stage = 'slots';
          try {
            slot = await availableSlot(doctors);
            entry.stages.slots = slot ? success() : blocked('no_available_slots');
          } catch (error) {
            if (client.stopped) throw error;
            entry.stages.slots = { status: 'FAILURE', reason: safeReason(error.reason) };
          }
          if (!slot) entry.stages.appointmentCreate = blocked('no_available_slots');
          else {
            try {
              await perform('appointmentCreate', async () => {
                const response = await client.json('/api/patient/appointments', { method: 'POST', body: slot, token, expectedStatus: 201 });
                requireValue(ID.test(response?.id || '') && response.patientId === entry.patientId
                  && response.doctorId === slot.doctorId && response.appointmentDate === slot.appointmentDate
                  && response.appointmentTime === slot.appointmentTime && response.status === 'PENDING', 'identity_mismatch');
                entry.appointmentId = response.id;
              });
            } catch (error) {
              if (client.stopped || error.reason === 'mutation_outcome_unknown') throw error;
              entry.stages.appointmentCreate = error.status === 409 ? blocked('slot_conflict') : { status: 'FAILURE', reason: safeReason(error.reason) };
            }
          }
        }
        await readStage('appointmentList', '/api/patient/appointments', value => {
          requireList(value);
          if (entry.appointmentId) requireValue(value.some(item => item.id === entry.appointmentId), 'identity_mismatch');
        });
        if (entry.appointmentId) {
          await readStage('appointmentDetail', `/api/patient/appointments/${entry.appointmentId}`, value =>
            requireValue(value?.id === entry.appointmentId && ['PENDING', 'SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'IN_PROGRESS'].includes(value.status), 'identity_mismatch'));
        } else entry.stages.appointmentDetail = blocked('appointment_not_created');
        await readStage('medicalRecords', '/api/patient/medical-records', requireList);
        const labs = await readStage('labResults', '/api/patient/lab-results', requireList);
        const prescriptions = await readStage('prescriptions', '/api/patient/prescriptions', requireList);
        // Patient credentials cannot order/release labs, prescribe/dispense, or
        // perform staff billing. No clinical fixture or staff identity is invented.
        entry.stages.labWorkflow = blocked(labs?.length ? 'clinical_staff_action_required' : 'released_lab_fixture_required');
        entry.stages.pharmacyWorkflow = blocked(prescriptions?.length ? 'clinical_staff_action_required' : 'prescription_fixture_required');
        entry.stages.billingWorkflow = blocked('patient_billing_route_unavailable_payments_disabled');
      } catch (error) {
        if (error.reason === 'identity_mismatch' && client.stopped !== 'identity_mismatch') report.securityFailures++;
        const identityConflict = stage === 'registration' && error.status === 409;
        const reason = identityConflict ? 'registration_identity_conflict' : client.stopped || error.reason || (stage === 'capture' ? 'capture_failed' : 'unexpected_failure');
        entry.stages[stage] = { status: identityConflict || (client.stopped && error.status == null) ? 'BLOCKED' : 'FAILURE', reason: safeReason(reason) };
        entry.ambiguousMutation = error.reason === 'mutation_outcome_unknown';
        if (['registration', 'capture', 'verification', 'login', 'profile'].includes(stage) || entry.ambiguousMutation) client.stop(reason);
        for (const name of STAGES) if (entry.stages[name].reason === 'not_started') entry.stages[name] = blocked('prerequisite_failed');
      } finally {
        // Credentials exist only in memory for this patient's normal flow.
        patient.password = undefined;
        token = undefined;
      }
    }

    let next = 1;
    await Promise.all(Array.from({ length: report.concurrency }, async () => {
      while (!client.stopped && next <= PATIENT_COUNT) {
        const index = next++;
        try { await patientWorkflow(index); }
        catch { client.stop('unexpected_failure'); }
      }
    }));
    if (client.stopped) {
      report.reason = safeReason(client.stopped); report.result = client.stopped === 'registration_identity_conflict' ? 'BLOCKED' : 'FAILED';
      for (const entry of report.patients) for (const stage of STAGES) {
        if (entry.stages[stage].reason === 'not_started') entry.stages[stage] = blocked(report.reason);
      }
    } else {
      await client.checkGate();
      const failure = report.patients.some(p => Object.values(p.stages).some(s => s.status === 'FAILURE'));
      const prerequisitesBlocked = report.patients.some(p => Object.values(p.stages).some(s => s.status === 'BLOCKED'));
      report.result = failure ? 'FAILED' : prerequisitesBlocked ? 'PARTIAL' : 'PASS';
      report.reason = prerequisitesBlocked ? 'workflow_prerequisites_blocked' : 'completed';
    }
  } catch (error) {
    report.result = 'BLOCKED'; report.reason = safeReason(client.stopped || error.reason || 'unexpected_failure');
  }
  return finish();

  function finish() {
    report.finishedAt = new Date(now()).toISOString();
    return publicQaReport(report);
  }
}
