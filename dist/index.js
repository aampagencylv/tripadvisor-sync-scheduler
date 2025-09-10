"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const scheduler_1 = require("./scheduler");
const app = (0, express_1.default)();
const PORT = parseInt(process.env.PORT || '3001');
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        service: 'tripadvisor-sync-scheduler',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});
app.get('/api/sync/status', scheduler_1.getSyncStatus);
app.post('/api/sync/trigger', scheduler_1.triggerManualSync);
app.post('/api/sync/start', scheduler_1.startScheduler);
app.post('/api/sync/stop', scheduler_1.stopScheduler);
app.post('/api/webhook/sync', async (req, res) => {
    try {
        const { action, userId, apiKey } = req.body;
        if (apiKey !== process.env.WEBHOOK_API_KEY) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        switch (action) {
            case 'trigger_sync':
                await scheduler_1.syncScheduler.triggerManualSync(userId);
                res.status(200).json({ message: 'Sync triggered' });
                break;
            case 'start_scheduler':
                scheduler_1.syncScheduler.start();
                res.status(200).json({ message: 'Scheduler started' });
                break;
            case 'stop_scheduler':
                scheduler_1.syncScheduler.stop();
                res.status(200).json({ message: 'Scheduler stopped' });
                break;
            default:
                res.status(400).json({ error: 'Invalid action' });
        }
    }
    catch (error) {
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});
app.use((error, req, res, next) => {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
});
app.listen(PORT, '0.0.0.0', () => {
    console.log(`TripAdvisor Sync Scheduler running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    if (process.env.NODE_ENV === 'production') {
        scheduler_1.syncScheduler.start();
        console.log('Automated sync scheduler started');
    }
});
process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    scheduler_1.syncScheduler.stop();
    process.exit(0);
});
process.on('SIGINT', () => {
    console.log('Received SIGINT, shutting down gracefully...');
    scheduler_1.syncScheduler.stop();
    process.exit(0);
});
exports.default = app;
