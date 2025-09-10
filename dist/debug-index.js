"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
console.log('🔍 DEBUG: Starting scheduler service...');
const app = (0, express_1.default)();
const PORT = parseInt(process.env.PORT || '3001');
console.log('🔍 DEBUG: Port configured as:', PORT);
console.log('🔍 DEBUG: Environment variables:');
console.log('  - NODE_ENV:', process.env.NODE_ENV);
console.log('  - SUPABASE_URL:', process.env.SUPABASE_URL ? 'SET' : 'MISSING');
console.log('  - SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SET' : 'MISSING');
app.use((0, cors_1.default)());
app.use(express_1.default.json());
console.log('🔍 DEBUG: Middleware configured');
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
app.get('/test-db', async (req, res) => {
    console.log('🔍 DEBUG: Testing database connection...');
    try {
        const { createClient } = await Promise.resolve().then(() => __importStar(require('@supabase/supabase-js')));
        if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
            throw new Error('Missing Supabase environment variables');
        }
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
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
    }
    catch (error) {
        console.error('🔍 DEBUG: Database connection failed:', error);
        res.status(500).json({
            status: 'error',
            message: 'Database connection failed',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
app.get('/test-scheduler', async (req, res) => {
    console.log('🔍 DEBUG: Testing scheduler import...');
    try {
        const schedulerModule = await Promise.resolve().then(() => __importStar(require('./scheduler')));
        console.log('🔍 DEBUG: Scheduler module imported successfully');
        console.log('🔍 DEBUG: Available exports:', Object.keys(schedulerModule));
        res.status(200).json({
            status: 'success',
            message: 'Scheduler module imported successfully',
            exports: Object.keys(schedulerModule)
        });
    }
    catch (error) {
        console.error('🔍 DEBUG: Scheduler import failed:', error);
        res.status(500).json({
            status: 'error',
            message: 'Scheduler import failed',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
app.use((error, req, res, next) => {
    console.error('🔍 DEBUG: Server error:', error);
    res.status(500).json({
        error: 'Internal server error',
        details: error.message
    });
});
app.use('*', (req, res) => {
    console.log('🔍 DEBUG: 404 for path:', req.originalUrl);
    res.status(404).json({
        error: 'Not found',
        path: req.originalUrl,
        availableEndpoints: ['/health', '/debug', '/test-db', '/test-scheduler']
    });
});
console.log('🔍 DEBUG: Starting server...');
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('🔍 DEBUG: Server started successfully!');
    console.log(`🔍 DEBUG: TripAdvisor Sync Scheduler (Debug) running on port ${PORT}`);
    console.log(`🔍 DEBUG: Health check: http://localhost:${PORT}/health`);
    console.log(`🔍 DEBUG: Debug endpoint: http://localhost:${PORT}/debug`);
    console.log(`🔍 DEBUG: Test DB: http://localhost:${PORT}/test-db`);
    console.log(`🔍 DEBUG: Test Scheduler: http://localhost:${PORT}/test-scheduler`);
});
server.on('error', (error) => {
    console.error('🔍 DEBUG: Server startup error:', error);
    process.exit(1);
});
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
exports.default = app;
