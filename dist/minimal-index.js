// Ultra-minimal scheduler service for Railway deployment testing
// Pure JavaScript, no TypeScript, minimal dependencies

const express = require('express');
const cors = require('cors');

console.log('🔥 MINIMAL: Starting ultra-minimal scheduler service...');

const app = express();
const PORT = parseInt(process.env.PORT || '3001');

console.log('🔥 MINIMAL: Port configured as:', PORT);
console.log('🔥 MINIMAL: Node version:', process.version);
console.log('🔥 MINIMAL: Environment:', process.env.NODE_ENV);

// Basic middleware
app.use(cors());
app.use(express.json());

console.log('🔥 MINIMAL: Middleware configured');

// Ultra-simple health check
app.get('/health', (req, res) => {
  console.log('🔥 MINIMAL: Health check requested');
  res.status(200).json({
    status: 'healthy',
    service: 'minimal-scheduler',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    port: PORT,
    nodeVersion: process.version
  });
});

// Simple test endpoint
app.get('/test', (req, res) => {
  console.log('🔥 MINIMAL: Test endpoint requested');
  res.status(200).json({
    message: 'Minimal scheduler is working!',
    timestamp: new Date().toISOString(),
    port: PORT,
    environment: process.env.NODE_ENV
  });
});

// Root endpoint
app.get('/', (req, res) => {
  console.log('🔥 MINIMAL: Root endpoint requested');
  res.status(200).json({
    service: 'TripAdvisor Sync Scheduler (Minimal)',
    status: 'running',
    version: '1.0.0-minimal',
    endpoints: ['/health', '/test'],
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use('*', (req, res) => {
  console.log('🔥 MINIMAL: 404 for path:', req.originalUrl);
  res.status(404).json({ 
    error: 'Not found',
    path: req.originalUrl,
    availableEndpoints: ['/', '/health', '/test']
  });
});

// Error handler
app.use((error, req, res, next) => {
  console.error('🔥 MINIMAL: Server error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    details: error.message 
  });
});

console.log('🔥 MINIMAL: Starting server...');

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('🔥 MINIMAL: Server started successfully!');
  console.log(`🔥 MINIMAL: Minimal scheduler running on port ${PORT}`);
  console.log(`🔥 MINIMAL: Health check: http://localhost:${PORT}/health`);
  console.log(`🔥 MINIMAL: Test endpoint: http://localhost:${PORT}/test`);
  console.log(`🔥 MINIMAL: Root endpoint: http://localhost:${PORT}/`);
});

server.on('error', (error) => {
  console.error('🔥 MINIMAL: Server startup error:', error);
  process.exit(1);
});

// Keep alive logging
setInterval(() => {
  console.log('🔥 MINIMAL: Service is alive, uptime:', process.uptime(), 'seconds');
}, 30000); // Log every 30 seconds

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🔥 MINIMAL: Received SIGTERM, shutting down gracefully...');
  server.close(() => {
    console.log('🔥 MINIMAL: Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🔥 MINIMAL: Received SIGINT, shutting down gracefully...');
  server.close(() => {
    console.log('🔥 MINIMAL: Server closed');
    process.exit(0);
  });
});

process.on('uncaughtException', (error) => {
  console.error('🔥 MINIMAL: Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 MINIMAL: Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

console.log('🔥 MINIMAL: All event handlers configured');
console.log('🔥 MINIMAL: Minimal scheduler service initialization complete');

