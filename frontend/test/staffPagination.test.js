import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPagedList } from '../src/services/pagedList.js';

const rows = Array.from({ length: 105 }, (_, i) => ({ id: `record-${i + 1}` }));
const cases = [
  ['reception/ReceptionDashboard.jsx', '/api/appointments/pending', 'pendingList'],
  ['reception/ReceptionDashboard.jsx', '/api/appointments/queue/doctor?date=2099-01-01', 'doctorQueueList'],
  ['reception/ReceptionDashboard.jsx', '/api/billing/lab-orders/pending', 'labBillingList'],
  ['doctor/DoctorDashboard.jsx', '/api/appointments/queue/doctor?date=2099-01-01', 'queueList'],
  ['laboratory/LaboratoryDashboard.jsx', '/api/records/lab-orders/pending', 'orderList'],
  ['pharmacy/PharmacyDashboard.jsx', '/api/records/prescriptions/pending', 'prescriptionList'],
  ['pharmacy/PharmacyDashboard.jsx', '/api/records/medication-reviews/pending', 'reviewList'],
  ['admin/AdminDashboard.jsx', '/api/auth/users', 'userList'],
  ['admin/AdminSchedulePanel.jsx', '/api/admin/doctors', 'doctorList']
];
for (const [screen, path, binding] of cases) test(`${screen}: records 51 and 101 are reachable with bounded requests`, async () => {
  const source = await readFile(new URL(`../src/features/${screen}`, import.meta.url), 'utf8');
  assert.match(source, new RegExp(`const ${binding} = useStaffPagedList`));
  assert.ok(source.includes(`<StaffListPaging list={${binding}}`) || source.includes(': doctorQueueList}'));
  const requested = [];
  const list = createPagedList(path, async (url) => {
    const query = new URL(url, 'https://example.invalid').searchParams;
    const page = Number(query.get('page')), size = Number(query.get('pageSize'));
    requested.push({ page, size });
    return { ok: true, json: async () => rows.slice((page - 1) * size, page * size), headers: { get: () => page * size < rows.length ? 'true' : 'false' } };
  });
  await list.reload(); assert.equal(list.getSnapshot().data.length, 50);
  await list.loadMore(); assert.equal(list.getSnapshot().data[50].id, 'record-51');
  await list.loadMore(); assert.equal(list.getSnapshot().data[100].id, 'record-101');
  assert.equal(list.getSnapshot().hasMore, false);
  await list.reload(); assert.equal(list.getSnapshot().data.length, 105, 'refresh retains access to all loaded pages');
  assert.deepEqual(requested.map((r) => r.page), [1, 2, 3, 1, 2, 3]);
  assert.ok(requested.every((r) => r.size === 50));
});

test('paging preserves loaded records on failure, allows retry, and ignores stale requests', async () => {
  let fail = false, resolveStale;
  const list = createPagedList('/queue', async (url) => {
    if (fail) throw new Error('offline');
    const page = Number(new URL(url, 'https://example.invalid').searchParams.get('page'));
    return { ok: true, json: async () => rows.slice((page - 1) * 50, page * 50), headers: { get: () => page < 3 ? 'true' : 'false' } };
  });
  await list.reload(); fail = true; await list.loadMore();
  assert.equal(list.getSnapshot().data.length, 50); assert.ok(list.getSnapshot().error);
  fail = false; await list.loadMore(); assert.equal(list.getSnapshot().data.length, 100);
  const stale = createPagedList('/queue', () => new Promise((resolve) => { resolveStale = resolve; }));
  const pending = stale.reload(); stale.cancel();
  resolveStale({ ok: true, json: async () => rows, headers: { get: () => 'false' } });
  await pending; assert.equal(stale.getSnapshot().data.length, 0);
});

test('an overlapping refresh cannot overwrite newer mutation-confirmed lab versions', async () => {
  const { mergeLabOrdersMonotonically } = await import('../src/utils/labOrderVersions.js');
  const list = createPagedList('/labs', async () => ({ ok: true, json: async () => [{ id: 'lab', items: [{ id: 'result', resultVersion: 1 }] }], headers: { get: () => 'false' } }), 50, mergeLabOrdersMonotonically);
  list.setData([{ id: 'lab', items: [{ id: 'result', resultVersion: 2 }] }]);
  await list.reload(); assert.equal(list.getSnapshot().data[0].items[0].resultVersion, 2);
});
