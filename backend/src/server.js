import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
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
import notificationRoutes, { sendNotification } from './routes/notifications.js';
import path from 'path';

// Load environment configuration
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Create HTTP Server
const httpServer = createServer(app);

// Initialize Socket.io Server
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  }
});

// Attach socket.io server to express app so it can be referenced in routes
app.set('io', io);

io.on('connection', (socket) => {
  console.log(`[Socket.io] Client connected: ${socket.id}`);

  // Allow client to join user-specific notification room
  socket.on('joinUserRoom', (userId) => {
    if (userId) {
      socket.join(`user_${userId}`);
      socket.join(userId); // Also join direct userId room
      console.log(`[Socket.io] Socket ${socket.id} joined user room: ${userId}`);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[Socket.io] Client disconnected: ${socket.id}`);
  });
});

// Enable CORS for frontend requests
app.use(cors());

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

// Test Notification Endpoint for real-time testing
app.post('/api/test-notification', async (req, res) => {
  const io = req.app.get('io');
  const { userId, title, message } = req.body;

  try {
    const notification = await sendNotification(io, { userId, title, message });
    return res.json({ success: true, notification });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Fallback handler for unmatched API endpoints to ensure JSON response instead of HTML
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

// Global Error Catching Middleware
app.use((err, req, res, next) => {
  console.error('Unhandled runtime error:', err);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

// Launch listening loop
httpServer.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(` CMS SERVER RUNNING IN KHARTOUM TIME ZONE (GMT+2) `);
  console.log(` Local Server URL: http://localhost:${PORT}      `);
  console.log(`==================================================`);
});
