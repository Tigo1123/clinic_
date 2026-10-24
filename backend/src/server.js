import adminCatalogRoutes from './routes/adminCatalogs.js';
import express from 'express';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { createServer } from 'http';
import { Server } from 'socket.io';
import prisma from './db.js';
import authRoutes from './routes/auth.js';
import patientRoutes from './routes/patients.js';
import appointmentRoutes from './routes/appointments.js';
import recordRoutes from './routes/records.js';
import billingRoutes from './routes/billing.js';
import uploadRoutes from './routes/upload.js';
import adminRoutes from './routes/admin.js';
import notificationRoutes from './routes/notifications.js';
import patientAuthRoutes from './routes/patientAuth.js';
import patientSelfRoutes from './routes/patient.js';
import mfaRoutes from './routes/mfa.js';
import pharmacyRoutes from './routes/pharmacy.js';
import specialtyRoutes from './routes/specialties.js';
import adminSchedulingRoutes from './routes/adminScheduling.js';
import adminDoctorRoutes from './routes/adminDoctors.js';
import { errorHandler, notFoundHandler } from './utils/apiError.js';
import { fileURLToPath } from 'url';
import { validateEnvironment, staffMfaRequired } from './config.js';
import { logger } from './utils/logger.js';
import { authenticateSocketAccessToken } from './middleware/auth.js';
import { SocketRevocationService } from './services/socketRevocation.js';
import { corsMiddleware, securityHeadersMiddleware } from './utils/edgeSecurity.js';
import { productionDatabaseIdentityReady } from './utils/databaseReadiness.js';
import { recordHttpRequest, renderMetrics } from './utils/observability.js';

// Load environment configuration
dotenv.config();
const environment = validateEnvironment();

const app = express();
const PORT = process.env.PORT || 5000;
const allowedOrigins = environment.allowedOrigins;

// Create HTTP Server
const httpServer = createServer(app);

// Initialize Socket.io Server
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  }
});

io.use(authenticateSocketAccessToken);
const socketRevocation = new SocketRevocationService(io, environment.socketRevocation);
io.use((socket, next) => {
  if (socketRevocation.isReady()) return next();
  const error = new Error('Realtime session security is temporarily unavailable.');
  error.data = { code: 'SOCKET_SECURITY_UNAVAILABLE' };
  return next(error);
});

// Attach socket.io server to express app so it can be referenced in routes
app.set('io', io);

io.on('connection', (socket) => {
  logger.info('socket.connected', { socketId: socket.id, userId: socket.user.id });

  socket.join(`user_${socket.user.id}`);
  socket.join(`role_${socket.user.role}`);
  if (socket.user.doctorId) socket.join(`doctor_${socket.user.doctorId}`);

  socket.on('disconnect', () => {
    logger.info('socket.disconnected', { socketId: socket.id, userId: socket.user.id });
  });
});

app.disable('x-powered-by');
const trustedProxyHops = environment.production
  ? environment.trustProxyHops
  : environment.trustProxyHops || (process.env.TRUST_PROXY === 'true' ? 1 : false);
app.set('trust proxy', trustedProxyHops);
app.use(securityHeadersMiddleware(environment.production));
app.use((req, res, next) => {
  const suppliedRequestId = req.get('x-request-id');
  req.id = suppliedRequestId && /^[A-Za-z0-9._-]{1,100}$/.test(suppliedRequestId) ? suppliedRequestId : crypto.randomUUID();
  res.setHeader('X-Request-ID', req.id);
  const startedAt = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : 'unmatched';
    recordHttpRequest({ method: req.method, route, status: res.statusCode, durationMs });
    logger.info('http.request', { requestId: req.id, method: req.method, route, status: res.statusCode, durationMs, role: req.user?.role });
  });
  next();
});

// Enable CORS for frontend requests after common security and correlation headers.
app.use(corsMiddleware(allowedOrigins));

// Parse incoming request payloads
app.use(express.json());

// Liveness is independent of dependencies; readiness retains all dependency checks.
app.get(['/api/health', '/api/health/live'], (req, res) => res.json({ status: 'alive' }));
app.get('/api/health/ready', async (req, res) => {
  try {
    // Basic DB ping to ensure connection works
    await prisma.$queryRaw`SELECT 1`;
    const [identity] = await prisma.$queryRaw`
      SELECT current_database() AS database, current_user AS role, current_schema() AS schema,
        (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser,
        (SELECT rolcreaterole FROM pg_roles WHERE rolname = current_user) AS can_create_roles,
        (SELECT rolcreatedb FROM pg_roles WHERE rolname = current_user) AS can_create_databases,
        CASE WHEN to_regclass('public."RateLimitBucket"') IS NULL THEN false
          ELSE has_table_privilege(current_user, to_regclass('public."RateLimitBucket"'), 'SELECT')
          AND has_table_privilege(current_user, to_regclass('public."RateLimitBucket"'), 'INSERT')
          AND has_table_privilege(current_user, to_regclass('public."RateLimitBucket"'), 'UPDATE')
          AND has_table_privilege(current_user, to_regclass('public."RateLimitBucket"'), 'DELETE') END AS limiter_table_access
    `;
    if (environment.production && !productionDatabaseIdentityReady(identity, environment)) {
      logger.warn('health.production_database_identity_or_limiter', {
        database: identity?.database ?? null,
        role: identity?.role ?? null,
        schema: identity?.schema ?? null,
        expectedRole: environment.runtimeDatabaseRole,
        limiterTableAccess: identity?.limiter_table_access ?? null,
        superuser: identity?.superuser ?? null,
        canCreateRoles: identity?.can_create_roles ?? null,
        canCreateDatabases: identity?.can_create_databases ?? null
      });
      return res.status(503).json({ status: 'unhealthy', dependency: 'production_database_identity_or_limiter' });
    }
    if (environment.production && environment.databaseProvider === 'neon'
        && (identity.can_create_roles || identity.can_create_databases)) {
      logger.info('health.neon_managed_role_capabilities', {
        role: identity.role,
        canCreateRoles: identity.can_create_roles,
        canCreateDatabases: identity.can_create_databases
      });
    }
    if (!socketRevocation.isReady()) return res.status(503).json({ status: 'unhealthy' });
    return res.json({ status: 'healthy' });
  } catch (error) {
    logger.error('health.database_failed', { requestId: req.id, errorName: error?.name, errorCode: error?.code });
    return res.status(503).json({ status: 'unhealthy' });
  }
});

// Public, non-secret test marker. Operators configure this only on isolated targets.
app.get('/api/health/load-test-target', (req, res) => {
  const environment = process.env.DEPLOYMENT_ENV;
  const targetId = process.env.LOAD_TEST_TARGET_ID;
  res.set('Cache-Control', 'no-store');
  if (!['local', 'staging'].includes(environment) || !/^[a-zA-Z0-9_-]{12,80}$/.test(targetId || '')) return res.sendStatus(404);
  return res.json({ environment, targetId });
});

app.get('/api/health/metrics', (req, res) => {
  const expected = process.env.METRICS_TOKEN;
  if (!expected) return res.sendStatus(404);
  const supplied = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  const authorized = expectedBytes.length === suppliedBytes.length && expectedBytes.length > 0
    && crypto.timingSafeEqual(expectedBytes, suppliedBytes);
  if (!authorized) return res.sendStatus(404);
  res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  return res.send(renderMetrics());
});

app.get('/api/public-config', (req, res) => res.json({
  staffMfaRequired: staffMfaRequired(),
  clinicTimeZone: environment.clinicTimeZone,
  productNameAr: environment.facilityBranding.productNameAr,
  productNameEn: environment.facilityBranding.productNameEn,
  productDescriptorAr: environment.facilityBranding.productDescriptorAr,
  productDescriptorEn: environment.facilityBranding.productDescriptorEn,
  facilityNameAr: environment.facilityBranding.facilityNameAr,
  facilityNameEn: environment.facilityBranding.facilityNameEn,
  displayNameAr: environment.facilityBranding.displayNameAr,
  displayNameEn: environment.facilityBranding.displayNameEn
}));

// Mount modular API routes
app.use('/api/auth', authRoutes);
app.use('/api/auth/mfa', mfaRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/records', recordRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin', adminCatalogRoutes);
app.use('/api/admin', adminSchedulingRoutes);
app.use('/api/admin', adminDoctorRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/patient-auth', patientAuthRoutes);
app.use('/api/patient', patientSelfRoutes);
app.use('/api/pharmacy', pharmacyRoutes);
app.use('/api/specialties', specialtyRoutes);

// Fallback handler for unmatched API endpoints to ensure JSON response instead of HTML
app.use('/api', notFoundHandler);

// Global Error Catching Middleware
app.use(errorHandler);

// Launch listening loop
export function startServer(port = PORT) {
  socketRevocation.start().catch((error) => logger.error('socket.revocation_start_failed', { error }));
  return httpServer.listen(port, () => {
    logger.info('server.started', { port: Number(port), environment: process.env.NODE_ENV || 'development' });
  });
}

let shuttingDown = false;
export async function shutdown(signal = 'manual') {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('server.shutdown_started', { signal });
  await socketRevocation.stop();
  io.close();
  if (httpServer.listening) await new Promise((resolve) => httpServer.close(resolve));
  await prisma.$disconnect();
  logger.info('server.shutdown_complete', { signal });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`));
if (isMain) {
  startServer();
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
    shutdown(signal).then(() => process.exit(0)).catch((error) => {
      logger.error('server.shutdown_failed', { signal, error });
      process.exit(1);
    });
  });
}

export { app, httpServer, io, socketRevocation };
