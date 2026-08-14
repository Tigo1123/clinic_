const REDACTED_KEYS = /password|authorization|token|secret|otp|code|medical|clinical|diagnosis|treatment/i;

function sanitize(value, depth = 0) {
  if (depth > 3 || value == null) return value;
  if (value instanceof Error) return { name: value.name, message: value.message, ...(process.env.NODE_ENV !== 'production' ? { stack: value.stack } : {}) };
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitize(item, depth + 1));
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, REDACTED_KEYS.test(key) ? '[REDACTED]' : sanitize(item, depth + 1)]));
  return value;
}

function write(level, event, context = {}) {
  const entry = { timestamp: new Date().toISOString(), level, event, ...sanitize(context) };
  (level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log)(JSON.stringify(entry));
}

export const logger = {
  info: (event, context) => write('INFO', event, context),
  warn: (event, context) => write('WARN', event, context),
  error: (event, context) => write('ERROR', event, context),
  security: (event, context) => write('SECURITY', event, context)
};
