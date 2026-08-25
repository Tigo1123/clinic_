const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const SURROUNDING_QUOTE = /^["']|["']$/;

function normalizedValue(env, name, { required = true } = {}) {
  const raw = env[name];
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw new Error(`${name} is required.`);
    return '';
  }
  if (CONTROL_CHARACTERS.test(raw)) throw new Error(`${name} contains invalid control characters.`);
  const value = raw.trim();
  if (!value) throw new Error(`${name} must not be empty.`);
  if (SURROUNDING_QUOTE.test(value)) throw new Error(`${name} must not be surrounded by quotes.`);
  return value;
}

function smtpPort(env) {
  const raw = env.SMTP_PORT;
  if (raw === undefined || raw === '') return 587;
  const value = normalizedValue(env, 'SMTP_PORT');
  if (!/^\d+$/.test(value)) throw new Error('SMTP_PORT must be a valid port.');
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMTP_PORT must be a valid port.');
  return port;
}

function smtpFromName(env) {
  const raw = env.SMTP_FROM_NAME;
  if (raw === undefined || raw === null || raw === '') return 'Al-Shifa Medical Clinic';
  if (CONTROL_CHARACTERS.test(raw)) throw new Error('SMTP_FROM_NAME contains invalid control characters.');
  const value = raw.trim();
  if (!value) return 'Al-Shifa Medical Clinic';
  if (SURROUNDING_QUOTE.test(value)) throw new Error('SMTP_FROM_NAME must not be surrounded by quotes.');
  return value;
}

export function readSmtpConfig(env = process.env, { required = false } = {}) {
  const fromVariable = env.SMTP_FROM_EMAIL ? 'SMTP_FROM_EMAIL' : 'SMTP_FROM';
  const requiredValues = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];
  const configured = requiredValues.some((name) => env[name] !== undefined && env[name] !== '') ||
    env.SMTP_FROM_EMAIL !== undefined || env.SMTP_FROM !== undefined;

  if (!required && !configured) return null;

  return {
    host: normalizedValue(env, 'SMTP_HOST'),
    port: smtpPort(env),
    secure: env.SMTP_SECURE === 'true',
    user: normalizedValue(env, 'SMTP_USER'),
    pass: normalizedValue(env, 'SMTP_PASS'),
    fromEmail: normalizedValue(env, fromVariable),
    fromName: smtpFromName(env),
    connectionTimeout: Number(env.SMTP_CONNECTION_TIMEOUT_MS || 10000)
  };
}
