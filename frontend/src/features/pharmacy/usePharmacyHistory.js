import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { fetchWithAuth } from '../../services/staffApi';
import { createPharmacyHistoryRead } from '../../services/pharmacyReads.js';

export function usePharmacyHistory(path, kind, enabled) {
  const resource = useMemo(() => createPharmacyHistoryRead(fetchWithAuth, path, kind), [path, kind]);
  const state = useSyncExternalStore(resource.subscribe, resource.getSnapshot);
  useEffect(() => {
    if (enabled && path) resource.reload();
    return () => resource.suspend();
  }, [resource, enabled, path]);
  const reload = useCallback(() => enabled && path ? resource.reload() : Promise.resolve(resource.getSnapshot().data), [resource, enabled, path]);
  const loadPage = useCallback(page => enabled && path ? resource.loadPage(page) : Promise.resolve(resource.getSnapshot().data), [resource, enabled, path]);
  return { ...state, reload, loadPage, cancel: resource.cancel };
}
