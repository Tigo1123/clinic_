export interface FacilityBranding {
  productNameAr: string;
  productNameEn: string;
  productDescriptorAr: string;
  productDescriptorEn: string;
  facilityNameAr: string;
  facilityNameEn: string;
  displayNameAr: string;
  displayNameEn: string;
}

export interface SocketRevocationConfig {
  databaseUrl: string;
  reconcileMs: number;
  unhealthyGraceMs: number;
}

export interface EnvironmentConfig {
  production: boolean;
  allowedOrigins: string[];
  googleClientId: string | null;
  clinicTimeZone: string;
  facilityBranding: FacilityBranding;
  socketRevocation: SocketRevocationConfig;
}

export interface RateLimits {
  windowMs: number;
  login: number;
  registration: number;
  verification: number;
  claim: number;
  adminReset: number;
}

export function configuredGoogleClientId(env?: NodeJS.ProcessEnv): string | null;
export function canonicalProductionOrigin(origin: string): string | null;
export function isCanonicalProductionOrigin(origin: string): boolean;
export function validateEnvironment(): EnvironmentConfig;
export const rateLimits: RateLimits;
