if (process.env.ALLOW_STAGING_SEED !== 'true') {
  console.error('Staging seed refused. Set ALLOW_STAGING_SEED=true for a deliberate one-time non-production seed operation.');
  process.exit(1);
}

if (process.env.DEPLOYMENT_ENV !== 'staging') {
  console.error('Staging seed refused. DEPLOYMENT_ENV must be staging.');
  process.exit(1);
}

console.warn('Running explicitly authorized staging seed. This command must never be used for production.');
await import('../prisma/seed.js');
