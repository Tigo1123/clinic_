import { Injectable } from '@nestjs/common';
import { validateEnvironment, rateLimits } from '../../config.js';

export interface EnvironmentConfig {
  production: boolean;
  allowedOrigins: string[];
  googleClientId: string | null;
  clinicTimeZone: string;
  facilityBranding: {
    productNameAr: string;
    productNameEn: string;
    productDescriptorAr: string;
    productDescriptorEn: string;
    facilityNameAr: string;
    facilityNameEn: string;
    displayNameAr: string;
    displayNameEn: string;
  };
  socketRevocation: {
    databaseUrl: string;
    reconcileMs: number;
    unhealthyGraceMs: number;
  };
}

@Injectable()
export class AppConfigService {
  private readonly env: EnvironmentConfig;

  constructor() {
    this.env = validateEnvironment();
  }

  get isProduction(): boolean {
    return this.env.production;
  }

  get allowedOrigins(): string[] {
    return this.env.allowedOrigins;
  }

  get clinicTimeZone(): string {
    return this.env.clinicTimeZone;
  }

  get facilityBranding() {
    return this.env.facilityBranding;
  }

  get googleClientId(): string | null {
    return this.env.googleClientId;
  }

  get socketRevocation() {
    return this.env.socketRevocation;
  }

  get port(): number {
    return Number(process.env.PORT || 5000);
  }

  get jwtSecret(): string {
    return process.env.JWT_SECRET || '';
  }

  get medicalEncryptionKey(): string {
    return process.env.MEDICAL_ENCRYPTION_KEY || '';
  }

  get mfaEncryptionKey(): string {
    return process.env.MFA_ENCRYPTION_KEY || '';
  }

  get rateLimits() {
    return rateLimits;
  }

  get raw(): EnvironmentConfig {
    return this.env;
  }
}
