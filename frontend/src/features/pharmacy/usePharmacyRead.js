import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { fetchWithAuth } from '../../services/staffApi';
import { createPharmacyRead, readPharmacyJson } from '../../services/pharmacyReads.js';

export function usePharmacyRead(path, kind, paged = false) {
  const resource = useMemo(() => createPharmacyRead(async (signal, page) => {
    if (kind !== 'alerts') return readPharmacyJson(fetchWithAuth, paged ? `${path}?page=${page}&pageSize=50` : path, kind, signal);
    const first = await readPharmacyJson(fetchWithAuth, `${path}?page=1&pageSize=100`, 'formulary', signal);
    const items = [...first.data.items];
    for (let index = 2; index <= first.data.pagination.totalPages; index++) {
      const next = await readPharmacyJson(fetchWithAuth, `${path}?page=${index}&pageSize=100`, 'formulary', signal);
      items.push(...next.data.items);
    }
    return { data: items };
  }, { paged, initialData: kind === 'alerts' ? null : [] }), [path, kind, paged]);
  const state = useSyncExternalStore(resource.subscribe, resource.getSnapshot);
  useEffect(() => { resource.reload(); return () => resource.dispose(); }, [resource]);
  return { ...state, reload: resource.reload, loadMore: resource.loadMore, cancel: resource.cancel, setData: resource.setData };
}
