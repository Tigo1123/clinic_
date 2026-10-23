import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { fetchWithAuth } from '../services/staffApi';
import { createPagedList } from '../services/pagedList.js';

export function useStaffPagedList(path, reconcile) {
  const list = useMemo(() => createPagedList(path, fetchWithAuth, 50, reconcile), [path, reconcile]);
  const state = useSyncExternalStore(list.subscribe, list.getSnapshot);
  useEffect(() => { list.reload(); return () => list.cancel(); }, [list]);
  return { ...state, reload: list.reload, loadMore: list.loadMore, setData: list.setData };
}
