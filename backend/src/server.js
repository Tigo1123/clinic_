import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
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
import { errorHandler, notFoundHandler } from './utils/apiError.js';
import { fileURLToPath } from 'url';

// Load environment configuration
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',').map((origin) => origin.trim()).filter(Boolean);
const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed by CORS policy.'));
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

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token || !process.env.JWT_SECRET) return next(new Error('Authentication required.'));
    socket.user = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch (error) {
    return next(new Error('Invalid or expired token.'));
  }
});

// Attach socket.io server to express app so it can be referenced in routes
app.set('io', io);

io.on('connection', (socket) => {
  console.log(`[Socket.io] Client connected: ${socket.id}`);

  socket.join(`user_${socket.user.id}`);

  socket.on('disconnect', () => {
    console.log(`[Socket.io] Client disconnected: ${socket.id}`);
  });
});

// Enable CORS for frontend requests
app.use(cors(corsOptions));

// Parse incoming request payloads
app.use(express.json());

// Heartbeat Health Check
app.get('/api/health', async (req, res) => {
  try {
    // Basic DB ping to ensure connection works
    await prisma.$queryRaw`SELECT 1`;
    return res.json({
      status: 'healthy',
      database: 'connected',
      timestamp: new Date()
    });
  } catch (error) {
    console.error('Health check database error:', error);
    return res.status(500).json({
      status: 'unhealthy',
      database: 'disconnected',
      error: error.message
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

// Fallback handler for unmatched API endpoints to ensure JSON response instead of HTML
app.use('/api', notFoundHandler);

// Global Error Catching Middleware
app.use(errorHandler);

// Launch listening loop
export function startServer(port = PORT) {
  return httpServer.listen(port, () => {
  console.log(`==================================================`);
  console.log(` CMS SERVER RUNNING IN KHARTOUM TIME ZONE (GMT+2) `);
  console.log(` Local Server URL: http://localhost:${PORT}      `);
  console.log(`==================================================`);
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`));
if (isMain) startServer();

export { app, httpServer, io };
