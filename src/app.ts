import express from 'express';
import dotenv from 'dotenv';
import { DatabaseManager } from './config/database';
import { logger } from './config/logger';
import { AutoRechargeScheduler } from './scheduler/AutoRechargeScheduler';
import balanceRoutes from './routes/balance';
import { requestLogger, authenticateUser } from './middleware/security';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(requestLogger);

app.use('/api/balance', authenticateUser, balanceRoutes);

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    scheduler: autoRechargeScheduler.isRunning() ? 'running' : 'stopped'
  });
});

app.get('/api/admin/trigger-recharge', async (req, res) => {
  try {
    const result = await autoRechargeScheduler.triggerManualCheck();
    res.json({
      message: 'Manual recharge check completed',
      result
    });
  } catch (error) {
    logger.error('Manual recharge trigger failed', error);
    res.status(500).json({ error: 'Failed to trigger manual recharge check' });
  }
});

const autoRechargeScheduler = new AutoRechargeScheduler();

const startServer = async () => {
  try {
    await DatabaseManager.connect();
    
    autoRechargeScheduler.start();
    
    app.listen(port, () => {
      logger.info(`Balance Manager server started on port ${port}`);
    });
    
  } catch (error) {
    logger.error('Failed to start server', error);
    process.exit(1);
  }
};

const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}, starting graceful shutdown`);
  
  try {
    autoRechargeScheduler.stop();
    await DatabaseManager.disconnect();
    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

if (require.main === module) {
  startServer();
}

export default app;