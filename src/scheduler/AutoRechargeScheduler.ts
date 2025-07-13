import * as cron from 'node-cron';
import { AutoRechargeService } from '../services/AutoRechargeService';
import { logger } from '../config/logger';

export class AutoRechargeScheduler {
  private autoRechargeService: AutoRechargeService;
  private task: cron.ScheduledTask | null = null;

  constructor() {
    this.autoRechargeService = new AutoRechargeService();
  }

  start(): void {
    const cronExpression = process.env.AUTO_RECHARGE_CHECK_INTERVAL || '*/5 * * * *'; // Default: every 5 minutes
    
    if (this.task) {
      logger.warn('Auto recharge scheduler is already running');
      return;
    }

    this.task = cron.schedule(cronExpression, async () => {
      await this.runAutoRechargeCheck();
    }, {
      scheduled: false,
      timezone: 'Asia/Shanghai'
    });

    this.task.start();
    
    logger.info('Auto recharge scheduler started', { 
      cronExpression,
      timezone: 'Asia/Shanghai'
    });
  }

  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
      logger.info('Auto recharge scheduler stopped');
    }
  }

  private async runAutoRechargeCheck(): Promise<void> {
    try {
      logger.info('Starting scheduled auto recharge check');
      const startTime = Date.now();

      const result = await this.autoRechargeService.processAllAutoRecharges();
      
      const duration = Date.now() - startTime;
      
      logger.info('Scheduled auto recharge check completed', {
        duration: `${duration}ms`,
        total: result.total,
        successful: result.successful,
        failed: result.failed
      });

      if (result.failed > 0) {
        logger.warn('Some auto recharges failed during scheduled check', {
          failedCount: result.failed,
          totalCount: result.total
        });
      }

    } catch (error) {
      logger.error('Scheduled auto recharge check failed', error);
    }
  }

  isRunning(): boolean {
    return this.task !== null;
  }

  async triggerManualCheck(): Promise<{ total: number; successful: number; failed: number }> {
    logger.info('Manual auto recharge check triggered');
    return await this.autoRechargeService.processAllAutoRecharges();
  }
}