// Automated Daily Sync Scheduler for TripAdvisor Reviews
// Runs daily at 2 AM to sync new reviews for all connected accounts

import { createClient } from '@supabase/supabase-js';
import cron from 'node-cron';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface SyncAccount {
  user_id: string;
  company_name: string;
  tripadvisor_location_id: string;
  last_tripadvisor_sync_at: string | null;
  timezone: string | null;
}

interface SyncJob {
  id: string;
  user_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  full_history: boolean;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  error?: string;
}

export class TripAdvisorSyncScheduler {
  private isRunning = false;
  private cronJob: any = null;

  /**
   * Start the automated sync scheduler
   */
  start(): void {
    if (this.cronJob) {
      console.log('Sync scheduler is already running');
      return;
    }

    // Schedule daily sync at 2:00 AM
    this.cronJob = cron.schedule('0 2 * * *', async () => {
      await this.runDailySync();
    }, {
      scheduled: true,
      timezone: 'UTC' // Run in UTC, individual user timezones handled separately
    });

    console.log('TripAdvisor sync scheduler started - daily sync at 2:00 AM UTC');
  }

  /**
   * Stop the automated sync scheduler
   */
  stop(): void {
    if (this.cronJob) {
      this.cronJob.destroy();
      this.cronJob = null;
      console.log('TripAdvisor sync scheduler stopped');
    }
  }

  /**
   * Run the daily sync process for all accounts
   */
  async runDailySync(): Promise<void> {
    if (this.isRunning) {
      console.log('Daily sync already running, skipping...');
      return;
    }

    this.isRunning = true;
    console.log('Starting daily TripAdvisor sync process...');

    try {
      // Get all accounts with TripAdvisor integration
      const accounts = await this.getAccountsForSync();
      console.log(`Found ${accounts.length} accounts for sync`);

      if (accounts.length === 0) {
        console.log('No accounts found for sync');
        return;
      }

      // Process accounts in batches to avoid overwhelming the system
      const batchSize = 5;
      const batches = this.chunkArray(accounts, batchSize);

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        console.log(`Processing batch ${i + 1}/${batches.length} (${batch.length} accounts)`);

        // Process batch in parallel
        const batchPromises = batch.map(account => this.syncAccount(account));
        await Promise.allSettled(batchPromises);

        // Wait between batches to avoid rate limiting
        if (i < batches.length - 1) {
          await this.sleep(30000); // 30 second delay between batches
        }
      }

      console.log('Daily sync process completed');

    } catch (error) {
      console.error('Error during daily sync:', error);
      await this.logSyncError('daily_sync_error', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get all accounts that need syncing
   */
  private async getAccountsForSync(): Promise<SyncAccount[]> {
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
        .not('tripadvisor_url_locked_at', 'is', null); // Only sync locked (active) integrations

      if (error) {
        throw new Error(`Failed to fetch accounts: ${error.message}`);
      }

      return accounts || [];

    } catch (error) {
      console.error('Error fetching accounts for sync:', error);
      return [];
    }
  }

  /**
   * Sync reviews for a single account
   */
  private async syncAccount(account: SyncAccount): Promise<void> {
    try {
      console.log(`Starting sync for ${account.company_name} (${account.user_id})`);

      // Check if there's already a running sync for this account
      const existingJob = await this.getRunningJob(account.user_id);
      if (existingJob) {
        console.log(`Sync already running for ${account.company_name}, skipping...`);
        return;
      }

      // Create sync job
      const job = await this.createSyncJob(account.user_id, false); // false = incremental sync
      if (!job) {
        console.error(`Failed to create sync job for ${account.company_name}`);
        return;
      }

      // Trigger the sync via our worker API
      const success = await this.triggerWorkerSync(job.id, account);
      
      if (success) {
        console.log(`Sync triggered successfully for ${account.company_name}`);
      } else {
        console.error(`Failed to trigger sync for ${account.company_name}`);
        await this.markJobFailed(job.id, 'Failed to trigger worker sync');
      }

    } catch (error) {
      console.error(`Error syncing account ${account.company_name}:`, error);
      await this.logSyncError('account_sync_error', error, account.user_id);
    }
  }

  /**
   * Check if there's a running sync job for a user
   */
  private async getRunningJob(userId: string): Promise<SyncJob | null> {
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

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
        console.error('Error checking running jobs:', error);
        return null;
      }

      return job;

    } catch (error) {
      console.error('Error checking running jobs:', error);
      return null;
    }
  }

  /**
   * Create a new sync job
   */
  private async createSyncJob(userId: string, fullHistory: boolean): Promise<SyncJob | null> {
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

    } catch (error) {
      console.error('Error creating sync job:', error);
      return null;
    }
  }

  /**
   * Trigger sync via worker API
   */
  private async triggerWorkerSync(jobId: string, account: SyncAccount): Promise<boolean> {
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
          fullHistory: false, // Daily sync is incremental
          priority: 'normal'
        })
      });

      if (!response.ok) {
        const error = await response.text();
        console.error(`Worker API error: ${response.status} - ${error}`);
        return false;
      }

      return true;

    } catch (error) {
      console.error('Error triggering worker sync:', error);
      return false;
    }
  }

  /**
   * Mark a job as failed
   */
  private async markJobFailed(jobId: string, errorMessage: string): Promise<void> {
    try {
      await supabase
        .from('review_sync_jobs')
        .update({
          status: 'failed',
          error: errorMessage,
          completed_at: new Date().toISOString()
        })
        .eq('id', jobId);

    } catch (error) {
      console.error('Error marking job as failed:', error);
    }
  }

  /**
   * Log sync errors for monitoring
   */
  private async logSyncError(errorType: string, error: any, userId?: string): Promise<void> {
    try {
      // In a full implementation, this would log to a monitoring system
      console.error(`Sync Error [${errorType}]:`, error);
      
      // Could also insert into an error log table
      // await supabase.from('sync_error_logs').insert({
      //   error_type: errorType,
      //   error_message: error.message || String(error),
      //   user_id: userId,
      //   created_at: new Date().toISOString()
      // });

    } catch (logError) {
      console.error('Error logging sync error:', logError);
    }
  }

  /**
   * Utility function to chunk array into batches
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Utility function to sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get sync statistics for monitoring
   */
  async getSyncStats(): Promise<{
    totalAccounts: number;
    activeJobs: number;
    completedToday: number;
    failedToday: number;
    lastRunTime?: string;
  }> {
    try {
      const today = new Date().toISOString().split('T')[0];

      const [accountsResult, activeJobsResult, completedResult, failedResult] = await Promise.all([
        // Total accounts with TripAdvisor integration
        supabase
          .from('profiles')
          .select('user_id', { count: 'exact' })
          .not('tripadvisor_location_id', 'is', null)
          .not('tripadvisor_url_locked_at', 'is', null),

        // Active sync jobs
        supabase
          .from('review_sync_jobs')
          .select('id', { count: 'exact' })
          .eq('platform', 'tripadvisor')
          .in('status', ['pending', 'running']),

        // Completed jobs today
        supabase
          .from('review_sync_jobs')
          .select('id', { count: 'exact' })
          .eq('platform', 'tripadvisor')
          .eq('status', 'completed')
          .gte('created_at', `${today}T00:00:00Z`)
          .lt('created_at', `${today}T23:59:59Z`),

        // Failed jobs today
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

    } catch (error) {
      console.error('Error getting sync stats:', error);
      return {
        totalAccounts: 0,
        activeJobs: 0,
        completedToday: 0,
        failedToday: 0
      };
    }
  }

  /**
   * Manual trigger for testing or immediate sync
   */
  async triggerManualSync(userId?: string): Promise<void> {
    console.log('Triggering manual sync...');
    
    if (userId) {
      // Sync specific user
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
    } else {
      // Sync all accounts
      await this.runDailySync();
    }
  }
}

// Singleton instance
export const syncScheduler = new TripAdvisorSyncScheduler();

// API endpoints for scheduler management

/**
 * GET /api/sync/status
 * Get sync scheduler status and statistics
 */
export async function getSyncStatus(req: any, res: any) {
  try {
    const stats = await syncScheduler.getSyncStats();
    
    res.status(200).json({
      isRunning: syncScheduler['isRunning'],
      schedulerActive: syncScheduler['cronJob'] !== null,
      nextRun: '2:00 AM UTC daily',
      stats
    });

  } catch (error) {
    res.status(500).json({ error: 'Failed to get sync status' });
  }
}

/**
 * POST /api/sync/trigger
 * Manually trigger sync for all accounts or specific user
 */
export async function triggerManualSync(req: any, res: any) {
  try {
    const { userId } = req.body;
    
    // Trigger sync (don't await to return immediately)
    syncScheduler.triggerManualSync(userId).catch(error => {
      console.error('Manual sync error:', error);
    });

    res.status(200).json({
      message: userId ? 'Manual sync triggered for user' : 'Manual sync triggered for all accounts',
      userId
    });

  } catch (error) {
    res.status(500).json({ error: 'Failed to trigger manual sync' });
  }
}

/**
 * POST /api/sync/start
 * Start the automated scheduler
 */
export async function startScheduler(req: any, res: any) {
  try {
    syncScheduler.start();
    res.status(200).json({ message: 'Sync scheduler started' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start scheduler' });
  }
}

/**
 * POST /api/sync/stop
 * Stop the automated scheduler
 */
export async function stopScheduler(req: any, res: any) {
  try {
    syncScheduler.stop();
    res.status(200).json({ message: 'Sync scheduler stopped' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to stop scheduler' });
  }
}

// Auto-start scheduler when module loads
if (process.env.NODE_ENV === 'production') {
  syncScheduler.start();
  console.log('TripAdvisor sync scheduler auto-started in production mode');
}

export default TripAdvisorSyncScheduler;

