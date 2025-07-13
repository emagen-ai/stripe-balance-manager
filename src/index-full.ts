console.log('🚀 Starting Balance Manager (Full Mode)...');

import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

// Import components with error handling
console.log('📦 Loading dependencies...');
import { DatabaseManager } from './config/database';
import { logger } from './config/logger';
import { AutoRechargeScheduler } from './scheduler/AutoRechargeScheduler';
import balanceRoutes from './routes/balance';
import { requestLogger, authenticateUser } from './middleware/security';

console.log('✅ Dependencies loaded');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(requestLogger);

// Add balance routes
app.use('/api/balance', authenticateUser, balanceRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    mode: 'full',
    timestamp: new Date().toISOString(),
    scheduler: autoRechargeScheduler ? autoRechargeScheduler.isRunning() : false
  });
});

// Admin endpoint
app.get('/api/admin/trigger-recharge', async (req, res) => {
  try {
    const result = await autoRechargeScheduler.triggerManualCheck();
    res.json({
      message: 'Manual recharge check completed',
      result
    });
  } catch (error: any) {
    logger.error('Manual recharge trigger failed', error);
    res.status(500).json({ error: 'Failed to trigger manual recharge check' });
  }
});

// Create scheduler instance
let autoRechargeScheduler: AutoRechargeScheduler;

const startServer = async () => {
  try {
    console.log('🔌 Connecting to database...');
    await DatabaseManager.connect();
    console.log('✅ Database connected');
    
    console.log('⏰ Starting auto recharge scheduler...');
    autoRechargeScheduler = new AutoRechargeScheduler();
    autoRechargeScheduler.start();
    console.log('✅ Scheduler started');
    
    const server = app.listen(port, () => {
      console.log(`✅ Balance Manager server started on port ${port}`);
      logger.info(`Balance Manager server started on port ${port}`);
    });
    
    // Graceful shutdown
    const gracefulShutdown = async (signal: string) => {
      console.log(`Received ${signal}, starting graceful shutdown`);
      try {
        if (autoRechargeScheduler) {
          autoRechargeScheduler.stop();
        }
        await DatabaseManager.disconnect();
        server.close(() => {
          console.log('Server closed');
          process.exit(0);
        });
      } catch (error) {
        console.error('Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    logger.error('Failed to start server', error);
    process.exit(1);
  }
};

// Start the server
startServer().catch((error) => {
  console.error('❌ Startup error:', error);
  process.exit(1);
});