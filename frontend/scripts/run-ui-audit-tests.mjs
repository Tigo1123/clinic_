// Explicit audit regressions, one process per file, never a glob or concurrent workers.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const groups = {
  shared: ['apiClient', 'passwordField', 'appDatePicker', 'authStorage', 'logout', 'socketRevocation', 'sessionRevocation'],
  auth: ['loginScreens', 'staffLogin', 'staffLoginSubmission', 'staffMfa', 'staffSecurityDialog', 'mfaCodeInput', 'patientOnboarding', 'registrationAddress', 'patientGoogleLinking'],
  admin: ['clinicSetup', 'adminPricing.runtime', 'staffAccountsPanel', 'adminScheduleComponent', 'adminSchedulePanelRace', 'specialtiesPanel', 'pricingSecurity'],
  reception: ['receptionDashboardStructure', 'receptionPatientSearch', 'walkIn', 'patientBillingDetails'],
  doctor: ['doctorDashboardStructure', 'doctorPrescription', 'clinicalDataUnavailable', 'clinicalReadViews.runtime', 'visitSummary'],
  lab: ['laboratoryDashboardStructure', 'laboratoryStates.runtime', 'labResultConcurrency'],
  pharmacy: ['pharmacyManagement', 'pharmacyRefresh.runtime'],
  patient: ['patientPortalInteractions', 'patientDarkTheme', 'patientDoctorsLocalization', 'patientRecord', 'patientBookingStatus']
};
const selected = process.argv.slice(2);
if (!selected.length || selected.some(group => !groups[group])) throw Error(`Select small batches: ${Object.keys(groups).join(', ')}`);
const output = path.resolve(process.env.CLINIC_TEST_OUTPUT || '../qa-evidence/ui-audit-resume/tests');
fs.mkdirSync(output, { recursive: true });
const report = { files: [], passed: 0, failed: 0, skipped: 0 };
for (const group of selected) for (const name of groups[group]) {
  const file = `test/${name}.test.js`;
  const run = spawnSync(process.execPath, ['--max-old-space-size=512', file], { encoding: 'utf8', timeout: 120000, maxBuffer: 3 * 1024 * 1024 });
  const log = (run.stdout || '') + (run.stderr || '');
  fs.writeFileSync(path.join(output, `${name}.log`), log);
  const count = key => Number([...log.matchAll(new RegExp(`^# ${key} (\\d+)$`, 'gm'))].at(-1)?.[1] || 0);
  const passed = count('pass'), failed = count('fail'), skipped = count('skipped');
  const ok = run.status === 0 && !run.error && passed > 0 && failed === 0 && !/^not ok /m.test(log);
  report.files.push({ group, file, passed, failed, skipped, ok, exitCode: run.status, error: run.error?.message });
  report.passed += passed; report.failed += failed; report.skipped += skipped;
  console.log(`${group}: ${name}: ${passed} passed, ${failed} failed${ok ? '' : ' CHECK LOG'}`);
}
fs.writeFileSync(path.join(output, `report-${selected.join('-')}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: report.passed, failed: report.failed, skipped: report.skipped, files: report.files.length, incomplete: report.files.filter(file => !file.ok).map(file => file.file) }));
process.exitCode = report.files.every(file => file.ok) ? 0 : 1;
