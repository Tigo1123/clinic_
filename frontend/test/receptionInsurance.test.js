import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  Node: dom.window.Node,
  ShadowRoot: dom.window.ShadowRoot,
  HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element,
  DocumentFragment: dom.window.DocumentFragment,
  Event: dom.window.Event,
  getComputedStyle: dom.window.getComputedStyle,
  IS_REACT_ACT_ENVIRONMENT: true
});

const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');

// Load the dashboard through Vite so JSX and its transitive imports use the app's
// normal resolver. Replace only the API, socket and staff shell boundaries.
const mocks = new Map([
  ['services/staff/staffApi', `
    export { apiErrorMessage } from '/src/services/staff/staffApi.js';
    export const fetchWithAuth = (...args) => globalThis.receptionTestFetch(...args);
  `],
  ['services/apiClient', 'export const staffApiRequest = (...args) => globalThis.receptionTestApi(...args);'],
  ['services/staff/staffSocket', 'export const staffSocket = { on() {}, off() {} };'],
  ['staffShellContext', 'export const useStaffNav = (nav) => { globalThis.receptionTestNav = nav; };'],
]);
const vite = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  plugins: [{
    name: 'reception-test-boundaries',
    enforce: 'pre',
    resolveId(id) {
      const key = [...mocks.keys()].find((name) => id.endsWith('/' + name));
      if (key) return 'virtual:reception/' + key;
    },
    load(id) {
      if (id.startsWith('virtual:reception/')) return mocks.get(id.slice('virtual:reception/'.length));
    },
  }],
});
let ReceptionDashboard;
try {
  ({ default: ReceptionDashboard } = await vite.ssrLoadModule('/src/features/staff/reception/ReceptionDashboard.jsx'));
} finally {
  await vite.close();
}

let root;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  delete globalThis.receptionTestFetch;
  delete globalThis.receptionTestApi;
  delete globalThis.receptionTestNav;
});

function jsonReply(data, ok = true) {
  return Promise.resolve({ ok, json: async () => data });
}

async function mountDashboard(lang = 'en', { onInsuranceFetch } = {}) {
  globalThis.receptionTestApi = (url) => {
    if (url === '/api/billing/payment-methods') return Promise.resolve([{ code: 'CASH', labelAr: 'نقدي', labelEn: 'Cash' }]);
    return Promise.resolve([]);
  };
  globalThis.receptionTestFetch = (url, options) => {
    if (url === '/api/billing/insurance-companies') return onInsuranceFetch(url, options);
    return jsonReply([]);
  };
  root = createRoot(document.getElementById('root'));
  await act(async () => {
    root.render(createElement(ReceptionDashboard, { lang, t: (key) => key }));
  });
}

test('reception billing live-refreshes configured insurance providers on entry and clears stale deactivated selection', async () => {
  let phase = 1;
  let fetchCount = 0;
  await mountDashboard('en', {
    onInsuranceFetch: () => {
      fetchCount += 1;
      if (phase === 1) {
        return jsonReply([
          { id: 'ins-1', labelAr: 'شركة أولى', labelEn: 'Provider One', copayPercentage: '10', billingCycleDays: 30 }
        ]);
      }
      return jsonReply([
        { id: 'ins-2', labelAr: 'شركة ثانية', labelEn: 'Provider Two', copayPercentage: '25.5', billingCycleDays: 45 }
      ]);
    }
  });

  assert.equal(fetchCount, 1);

  // Enter billing tab for the first time
  await act(async () => globalThis.receptionTestNav.onSelect('billing'));
  assert.equal(fetchCount, 2);
  let select = [...document.querySelectorAll('select')].find((el) =>
    [...el.options].some((opt) => opt.textContent.includes('Provider One'))
  );
  assert.ok(select, 'Provider One should appear on entry to billing');
  assert.match(select.textContent, /Provider One \(10% Copay · 30d cycle\)/);

  // Select Provider One, leave billing, then admin deactivates Provider One and adds Provider Two
  await act(async () => {
    select.value = 'ins-1';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  assert.equal(select.value, 'ins-1');

  phase = 2;
  await act(async () => globalThis.receptionTestNav.onSelect('front-desk'));
  await act(async () => globalThis.receptionTestNav.onSelect('billing'));
  assert.equal(fetchCount, 3);

  select = [...document.querySelectorAll('select')].find((el) =>
    [...el.options].some((opt) => opt.textContent.includes('Provider Two'))
  );
  assert.ok(select, 'Live refresh on billing entry must show newly configured Provider Two');
  assert.match(select.textContent, /Provider Two \(25\.5% Copay · 45d cycle\)/);
  assert.equal(select.value, '', 'Stale deactivated provider selection must be cleared');
});

test('reception billing surfaces insurance load failures with retry and shows empty-state notice when none active', async () => {
  let mode = 'error';
  await mountDashboard('ar', {
    onInsuranceFetch: () => {
      if (mode === 'error') {
        return Promise.resolve({ ok: false, json: async () => ({ error: { message: 'Service unavailable' } }) });
      }
      return jsonReply([]);
    }
  });

  await act(async () => globalThis.receptionTestNav.onSelect('billing'));
  const alert = [...document.querySelectorAll('[role=alert]')].find((el) =>
    el.textContent.includes('تعذر تحميل شركات التأمين')
  );
  assert.ok(alert, 'Arabic insurance load error should be displayed');

  mode = 'empty';
  const retryButton = [...alert.querySelectorAll('button')].find((btn) => btn.textContent.trim() === 'إعادة المحاولة');
  assert.ok(retryButton, 'Retry button should be rendered');
  await act(async () => retryButton.click());

  assert.match(document.body.textContent, /لا توجد شركات تأمين مفعّلة حالياً/);
});
