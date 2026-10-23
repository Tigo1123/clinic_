export const DESTRUCTIVE_CONFIRMATION = 'I_CONFIRM_DISPOSABLE_STAGING_DATA';

export function assertDestructiveStaging(env, value, database, port = '55439') {
  if (env.CONFIRM_STAGING_DESTRUCTIVE_ACTION !== DESTRUCTIVE_CONFIRMATION
      || env.STAGING_TOOL_ENV !== 'isolated-local-staging' || env.NODE_ENV === 'production') {
    throw new Error('Destructive tooling requires STAGING_TOOL_ENV=isolated-local-staging and explicit CONFIRM_STAGING_DESTRUCTIVE_ACTION.');
  }
  let target;
  try { target = new URL(value); } catch { throw new Error('A guarded staging database target is required.'); }
  if (!['postgres:', 'postgresql:'].includes(target.protocol)
      || !['127.0.0.1', 'localhost'].includes(target.hostname)
      || target.port !== port || target.pathname !== `/${database}`
      || [...target.searchParams.keys()].some((key) => !['schema'].includes(key))
      || !['public', ''].includes(target.searchParams.get('schema') || '')) {
    throw new Error('Refusing destructive action outside the isolated loopback staging database.');
  }
}

export function assertLoadTarget(env, { writes = false } = {}) {
  // Accept only an origin: credentials, query strings and redirecting paths are refused.
  const match = /^(https?):\/\/([a-z0-9.-]+)(?::([0-9]{1,5}))?\/?$/i.exec(env.BASE_URL || '');
  if (!match) throw new Error('BASE_URL must be an explicit HTTP(S) origin without credentials.');
  const host = match[2].toLowerCase();
  const denied = ['clinic-api.onrender.com', 'clinic-web.onrender.com',
    ...(env.LOAD_TEST_PRODUCTION_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)];
  if (/prod(?:uction)?|\.neon\.(tech|build)$/i.test(host) || denied.includes(host)) throw new Error('Production load targets are refused.');
  const local = host === 'localhost' || host === '127.0.0.1';
  if (env.LOAD_TEST_ENV === 'local') {
    if (!local || env.ENABLE_LOCAL_LOAD_TEST !== 'true' || env.CONFIRM_LOAD_TEST !== 'I_CONFIRM_LOCAL_LOAD') throw new Error('Local loads require separate local mode and confirmation.');
  } else if (env.LOAD_TEST_ENV === 'staging') {
    if (local || /^\d+(?:\.\d+){3}$/.test(host) || !host.includes('.')
        || match[1] !== 'https' || env.EXPECTED_STAGING_HOST !== host
        || !env.LOAD_TEST_PRODUCTION_HOSTS?.trim()
        || env.CONFIRM_LOAD_TEST !== 'I_CONFIRM_ISOLATED_STAGING_LOAD') {
      throw new Error('Staging loads require HTTPS, expected host, production denylist, and explicit load confirmation.');
    }
  } else throw new Error('LOAD_TEST_ENV must explicitly select local or staging.');
  if (!/^[a-zA-Z0-9_-]{12,80}$/.test(env.EXPECTED_LOAD_TEST_TARGET_ID || '')) throw new Error('An independently configured server target marker is required.');
  if (writes && env.CONFIRM_LOAD_TEST_WRITES !== 'I_CONFIRM_DISPOSABLE_LOAD_TEST_WRITES') throw new Error('Write/auth scenarios require stronger confirmation.');
  return { host, base: env.BASE_URL.replace(/\/$/, ''), environment: env.LOAD_TEST_ENV, targetId: env.EXPECTED_LOAD_TEST_TARGET_ID };
}

export function assertLoadTargetMarker(expected, marker) {
  if (marker?.environment !== expected.environment || marker?.targetId !== expected.targetId) {
    throw new Error('Server staging identity marker did not match; no workload may run.');
  }
}
