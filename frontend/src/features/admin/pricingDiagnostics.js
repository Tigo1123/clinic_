// Temporary, opt-in diagnostics. No persistence, network telemetry, headers,
// names, credentials or arbitrary response/error text enter this buffer.
const hubs = new WeakMap();
const kinds = ['doctors', 'services', 'medicines'];
const priceFields = { doctors: 'consultationFee', services: 'baseFeeSdg', medicines: 'unitPriceSdg' };
const errors = new Set(['PRICING_CATALOGUE_FAILED', 'DOCTOR_PRICE_UPDATE_FAILED', 'SERVICE_PRICE_UPDATE_FAILED', 'MEDICINE_PRICE_UPDATE_FAILED', 'INVALID_TOKEN', 'SESSION_REVOKED', 'FORBIDDEN', 'VALIDATION_ERROR', 'DOCTOR_NOT_FOUND', 'SERVICE_NOT_FOUND', 'MEDICINE_NOT_FOUND']);
const safeId = value => typeof value === 'string' && /^[\w-]{1,100}$/.test(value) ? value : null;
const safePrice = value => typeof value === 'number' ? (Number.isFinite(value) ? value : null) : typeof value === 'string' && /^[\d.eE+-]{0,32}$/.test(value) ? value : null;
const safeStatus = value => ['ACTIVE', 'INACTIVE'].includes(value) ? value : null;
const safeDraft = value => ({ priceSdg: safePrice(value?.priceSdg), status: safeStatus(value?.status) });
const rowSummary = (kind, row) => ({ id: safeId(row?.id), priceSdg: safePrice(row?.[priceFields[kind]]), status: safeStatus(row?.status) });
const noop = () => {};
const disabled = Object.freeze({ enabled: false, mount: noop, unmount: noop, onIdle: noop, click: noop, event: noop, startSave: noop, endSave: noop, saved: noop, requestStart: noop, requestEnd: noop, ui: noop, headers: () => ({}) });

export function createPricingDiagnostics(options = {}) {
  const host = options.host || (typeof window !== 'undefined' ? window : null);
  const allowed = options.allowed ?? (import.meta.env?.DEV === true || import.meta.env?.MODE === 'staging');
  try { if (!allowed || host?.sessionStorage.getItem('shifa_pricing_diagnostics') !== '1') return disabled; }
  catch { return disabled; }
  if (!host) return disabled;
  let hub = hubs.get(host);
  if (!hub) {
    hub = { events: [], sequence: 0 };
    hubs.set(host, hub);
    host.__SHIFA_PRICING_DIAGNOSTICS__ = Object.freeze({
      version: 1,
      getEvents: () => JSON.parse(JSON.stringify(hub.events)),
      clear: () => { hub.events.length = 0; }
    });
  }
  const id = prefix => `pricing-${prefix}-${globalThis.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, token => {
    const value = Math.floor(Math.random() * 16);
    return (token === 'x' ? value : (value & 3) | 8).toString(16);
  })}`;
  const instanceId = id('instance');
  const requests = new Map(), saves = new Set(), tracked = new Map(), successful = new Map();
  let mounted = false, idleCallback = noop, idleTimer;
  const record = (type, fields = {}) => {
    const event = { sequence: ++hub.sequence, timestamp: new Date().toISOString(), instanceId, type, ...fields };
    hub.events.push(event);
    if (hub.events.length > 500) hub.events.shift();
    return event.sequence;
  };
  const notifyIdle = () => {
    host.clearTimeout(idleTimer);
    if (!mounted || requests.size || saves.size) return;
    idleTimer = host.setTimeout(() => { if (mounted && !requests.size && !saves.size) idleCallback(); }, 0);
  };
  const responseSummary = data => ({
    errorCode: data?.error?.code || data?.code ? (errors.has(data?.error?.code || data?.code) ? data.error?.code || data.code : 'OTHER') : null,
    counts: Object.fromEntries(kinds.map(kind => [kind, Array.isArray(data?.[kind]) ? data[kind].length : null])),
    rows: [...tracked.values()].map(({ kind, entityId }) => ({ kind, ...rowSummary(kind, Array.isArray(data?.[kind]) ? data[kind].find(row => row.id === entityId) : data?.id === entityId ? data : null) }))
  });
  return {
    enabled: true,
    mount() { mounted = true; record('instance.mount'); },
    unmount() { mounted = false; host.clearTimeout(idleTimer); record('instance.unmount', { requestsPending: requests.size, savesPending: saves.size }); },
    onIdle(callback) { idleCallback = callback; },
    headers(requestId) { return requestId ? { 'X-Request-ID': requestId } : {}; },
    event(type, fields) {
      if (!['refresh.requested', 'read.invalidated', 'read.abortRequested', 'save.blocked'].includes(type)) return;
      const safe = {};
      if (Number.isSafeInteger(fields?.version)) safe.version = fields.version;
      if (typeof fields?.deferred === 'boolean') safe.deferred = fields.deferred;
      if (/^pricing-save-[\da-f-]{36}$/.test(fields?.actionId || '')) safe.actionId = fields.actionId;
      if (['duplicate', 'validation', 'cancelled'].includes(fields?.reason)) safe.reason = fields.reason;
      record(type, safe);
    },
    click(kind, item, draft) {
      const actionId = id('save'), entityId = safeId(item?.id);
      const key = `${kind}:${entityId}`;
      if (kinds.includes(kind) && entityId) {
        if (!tracked.has(key) && tracked.size >= 50) tracked.delete(tracked.keys().next().value);
        tracked.set(key, { kind, entityId });
      }
      record('save.click', { actionId, kind: kinds.includes(kind) ? kind : null, entityId, category: ['LABORATORY', 'CONSULTATION', 'CLINICAL_PROCEDURE', 'RADIOLOGY'].includes(item?.category) ? item.category : null, draft: safeDraft(draft), current: rowSummary(kind, item) });
      notifyIdle();
      return actionId;
    },
    startSave(actionId, payload) { saves.add(actionId); record('save.start', { actionId, payload: safeDraft(payload), readsInFlight: [...requests.values()].filter(r => r.method === 'GET').map(r => r.requestId) }); },
    endSave(actionId, outcome) { saves.delete(actionId); record('save.end', { actionId, outcome: ['success', 'failure'].includes(outcome) ? outcome : null }); notifyIdle(); },
    saved(actionId, kind, updated) {
      const summary = rowSummary(kind, updated);
      const sequence = record('save.applied', { actionId, kind, response: summary });
      successful.set(`${kind}:${summary.id}`, { sequence, ...summary });
      if (successful.size > 50) successful.delete(successful.keys().next().value);
    },
    requestStart(method, { actionId, version, reason } = {}) {
      if (!['GET', 'PATCH'].includes(method)) return;
      const requestId = id(method.toLowerCase());
      const startedAt = Date.now();
      const sequence = record('request.start', { requestId, method, actionId, version, reason: reason === 'pricing-effect' ? reason : null, refreshStartedBeforeSaveCompleted: method === 'GET' && saves.size > 0, pendingSaveActions: [...saves] });
      requests.set(requestId, { requestId, method, actionId, sequence, startedAt });
      return requestId;
    },
    requestEnd(requestId, { status, data, applied = false, aborted = false, errorName, version } = {}) {
      const request = requests.get(requestId);
      if (!request) return;
      const oldSaves = request.method === 'GET' ? [...successful.entries()].filter(([, saved]) => saved.sequence > request.sequence) : [];
      const wouldOverwriteSavedRows = (data ? oldSaves : []).filter(([key, saved]) => {
        const kind = key.split(':')[0];
        const incoming = data?.[kind]?.find?.(row => row.id === saved.id);
        return !incoming || Number(incoming[priceFields[kind]]) !== Number(saved.priceSdg) || incoming.status !== saved.status;
      }).map(([key]) => key);
      record('request.end', {
        requestId, method: request.method, actionId: request.actionId, version, status: Number.isInteger(status) ? status : null,
        durationMs: Date.now() - request.startedAt, response: responseSummary(data), applied, aborted,
        errorName: ['Error', 'TypeError', 'SyntaxError', 'AbortError'].includes(errorName) ? errorName : null,
        olderGetCompletedAfterSave: oldSaves.length > 0, wouldOverwriteSavedRows,
        overwroteNewerState: applied && wouldOverwriteSavedRows.length > 0
      });
      requests.delete(requestId);
      notifyIdle();
    },
    ui({ pricing, drafts, saving, loading, activeTab }, root) {
      if (!mounted || !tracked.size) return;
      const nodes = [...(root?.querySelectorAll('tr[data-pricing-kind]') || [])];
      const rows = [...tracked.entries()].map(([key, { kind, entityId }]) => {
        const row = pricing?.[kind]?.find(entry => entry.id === entityId);
        const node = nodes.find(node => node.dataset.pricingKind === kind && node.dataset.pricingId === entityId);
        return { kind, entityId, current: rowSummary(kind, row), draft: drafts[key] ? safeDraft(drafts[key]) : null, saving: !!saving[key], rendered: node ? { priceSdg: safePrice(node.querySelector('input')?.value), status: safeStatus(node.querySelector('select')?.value), saveDisabled: !!node.querySelector('button')?.disabled } : null };
      });
      const settled = !requests.size && !saves.size && !loading && !rows.some(row => row.saving);
      record(settled ? 'ui.settled' : 'ui.render', { activeTab, loading, requestsPending: requests.size, savesPending: saves.size, rows });
    }
  };
}
