import { useSyncExternalStore } from 'react';
import { pwaInstall } from './pwaInstallStore.js';

export function usePwaInstall() {
  const state = useSyncExternalStore(pwaInstall.subscribe, pwaInstall.getSnapshot, pwaInstall.getServerSnapshot);
  return { ...state, install: pwaInstall.install };
}
