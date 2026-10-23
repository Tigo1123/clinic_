// Each request is bounded. Later pages are fetched only at the user's request.
export function createPagedList(path, request, pageSize = 50, reconcile = (_previous, next) => next) {
  let state = { data: [], page: 0, hasMore: false, loading: false, error: '' };
  let generation = 0;
  const listeners = new Set();
  const publish = (patch) => { state = { ...state, ...patch }; listeners.forEach((fn) => fn()); };
  async function read(page) {
    const response = await request(`${path}${path.includes('?') ? '&' : '?'}page=${page}&pageSize=${pageSize}`);
    const data = await response.json();
    if (!response.ok || !Array.isArray(data)) throw new Error('Unable to load this list. Retry.');
    return { data, hasMore: response.headers.get('X-Has-More') === 'true' };
  }
  async function load(append) {
    if (!path || (append && (state.loading || !state.hasMore))) return state.data;
    const token = ++generation;
    const lastPage = append ? state.page + 1 : Math.max(1, state.page);
    publish({ loading: true, error: '' });
    try {
      let data = append ? state.data : [];
      let result;
      let page = append ? lastPage : 1;
      for (; page <= lastPage; page++) {
        result = await read(page);
        if (token !== generation) return [];
        data = [...data, ...result.data];
        if (!result.hasMore) break;
      }
      // Offset pages can shift as queues change; never display duplicate rows.
      data = [...new Map(data.map((row) => [row.id, row])).values()];
      publish({ data: reconcile(state.data, data), page: Math.min(page, lastPage), hasMore: result.hasMore, loading: false });
      return data;
    } catch {
      if (token === generation) publish({ loading: false, error: 'Unable to load this list. Retry.' });
      return state.data;
    }
  }
  return {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    getSnapshot: () => state,
    reload: () => load(false), loadMore: () => load(true),
    cancel() { generation++; },
    setData(update) { publish({ data: typeof update === 'function' ? update(state.data) : update }); }
  };
}
