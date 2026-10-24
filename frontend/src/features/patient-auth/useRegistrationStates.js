import { useCallback, useEffect, useRef, useState } from 'react';
import { publicApiRequest } from '../../services/apiClient';
import { parseAddressStates } from './addressSelection.js';

export function useRegistrationStates() {
  const [reference, setReference] = useState({ states: [], loading: true, error: false, complete: false });
  const generation = useRef(0); const mounted = useRef(true);
  const refresh = useCallback(async () => {
    const ticket = ++generation.current;
    setReference(current => ({ ...current, loading: true, error: false }));
    try {
      const data = await publicApiRequest('/api/patient-auth/address-states');
      const states = parseAddressStates(data);
      if (!mounted.current || ticket !== generation.current) throw new Error('ADDRESS_SELECTION_STALE');
      setReference({ states, complete: data.complete === true, loading: false, error: false });
      return states;
    } catch (error) {
      if (mounted.current && ticket === generation.current) setReference(current => ({ ...current, loading: false, error: true }));
      throw error;
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    refresh().catch(() => {});
    return () => { mounted.current = false; };
  }, [refresh]);
  return { ...reference, refresh };
}
