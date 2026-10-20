import { createContext, useContext } from 'react';
import { DEFAULT_BRANDING } from './brandingConfig.js';

export const FacilityBrandingContext = createContext(DEFAULT_BRANDING);

export function useFacilityBranding() {
  return useContext(FacilityBrandingContext);
}
