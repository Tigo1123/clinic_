export const emptyNotificationFeed = { notifications: [], unreadCount: 0, nextCursor: null, asOf: null, loading: true, pending: false, error: false };

// Serialize refreshes, coalesce bursts, and discard any read started before a
// later event or mutation. Counts always come from the authenticated API.
export function createNotificationFeed(request, onChange) {
  let state = { ...emptyNotificationFeed };
  let generation = 0; let dirty = false; let running = null; let disposed = false;
  let controller;
  const publish = changes => { if (!disposed) { state = { ...state, ...changes }; onChange(state); } };
  const refresh = () => {
    if (disposed) return Promise.resolve();
    generation += 1; dirty = true;
    if (!running) running = Promise.resolve().then(async () => {
      while (dirty && !disposed) {
        dirty = false;
        const version = generation;
        controller = new AbortController();
        publish({ loading: true });
        try {
          const data = await request('/api/notifications', { cache: 'no-store', signal: controller.signal });
          if (version === generation) publish({ ...data, error: false });
        } catch (error) {
          if (version === generation && error.name !== 'AbortError') publish({ error: true });
        } finally { if (version === generation) publish({ loading: false }); }
      }
    }).finally(() => { running = null; });
    return running;
  };
  return {
    refresh,
    async loadMore() {
      if (state.loading || state.pending || !state.nextCursor || disposed) return;
      const version = generation;
      publish({ loading: true });
      try {
        const data = await request(`/api/notifications?cursor=${encodeURIComponent(state.nextCursor)}`, { cache: 'no-store' });
        if (version !== generation) return;
        const items = new Map(state.notifications.map(item => [item.id, item]));
        data.notifications.forEach(item => items.set(item.id, item));
        publish({ notifications: [...items.values()], unreadCount: data.unreadCount, nextCursor: data.nextCursor, error: false });
      } catch { if (version === generation) publish({ error: true }); }
      finally { if (version === generation) publish({ loading: false }); }
    },
    async markRead(id) {
      if (state.pending || disposed) return;
      generation += 1;
      publish({ pending: true });
      try {
        await request(id ? `/api/notifications/${id}/read` : '/api/notifications/read-all', {
          method: 'PATCH', ...(id ? {} : { body: JSON.stringify({ ...(state.asOf ? { before: state.asOf } : {}) }) })
        });
        await refresh();
      } catch { publish({ error: true }); }
      finally { publish({ pending: false, loading: false }); }
    },
    dispose() { disposed = true; generation += 1; controller?.abort(); }
  };
}
