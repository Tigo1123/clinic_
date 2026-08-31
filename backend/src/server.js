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
import { errorHandler, notFoundHandler } from './utils/apiError.js';
import { fileURLToPath } from 'url';
import { validateEnvironment } from './config.js';
import { logger } from './utils/logger.js';
import { authenticateSocketAccessToken } from './middleware/auth.js';
import { SocketRevocationService } from './services/socketRevocation.js';
import { corsMiddleware, securityHeadersMiddleware } from './utils/edgeSecurity.js';

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
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
app.use(securityHeadersMiddleware(environment.production));
app.use((req, res, next) => {
  req.id = req.get('x-request-id') || crypto.randomUUID();
  res.setHeader('X-Request-ID', req.id);
  const startedAt = Date.now();
  res.on('finish', () => logger.info('http.request', { requestId: req.id, method: req.method, path: req.path, status: res.statusCode, durationMs: Date.now() - startedAt, userId: req.user?.id }));
  next();
});

// Enable CORS for frontend requests after common security and correlation headers.
app.use(corsMiddleware(allowedOrigins));

// Parse incoming request payloads
app.use(express.json());

// Heartbeat Health Check
app.get('/api/health/live', (req, res) => res.json({ status: 'alive' }));
app.get(['/api/health', '/api/health/ready'], async (req, res) => {
  try {
    // Basic DB ping to ensure connection works
    await prisma.$queryRaw`SELECT 1`;
    if (!socketRevocation.isReady()) {
      return res.status(503).json({
        status: 'unhealthy',
        database: 'connected',
        socketRevocation: 'disconnected'
      });
    }
    return res.json({
      status: 'healthy',
      database: 'connected',
      socketRevocation: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('health.database_failed', { requestId: req.id, error });
    return res.status(503).json({
      status: 'unhealthy',
      database: 'disconnected',
      socketRevocation: socketRevocation.isReady() ? 'connected' : 'disconnected'
    });
  }
});

// Mount modular API routes
app.use('/api/auth', authRoutes);
app.use('/api/auth/mfa', mfaRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/records', recordRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/patient-auth', patientAuthRoutes);
app.use('/api/patient', patientSelfRoutes);
app.use('/api/pharmacy', pharmacyRoutes);

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
