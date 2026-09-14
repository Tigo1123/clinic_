export class DemoSeedPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DemoSeedPolicyError';
  }
}

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * The ordinary Prisma seed contains sample users and fixtures.  It is never a
 * production bootstrap mechanism: production reference data must be managed
 * through the application or an explicitly reviewed migration.
 */
export function assertDemoSeedAllowed(environment = process.env) {
  const nodeEnv = normalized(environment.NODE_ENV);
  const deploymentEnv = normalized(environment.DEPLOYMENT_ENV);
  const explicitlyAllowedStaging = deploymentEnv === 'staging'
    && environment.ALLOW_STAGING_SEED === 'true';
  const allowedDevelopment = nodeEnv === 'development'
    && (!deploymentEnv || deploymentEnv === 'development');
  const allowedTest = nodeEnv === 'test'
    && (!deploymentEnv || deploymentEnv === 'test');

  if (deploymentEnv === 'production') {
    throw new DemoSeedPolicyError('Demo seed refused in production. This command must not create default credentials or fixtures in production.');
  }
  if (explicitlyAllowedStaging || allowedDevelopment || allowedTest) return;
  if (nodeEnv === 'production') {
    throw new DemoSeedPolicyError('Demo seed refused without an explicitly authorized non-production deployment environment.');
  }

  throw new DemoSeedPolicyError('Demo seed refused. Set NODE_ENV=development or test, or set DEPLOYMENT_ENV=staging with ALLOW_STAGING_SEED=true for an explicitly authorized staging seed.');
}
