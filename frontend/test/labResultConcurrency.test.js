import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLatestRequestGate, mergeLabOrdersMonotonically } from '../src/utils/labOrderVersions.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const laboratory = readFileSync(path.join(root, 'src/features/laboratory/LaboratoryDashboard.jsx'), 'utf8');

test('laboratory result save carries and adopts the authoritative result version', () => {
  assert.match(laboratory, /expectedVersion:\s*item\.resultVersion/);
  assert.match(laboratory, /\{\s*\.\.\.currentItem,\s*\.\.\.savedItem\s*\}/);
  assert.match(laboratory, /const selectedOrder = \[\.\.\.orders, \.\.\.historyOrders\]\.find/);
  assert.doesNotMatch(laboratory, /setSelectedOrder\(/);
});

test('laboratory conflicts preserve the local form, refetch, and never auto-retry', () => {
  const conflictBlock = laboratory.slice(
    laboratory.indexOf("errorCode === 'LAB_RESULT_CONFLICT'"),
    laboratory.indexOf("errorCode === 'LAB_RESULT_FINALIZED'")
  );
  assert.match(conflictBlock, /Another user changed this result/);
  assert.match(conflictBlock, /fetchPendingLabOrders/);
  assert.doesNotMatch(conflictBlock, /handleSubmitResult|fetchWithAuth/);
  assert.match(laboratory, /const hasUnsavedForm = Object\.hasOwn\(resultForms, item\.id\)/);
  assert.match(laboratory, /isCompleted && \(!hasUnsavedForm \|\| selectedOrder\.status !== 'SAMPLE_COLLECTED'\)/);
  assert.match(laboratory, /Unsaved entry for review:/);
});

test('finalized result UX refreshes authoritative state without retrying the mutation', () => {
  const finalizedStart = laboratory.indexOf("errorCode === 'LAB_RESULT_FINALIZED'");
  const finalizedBlock = laboratory.slice(
    finalizedStart,
    laboratory.indexOf('apiErrorMessage(', finalizedStart)
  );
  assert.match(finalizedBlock, /no longer editable/);
  assert.match(finalizedBlock, /fetchPendingLabOrders/);
  assert.doesNotMatch(finalizedBlock, /handleSubmitResult|fetchWithAuth/);
});

const orderWithVersions = (...versions) => [{
  id: 'order-1',
  status: 'SAMPLE_COLLECTED',
  items: versions.map((resultVersion, index) => ({ id: `item-${index + 1}`, resultVersion, resultValue: `v${resultVersion}` }))
}];

test('held stale queue response cannot downgrade a mutation-confirmed result version', async () => {
  const gate = createLatestRequestGate();
  let state = orderWithVersions(4);
  let releaseOldResponse;
  const oldResponse = new Promise((resolve) => { releaseOldResponse = resolve; });
  const oldGeneration = gate.begin();
  const applyingOldResponse = oldResponse.then((incoming) => {
    if (gate.isCurrent(oldGeneration)) state = mergeLabOrdersMonotonically(state, incoming);
  });

  state = mergeLabOrdersMonotonically(state, orderWithVersions(5));
  assert.equal(state[0].items[0].resultVersion, 5);
  releaseOldResponse(orderWithVersions(4));
  await applyingOldResponse;

  assert.equal(state[0].items[0].resultVersion, 5);
  assert.equal(state[0].items[0].resultVersion, 5, 'the next save must send expectedVersion 5');
});

test('monotonic merge accepts equal and newer versions and compares each item independently', () => {
  const local = orderWithVersions(5, 2);
  const mixed = mergeLabOrdersMonotonically(local, orderWithVersions(4, 3));
  assert.deepEqual(mixed[0].items.map((item) => item.resultVersion), [5, 3]);

  const equal = mergeLabOrdersMonotonically(local, [{
    ...local[0],
    items: [{ id: 'item-1', resultVersion: 5, resultValue: 'equal-version-refresh' }, local[0].items[1]]
  }]);
  assert.equal(equal[0].items[0].resultValue, 'equal-version-refresh');

  const newer = mergeLabOrdersMonotonically(local, orderWithVersions(6, 2));
  assert.equal(newer[0].items[0].resultVersion, 6);
});

test('latest-request gate rejects an older overlapping response and invalidates on unmount', () => {
  const gate = createLatestRequestGate();
  const requestA = gate.begin();
  const requestB = gate.begin();
  assert.equal(gate.isCurrent(requestB), true);
  assert.equal(gate.isCurrent(requestA), false);
  gate.invalidate();
  assert.equal(gate.isCurrent(requestB), false);
});

test('StrictMode gate replacement rejects obsolete success and error from the old gate identity', async () => {
  let state = { status: 'INITIAL', error: null };
  const gateA = createLatestRequestGate();
  const generationA = gateA.begin();
  let resolveA;
  let rejectA;
  const obsoleteSuccess = new Promise((resolve) => { resolveA = resolve; }).then((value) => {
    if (gateA.isCurrent(generationA)) state = value;
  });
  const obsoleteError = new Promise((resolve, reject) => { rejectA = reject; }).catch((error) => {
    if (gateA.isCurrent(generationA)) state = { ...state, error: error.message };
  });

  gateA.invalidate();
  const gateB = createLatestRequestGate();
  const generationB = gateB.begin();
  assert.equal(generationA, generationB, 'the collision requires equal numeric generations on different gates');
  if (gateB.isCurrent(generationB)) state = { status: 'COMPLETED', resultVersion: 5, error: null };

  resolveA({ status: 'SAMPLE_COLLECTED', resultVersion: 4, error: null });
  rejectA(new Error('obsolete request failed'));
  await Promise.all([obsoleteSuccess, obsoleteError]);

  assert.deepEqual(state, { status: 'COMPLETED', resultVersion: 5, error: null });
  assert.equal(gateA.isCurrent(generationA), false);
  assert.equal(gateB.isCurrent(generationB), true);

  let reverseState = { status: 'INITIAL' };
  const gateC = createLatestRequestGate();
  const generationC = gateC.begin();
  gateC.invalidate();
  const gateD = createLatestRequestGate();
  const generationD = gateD.begin();
  if (gateC.isCurrent(generationC)) reverseState = { status: 'SAMPLE_COLLECTED', resultVersion: 4 };
  if (gateD.isCurrent(generationD)) reverseState = { status: 'COMPLETED', resultVersion: 5 };
  assert.deepEqual(reverseState, { status: 'COMPLETED', resultVersion: 5 });
});

test('laboratory paging uses the shared stale-response guard and monotonic reconciliation', () => {
  assert.match(laboratory, /useStaffPagedList\('\/api\/records\/lab-orders\/pending', mergeLabOrdersMonotonically\)/);
  assert.match(laboratory, /<StaffListPaging list=\{orderList\}/);
});
