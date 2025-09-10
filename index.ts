// Scheduler Service Deployment Configuration
// Standalone service for managing automated TripAdvisor syncs

import express from 'express';
import cors from 'cors';
import { syncScheduler, getSyncStatus, triggerManualSync, startScheduler, stopScheduler } from './scheduler';

const app = express();
const PORT = parseInt(process.env.PORT || '3001');

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'tripadvisor-sync-scheduler',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Sync management endpoints
app.get('/api/sync/status', getSyncStatus);
app.post('/api/sync/trigger', triggerManualSync);
app.post('/api/sync/start', startScheduler);
app.post('/api/sync/stop', stopScheduler);

// Webhook endpoint for external triggers
app.post('/api/webhook/sync', async (req, res) => {
  try {
    const { action, userId, apiKey } = req.body;
    
    // Verify API key
    if (apiKey !== process.env.WEBHOOK_API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    switch (action) {
      case 'trigger_sync':
        await syncScheduler.triggerManualSync(userId);
        res.status(200).json({ message: 'Sync triggered' });
        break;
      
      case 'start_scheduler':
        syncScheduler.start();
        res.status(200).json({ message: 'Scheduler started' });
        break;
      
      case 'stop_scheduler':
        syncScheduler.stop();
        res.status(200).json({ message: 'Scheduler stopped' });
        break;
      
      default:
        res.status(400).json({ error: 'Invalid action' });
    }

  } catch (error) {
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Error handling middleware
app.use((error: any, req: any, res: any, next: any) => {
  console.error('Server error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`TripAdvisor Sync Scheduler running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  
  // Auto-start scheduler in production
  if (process.env.NODE_ENV === 'production') {
    syncScheduler.start();
    console.log('Automated sync scheduler started');
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  syncScheduler.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully...');
  syncScheduler.stop();
  process.exit(0);
});

export default app;

