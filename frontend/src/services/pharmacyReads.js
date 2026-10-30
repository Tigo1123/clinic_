// Pharmacy reads keep transport errors, invalid payloads and cancellation distinct
// from a successfully empty queue. No error text from the server is rendered.
export class PharmacyReadError extends Error {
  constructor(status = 0, code = 'REQUEST_FAILED') { super(code); this.status = status; this.code = code; }
}
export function pharmacyReadErrorMessage(error, lang) {
  const ar = lang === 'ar';
  if (error?.code === 'CANCELLED') return ar ? 'تم إلغاء التحميل. أعد المحاولة.' : 'Loading cancelled. Please retry.';
  if (error?.code === 'MALFORMED_PAYLOAD') return ar ? 'تلقى النظام بيانات غير صالحة. أعد المحاولة.' : 'The server returned invalid data. Please retry.';
  if (error?.status === 401) return ar ? 'انتهت الجلسة. سجل الدخول مجدداً.' : 'Your session has expired. Please sign in again.';
  if (error?.status === 403) return ar ? 'ليس لديك صلاحية لعرض هذه البيانات.' : 'You do not have permission to view this data.';
  if (error?.status === 404) return ar ? 'تعذر العثور على البيانات المطلوبة.' : 'The requested data was not found.';
  if (error?.status === 409) return ar ? 'تغيرت البيانات. أعد التحميل للمحاولة مجدداً.' : 'The data has changed. Reload and try again.';
  return ar ? 'تعذر تحميل البيانات. تحقق من الاتصال وأعد المحاولة.' : 'Unable to load data. Check your connection and retry.';
}
const invalid = () => { throw new PharmacyReadError(200, 'MALFORMED_PAYLOAD'); };
const row = value => value && typeof value === 'object' && !Array.isArray(value) && (typeof value.id === 'string' || typeof value.id === 'number');
export function validatePharmacyPayload(value, kind) {
  if (kind === 'formulary' || kind === 'page') {
    if (!value || !Array.isArray(value.items) || !value.items.every(row)
      || !Number.isInteger(value.pagination?.page) || value.pagination.page < 1
      || !Number.isInteger(value.pagination?.totalPages) || value.pagination.totalPages < 0) invalid();
  } else if (kind === 'payment') {
    if (!value || typeof value.dispensingAllowed !== 'boolean' || !Array.isArray(value.allowedPaymentMethods)
      || (value.invoice && (!row(value.invoice) || !['totalAmountSdg', 'paidAmountSdg', 'outstandingAmountSdg'].every(key => Number.isFinite(value.invoice[key]))))) invalid();
  } else if (kind === 'medicine') { if (!row(value)) invalid(); }
  else {
    if (!Array.isArray(value) || !value.every(row)) invalid();
    if (kind === 'prescriptions' && !value.every(rx => rx.patient && rx.doctor && Array.isArray(rx.prescribedDrugs) && rx.prescribedDrugs.every(row))) invalid();
  }
  return value;
}
export async function readPharmacyJson(request, path, kind, signal) {
  // Race cancellation across fetch AND body consumption (including apiClient's
  // 401 clone read). Stale transports may finish later but cannot publish state.
  let abort;
  const cancelled = new Promise((_, reject) => {
    abort = () => reject(new PharmacyReadError(0, 'CANCELLED'));
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([cancelled, (async () => {
      const response = await request(path, { signal });
      if (!response.ok) throw new PharmacyReadError(response.status);
      let payload;
      try { payload = await response.json(); } catch { invalid(); }
      return { data: validatePharmacyPayload(payload, kind), hasMore: response.headers?.get('X-Has-More') === 'true' };
    })()]);
  } finally { signal?.removeEventListener('abort', abort); }
}

export function createPharmacyRead(loader, { paged = false, initialData = [] } = {}) {
  let state = { data: initialData, loading: false, error: null, status: 'idle', page: 0, hasMore: false };
  let generation = 0, controller;
  const listeners = new Set();
  const publish = patch => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
  const dispose = () => { generation++; controller?.abort(); };
  async function load(append = false) {
    if (append && (state.loading || !state.hasMore)) return state.data;
    dispose(); const token = generation;
    controller = new AbortController(); const signal = controller.signal;
    publish({ loading: true, status: 'pending', error: null });
    try {
      const last = append ? state.page + 1 : Math.max(1, state.page);
      let data = append ? state.data : [], result;
      let page = append ? last : 1;
      for (; page <= last; page++) {
        result = await loader(signal, page);
        if (token !== generation) return state.data;
        data = paged ? [...data, ...result.data] : result.data;
        if (!paged || !result.hasMore) break;
      }
      if (paged) data = [...new Map(data.map(item => [item.id, item])).values()];
      publish({ data, status: 'success', error: null, page: Math.min(page, last), hasMore: result.hasMore || false });
      return data;
    } catch (error) {
      if (token === generation) publish({ error, status: !error.status || error.status >= 500 || error.status === 409 || error.status === 429 || error.code === 'MALFORMED_PAYLOAD' ? 'retryable-error' : 'error' });
      return state.data;
    } finally { if (token === generation) publish({ loading: false }); }
  }
  return {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }, getSnapshot: () => state,
    reload: () => load(), loadMore: () => load(true), dispose,
    cancel() { dispose(); publish({ loading: false, status: 'retryable-error', error: new PharmacyReadError(0, 'CANCELLED') }); },
    setData(update) { publish({ data: typeof update === 'function' ? update(state.data) : update }); }
  };
}
