// Debug version of scheduler service to identify startup issues

import express from 'express';
import cors from 'cors';

console.log('🔍 DEBUG: Starting scheduler service...');

const app = express();
const PORT = parseInt(process.env.PORT || '3001');

console.log('🔍 DEBUG: Port configured as:', PORT);
console.log('🔍 DEBUG: Environment variables:');
console.log('  - NODE_ENV:', process.env.NODE_ENV);
console.log('  - SUPABASE_URL:', process.env.SUPABASE_URL ? 'SET' : 'MISSING');
console.log('  - SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SET' : 'MISSING');

// Basic middleware
app.use(cors());
app.use(express.json());

console.log('🔍 DEBUG: Middleware configured');

// Simple health check
app.get('/health', (req, res) => {
  console.log('🔍 DEBUG: Health check requested');
  res.status(200).json({
    status: 'healthy',
    service: 'tripadvisor-sync-scheduler-debug',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: {
      nodeEnv: process.env.NODE_ENV,
      port: PORT,
      supabaseConfigured: !!process.env.SUPABASE_URL
    }
  });
});

// Debug endpoint
app.get('/debug', (req, res) => {
  console.log('🔍 DEBUG: Debug endpoint requested');
  res.status(200).json({
    message: 'Debug endpoint working',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    port: PORT,
    uptime: process.uptime()
  });
});

// Test Supabase connection
app.get('/test-db', async (req, res) => {
  console.log('🔍 DEBUG: Testing database connection...');
  
  try {
    // Import Supabase dynamically to catch import errors
    const { createClient } = await import('@supabase/supabase-js');
    
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing Supabase environment variables');
    }
    
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    // Simple query to test connection
    const { data, error } = await supabase
      .from('profiles')
      .select('user_id')
      .limit(1);
    
    if (error) {
      throw error;
    }
    
    console.log('🔍 DEBUG: Database connection successful');
    res.status(200).json({
      status: 'success',
      message: 'Database connection working',
      profileCount: data?.length || 0
    });
    
  } catch (error) {
    console.error('🔍 DEBUG: Database connection failed:', error);
    res.status(500).json({
      status: 'error',
      message: 'Database connection failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Test scheduler import
app.get('/test-scheduler', async (req, res) => {
  console.log('🔍 DEBUG: Testing scheduler import...');
  
  try {
    // Try to import the scheduler module
    const schedulerModule = await import('./scheduler');
    
    console.log('🔍 DEBUG: Scheduler module imported successfully');
    console.log('🔍 DEBUG: Available exports:', Object.keys(schedulerModule));
    
    res.status(200).json({
      status: 'success',
      message: 'Scheduler module imported successfully',
      exports: Object.keys(schedulerModule)
    });
    
  } catch (error) {
    console.error('🔍 DEBUG: Scheduler import failed:', error);
    res.status(500).json({
      status: 'error',
      message: 'Scheduler import failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Error handling
app.use((error: any, req: any, res: any, next: any) => {
  console.error('🔍 DEBUG: Server error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    details: error.message 
  });
});

// 404 handler
app.use('*', (req, res) => {
  console.log('🔍 DEBUG: 404 for path:', req.originalUrl);
  res.status(404).json({ 
    error: 'Not found',
    path: req.originalUrl,
    availableEndpoints: ['/health', '/debug', '/test-db', '/test-scheduler']
  });
});

console.log('🔍 DEBUG: Starting server...');

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('🔍 DEBUG: Server started successfully!');
  console.log(`🔍 DEBUG: TripAdvisor Sync Scheduler (Debug) running on port ${PORT}`);
  console.log(`🔍 DEBUG: Health check: http://localhost:${PORT}/health`);
  console.log(`🔍 DEBUG: Debug endpoint: http://localhost:${PORT}/debug`);
  console.log(`🔍 DEBUG: Test DB: http://localhost:${PORT}/test-db`);
  console.log(`🔍 DEBUG: Test Scheduler: http://localhost:${PORT}/test-scheduler`);
});

server.on('error', (error: any) => {
  console.error('🔍 DEBUG: Server startup error:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🔍 DEBUG: Received SIGTERM, shutting down gracefully...');
  server.close(() => {
    console.log('🔍 DEBUG: Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🔍 DEBUG: Received SIGINT, shutting down gracefully...');
  server.close(() => {
    console.log('🔍 DEBUG: Server closed');
    process.exit(0);
  });
});

process.on('uncaughtException', (error) => {
  console.error('🔍 DEBUG: Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🔍 DEBUG: Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

export default app;

