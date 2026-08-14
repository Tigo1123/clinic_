import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import crypto from 'crypto';
import { createServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
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
import { ApiError, errorHandler, notFoundHandler } from './utils/apiError.js';
import { fileURLToPath } from 'url';
import { validateEnvironment } from './config.js';
import { logger } from './utils/logger.js';

// Load environment configuration
dotenv.config();
const environment = validateEnvironment();

const app = express();
const PORT = process.env.PORT || 5000;
const allowedOrigins = environment.allowedOrigins;
const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new ApiError(403, 'CORS_ORIGIN_FORBIDDEN', 'Request origin is not allowed.'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
};

// Create HTTP Server
const httpServer = createServer(app);

// Initialize Socket.io Server
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  }
});

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token || !process.env.JWT_SECRET) return next(new Error('Authentication required.'));
    socket.user = jwt.verify(token, process.env.JWT_SECRET);
    const activeUser = await prisma.user.findUnique({ where: { id: socket.user.id }, select: { status: true, role: true } });
    if (!activeUser || activeUser.status !== 'ACTIVE' || activeUser.role !== socket.user.role) return next(new Error('Session is no longer active.'));
    return next();
  } catch (error) {
    return next(new Error('Invalid or expired token.'));
  }
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
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-site' },
  hsts: environment.production ? { maxAge: 31536000, includeSubDomains: true } : false,
  referrerPolicy: { policy: 'no-referrer' }
}));
app.use((req, res, next) => {
  req.id = req.get('x-request-id') || crypto.randomUUID();
  res.setHeader('X-Request-ID', req.id);
  const startedAt = Date.now();
  res.on('finish', () => logger.info('http.request', { requestId: req.id, method: req.method, path: req.path, status: res.statusCode, durationMs: Date.now() - startedAt, userId: req.user?.id }));
  next();
});

// Enable CORS for frontend requests after common security and correlation headers.
app.use(cors(corsOptions));

// Parse incoming request payloads
app.use(express.json());

// Heartbeat Health Check
app.get('/api/health/live', (req, res) => res.json({ status: 'alive' }));
app.get(['/api/health', '/api/health/ready'], async (req, res) => {
  try {
    // Basic DB ping to ensure connection works
    await prisma.$queryRaw`SELECT 1`;
    return res.json({
      status: 'healthy',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('health.database_failed', { requestId: req.id, error });
    return res.status(503).json({
      status: 'unhealthy',
      database: 'disconnected'
    });
  }
});

// Mount modular API routes
app.use('/api/auth', authRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/records', recordRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/patient-auth', patientAuthRoutes);
app.use('/api/patient', patientSelfRoutes);

// Fallback handler for unmatched API endpoints to ensure JSON response instead of HTML
app.use('/api', notFoundHandler);

// Global Error Catching Middleware
app.use(errorHandler);

// Launch listening loop
export function startServer(port = PORT) {
  return httpServer.listen(port, () => {
    logger.info('server.started', { port: Number(port), environment: process.env.NODE_ENV || 'development' });
  });
}

let shuttingDown = false;
export async function shutdown(signal = 'manual') {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('server.shutdown_started', { signal });
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

export { app, httpServer, io };
