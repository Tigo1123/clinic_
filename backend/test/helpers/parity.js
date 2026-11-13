// Shared helpers for the Express <-> NestJS HTTP parity test.
// Pure functions only: no database access, no app boot.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const ISO_TIMESTAMP = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g;
const JWT = /\beyJ[\w-]*\.[\w-]+\.[\w-]+/g;

// Keys whose values are per-request or per-run volatile, whatever their shape.
const VOLATILE_KEYS = new Map([
  ['requestId', '<request-id>'],
  ['request_id', '<request-id>'],
  ['requestID', '<request-id>'],
  ['token', '<token>'],
  ['accessToken', '<token>'],
  ['refreshToken', '<token>'],
  ['csrfToken', '<token>'],
  ['developmentCode', '<code>'],
  ['iat', '<epoch>'],
  ['exp', '<epoch>']
]);

/**
 * Replaces volatile values (UUIDs, ISO timestamps, JWTs, request ids, tokens)
 * with stable placeholders so Express and Nest bodies can be compared exactly.
 * Object key order is not normalised; deepStrictEqual ignores it anyway.
 */
export function normalise(value, key) {
  if (Array.isArray(value)) return value.map((item) => normalise(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalise(v, k)]));
  }
  if (VOLATILE_KEYS.has(key)) return VOLATILE_KEYS.get(key);
  if (typeof value === 'string') {
    return value
      .replace(JWT, '<jwt>')
      .replace(UUID, '<uuid>')
      .replace(ISO_TIMESTAMP, '<timestamp>');
  }
  return value;
}

/**
 * True when the response shows the route is not registered: the API's unknown-route envelope,
 * Nest's default one, or an HTML document (a static/SPA fallback answering an unmatched GET,
 * which can be a 200 and so would otherwise look like a registered route).
 */
export function isRouteNotFound({ status, body, contentType = '' }) {
  if (/text\/html/i.test(contentType)) return true;
  if (status !== 404) return false;
  if (body?.error?.code === 'ROUTE_NOT_FOUND') return true;
  return /^Cannot (GET|POST|PUT|PATCH|DELETE)\b/.test(String(body?.message ?? ''));
}

const ROUTE_CALL = /router\.(get|post|put|patch|delete)\(\s*(\[[^\]]*\]|['"`][^'"`]*['"`])/g;
const ROUTE_CALL_ANY = /router\.(get|post|put|patch|delete)\(/g;
const APP_ROUTE_CALL = /app\.(get|post|put|patch|delete)\(\s*(\[[^\]]*\]|'[^']*')/g;
const QUOTED = /['"`]([^'"`]*)['"`]/g;

function joinPath(prefix, route) {
  if (route === '/' || route === '') return prefix;
  return `${prefix}${route}`;
}

/**
 * Parses every Express route from src/server.js (app-level routes and
 * `app.use(prefix, router)` mounts) and src/routes/*.js (`router.<method>(path`).
 * Returns { routes, routerCallCount } so callers can check that the parser saw
 * every `router.<method>(` call in the route files.
 */
export function parseExpressRoutes(backendDir) {
  const serverSource = fs.readFileSync(path.join(backendDir, 'src/server.js'), 'utf8');
  const routeFileByVariable = new Map();
  for (const match of serverSource.matchAll(/import\s+(\w+)\s+from\s+'\.\/routes\/(\w+)\.js'/g)) {
    routeFileByVariable.set(match[1], match[2]);
  }

  const routes = new Map();
  const add = (method, routePath, file) => {
    const key = `${method.toUpperCase()} ${routePath}`;
    if (!routes.has(key)) routes.set(key, { method: method.toUpperCase(), path: routePath, file });
  };

  for (const match of serverSource.matchAll(APP_ROUTE_CALL)) {
    for (const quoted of match[2].matchAll(QUOTED)) add(match[1], quoted[1], 'src/server.js');
  }

  let routerCallCount = 0;
  for (const match of serverSource.matchAll(/app\.use\(\s*'(\/api[^']*)'\s*,\s*(\w+)\s*\)/g)) {
    const [, prefix, variable] = match;
    const file = routeFileByVariable.get(variable);
    if (!file) continue;
    const source = fs.readFileSync(path.join(backendDir, 'src/routes', `${file}.js`), 'utf8');
    routerCallCount += source.match(ROUTE_CALL_ANY)?.length ?? 0;
    for (const call of source.matchAll(ROUTE_CALL)) {
      for (const quoted of call[2].matchAll(QUOTED)) {
        add(call[1], joinPath(prefix, quoted[1]), `src/routes/${file}.js`);
      }
    }
  }

  return { routes: [...routes.values()], routerCallCount };
}

/** Replaces each `:param` with a fresh UUID so every sweep request targets a missing record. */
export function concretePath(routePath) {
  return routePath.replace(/:[A-Za-z_]\w*/g, () => randomUUID());
}
