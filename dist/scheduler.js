"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncScheduler = exports.TripAdvisorSyncScheduler = void 0;
exports.getSyncStatus = getSyncStatus;
exports.triggerManualSync = triggerManualSync;
exports.startScheduler = startScheduler;
exports.stopScheduler = stopScheduler;
const supabase_js_1 = require("@supabase/supabase-js");
const node_cron_1 = __importDefault(require("node-cron"));
const supabase = (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
class TripAdvisorSyncScheduler {
    constructor() {
        this.isRunning = false;
        this.cronJob = null;
    }
    start() {
        if (this.cronJob) {
            console.log('Sync scheduler is already running');
            return;
        }
        this.cronJob = node_cron_1.default.schedule('0 2 * * *', async () => {
            await this.runDailySync();
        }, {
            scheduled: true,
            timezone: 'UTC'
        });
        console.log('TripAdvisor sync scheduler started - daily sync at 2:00 AM UTC');
    }
    stop() {
        if (this.cronJob) {
            this.cronJob.destroy();
            this.cronJob = null;
            console.log('TripAdvisor sync scheduler stopped');
        }
    }
    async runDailySync() {
        if (this.isRunning) {
            console.log('Daily sync already running, skipping...');
            return;
        }
        this.isRunning = true;
        console.log('Starting daily TripAdvisor sync process...');
        try {
            const accounts = await this.getAccountsForSync();
            console.log(`Found ${accounts.length} accounts for sync`);
            if (accounts.length === 0) {
                console.log('No accounts found for sync');
                return;
            }
            const batchSize = 5;
            const batches = this.chunkArray(accounts, batchSize);
            for (let i = 0; i < batches.length; i++) {
                const batch = batches[i];
                console.log(`Processing batch ${i + 1}/${batches.length} (${batch.length} accounts)`);
                const batchPromises = batch.map(account => this.syncAccount(account));
                await Promise.allSettled(batchPromises);
                if (i < batches.length - 1) {
                    await this.sleep(30000);
                }
            }
            console.log('Daily sync process completed');
        }
        catch (error) {
            console.error('Error during daily sync:', error);
            await this.logSyncError('daily_sync_error', error);
        }
        finally {
            this.isRunning = false;
        }
    }
    async getAccountsForSync() {
        try {
            const { data: accounts, error } = await supabase
                .from('profiles')
                .select(`
          user_id,
          company_name,
          tripadvisor_location_id,
          last_tripadvisor_sync_at,
          timezone
        `)
                .not('tripadvisor_location_id', 'is', null)
                .not('tripadvisor_url_locked_at', 'is', null);
            if (error) {
                throw new Error(`Failed to fetch accounts: ${error.message}`);
            }
            return accounts || [];
        }
        catch (error) {
            console.error('Error fetching accounts for sync:', error);
            return [];
        }
    }
    async syncAccount(account) {
        try {
            console.log(`Starting sync for ${account.company_name} (${account.user_id})`);
            const existingJob = await this.getRunningJob(account.user_id);
            if (existingJob) {
                console.log(`Sync already running for ${account.company_name}, skipping...`);
                return;
            }
            const job = await this.createSyncJob(account.user_id, false);
            if (!job) {
                console.error(`Failed to create sync job for ${account.company_name}`);
                return;
            }
            const success = await this.triggerWorkerSync(job.id, account);
            if (success) {
                console.log(`Sync triggered successfully for ${account.company_name}`);
            }
            else {
                console.error(`Failed to trigger sync for ${account.company_name}`);
                await this.markJobFailed(job.id, 'Failed to trigger worker sync');
            }
        }
        catch (error) {
            console.error(`Error syncing account ${account.company_name}:`, error);
            await this.logSyncError('account_sync_error', error, account.user_id);
        }
    }
    async getRunningJob(userId) {
        try {
            const { data: job, error } = await supabase
                .from('review_sync_jobs')
                .select('*')
                .eq('tour_operator_id', userId)
                .eq('platform', 'tripadvisor')
                .in('status', ['pending', 'running'])
                .order('created_at', { ascending: false })
                .limit(1)
                .single();
            if (error && error.code !== 'PGRST116') {
                console.error('Error checking running jobs:', error);
                return null;
            }
            return job;
        }
        catch (error) {
            console.error('Error checking running jobs:', error);
            return null;
        }
    }
    async createSyncJob(userId, fullHistory) {
        try {
            const { data: job, error } = await supabase
                .from('review_sync_jobs')
                .insert({
                tour_operator_id: userId,
                platform: 'tripadvisor',
                status: 'pending',
                full_history: fullHistory,
                total_available: 0,
                imported_count: 0,
                started_at: new Date().toISOString()
            })
                .select()
                .single();
            if (error) {
                console.error('Error creating sync job:', error);
                return null;
            }
            return job;
        }
        catch (error) {
            console.error('Error creating sync job:', error);
            return null;
        }
    }
    async triggerWorkerSync(jobId, account) {
        try {
            const workerUrl = process.env.WORKER_API_URL || 'https://tripadvisor-worker.railway.app';
            const response = await fetch(`${workerUrl}/api/jobs`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.WORKER_API_KEY}`
                },
                body: JSON.stringify({
                    jobId,
                    userId: account.user_id,
                    tripAdvisorUrl: account.tripadvisor_location_id,
                    fullHistory: false,
                    priority: 'normal'
                })
            });
            if (!response.ok) {
                const error = await response.text();
                console.error(`Worker API error: ${response.status} - ${error}`);
                return false;
            }
            return true;
        }
        catch (error) {
            console.error('Error triggering worker sync:', error);
            return false;
        }
    }
    async markJobFailed(jobId, errorMessage) {
        try {
            await supabase
                .from('review_sync_jobs')
                .update({
                status: 'failed',
                error: errorMessage,
                completed_at: new Date().toISOString()
            })
                .eq('id', jobId);
        }
        catch (error) {
            console.error('Error marking job as failed:', error);
        }
    }
    async logSyncError(errorType, error, userId) {
        try {
            console.error(`Sync Error [${errorType}]:`, error);
        }
        catch (logError) {
            console.error('Error logging sync error:', logError);
        }
    }
    chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    async getSyncStats() {
        try {
            const today = new Date().toISOString().split('T')[0];
            const [accountsResult, activeJobsResult, completedResult, failedResult] = await Promise.all([
                supabase
                    .from('profiles')
                    .select('user_id', { count: 'exact' })
                    .not('tripadvisor_location_id', 'is', null)
                    .not('tripadvisor_url_locked_at', 'is', null),
                supabase
                    .from('review_sync_jobs')
                    .select('id', { count: 'exact' })
                    .eq('platform', 'tripadvisor')
                    .in('status', ['pending', 'running']),
                supabase
                    .from('review_sync_jobs')
                    .select('id', { count: 'exact' })
                    .eq('platform', 'tripadvisor')
                    .eq('status', 'completed')
                    .gte('created_at', `${today}T00:00:00Z`)
                    .lt('created_at', `${today}T23:59:59Z`),
                supabase
                    .from('review_sync_jobs')
                    .select('id', { count: 'exact' })
                    .eq('platform', 'tripadvisor')
                    .eq('status', 'failed')
                    .gte('created_at', `${today}T00:00:00Z`)
                    .lt('created_at', `${today}T23:59:59Z`)
            ]);
            return {
                totalAccounts: accountsResult.count || 0,
                activeJobs: activeJobsResult.count || 0,
                completedToday: completedResult.count || 0,
                failedToday: failedResult.count || 0
            };
        }
        catch (error) {
            console.error('Error getting sync stats:', error);
            return {
                totalAccounts: 0,
                activeJobs: 0,
                completedToday: 0,
                failedToday: 0
            };
        }
    }
    async triggerManualSync(userId) {
        console.log('Triggering manual sync...');
        if (userId) {
            const { data: account, error } = await supabase
                .from('profiles')
                .select(`
          user_id,
          company_name,
          tripadvisor_location_id,
          last_tripadvisor_sync_at,
          timezone
        `)
                .eq('user_id', userId)
                .not('tripadvisor_location_id', 'is', null)
                .single();
            if (error || !account) {
                console.error('Account not found or no TripAdvisor integration');
                return;
            }
            await this.syncAccount(account);
        }
        else {
            await this.runDailySync();
        }
    }
}
exports.TripAdvisorSyncScheduler = TripAdvisorSyncScheduler;
exports.syncScheduler = new TripAdvisorSyncScheduler();
async function getSyncStatus(req, res) {
    try {
        const stats = await exports.syncScheduler.getSyncStats();
        res.status(200).json({
            isRunning: exports.syncScheduler['isRunning'],
            schedulerActive: exports.syncScheduler['cronJob'] !== null,
            nextRun: '2:00 AM UTC daily',
            stats
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to get sync status' });
    }
}
async function triggerManualSync(req, res) {
    try {
        const { userId } = req.body;
        exports.syncScheduler.triggerManualSync(userId).catch(error => {
            console.error('Manual sync error:', error);
        });
        res.status(200).json({
            message: userId ? 'Manual sync triggered for user' : 'Manual sync triggered for all accounts',
            userId
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to trigger manual sync' });
    }
}
async function startScheduler(req, res) {
    try {
        exports.syncScheduler.start();
        res.status(200).json({ message: 'Sync scheduler started' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to start scheduler' });
    }
}
async function stopScheduler(req, res) {
    try {
        exports.syncScheduler.stop();
        res.status(200).json({ message: 'Sync scheduler stopped' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to stop scheduler' });
    }
}
if (process.env.NODE_ENV === 'production') {
    exports.syncScheduler.start();
    console.log('TripAdvisor sync scheduler auto-started in production mode');
}
exports.default = TripAdvisorSyncScheduler;
