import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectScheduleVersion } from '../src/features/admin/scheduleVersion.js';

const panel = readFileSync(new URL('../src/features/admin/AdminSchedulePanel.jsx', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../src/features/admin/AdminDashboard.jsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/features/admin/adminSchedule.css', import.meta.url), 'utf8');
const translations = readFileSync(new URL('../src/i18n.js', import.meta.url), 'utf8');

test('admin scheduling is mounted behind the existing ADMIN dashboard and uses admin APIs', () => {
  assert.match(dashboard, /activeTab === 'scheduling'/);
  assert.match(dashboard, /user\?\.role === 'ADMIN'/);
  assert.match(dashboard, /<AdminSchedulePanel lang=\{lang\} t=\{t\} \/>/);
  assert.match(panel, /\/api\/appointments\/doctors/);
  assert.match(panel, /\/api\/admin\/doctors\/\$\{id\}\/schedules/);
  assert.match(panel, /schedule-exceptions/);
});

test('schedule versions prefer the current effective range, then the nearest future version', () => {
  const versions = [
    { id: 'history', effectiveFrom: '2025-01-01', effectiveTo: '2025-12-31', active: true },
    { id: 'current', effectiveFrom: '2026-01-01', effectiveTo: null, active: true },
    { id: 'future', effectiveFrom: '2027-01-01', effectiveTo: null, active: true }
  ];
  assert.equal(selectScheduleVersion(versions, '2026-06-01').schedule.id, 'current');
  assert.equal(selectScheduleVersion(versions, '2024-06-01').schedule.id, 'history');
  assert.equal(selectScheduleVersion([{ ...versions[2] }], '2026-06-01').schedule.id, 'future');
  assert.match(panel, /scheduleKind === 'future'/);
});

test('schedule editing submits complete backend-compatible payloads and prevents duplicate saves', () => {
  assert.match(panel, /effectiveFrom/);
  assert.match(panel, /slotDurationMinutes/);
  assert.match(panel, /breaks/);
  assert.match(panel, /disabled=\{saving \|\| !doctorId\}/);
  assert.match(panel, /method: currentIsEffective \|\| !schedule\?\.id \? 'POST' : 'PUT'/);
  assert.match(panel, /method: 'PUT'/);
  assert.match(panel, /method: 'PATCH'/);
});

test('schedule management has centralized bilingual labels and responsive presentation', () => {
  for (const key of ['scheduleTitle', 'saveSchedule', 'unavailableDates', 'markUnavailable']) {
    assert.match(panel, new RegExp(`label\\('${key}'`));
    assert.match(translations, new RegExp(`${key}:`));
  }
  assert.match(panel, /weekday\$\{period\.dayOfWeek\}/);
  assert.match(translations, /weekdayMONDAY:/);
  assert.match(panel, /scheduleTomorrowNotice/);
  assert.match(translations, /scheduleTomorrowNotice:'سيبدأ تطبيق تغييرات الجدول الحالي من الغد\.'/);
  assert.match(translations, /scheduleTomorrowNotice:'Changes to the current schedule will take effect from tomorrow\.'/);
  assert.match(styles, /@media \(max-width: 700px\)/);
  assert.match(panel, /role="alert"/);
  assert.match(panel, /role="status"/);
});
