console.log('🚀 Starting Balance Manager (Progressive Mode)...');

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { logger } from './config/logger';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    mode: 'progressive',
    timestamp: new Date().toISOString(),
    features: {
      database: false,
      scheduler: false,
      routes: false
    }
  });
});

// Test database connection separately
app.get('/test/database', async (req, res) => {
  try {
    console.log('Testing database connection...');
    const { DatabaseManager } = require('./config/database');
    await DatabaseManager.connect();
    res.json({ 
      success: true, 
      message: 'Database connected successfully' 
    });
  } catch (error: any) {
    console.error('Database test failed:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Test route loading
app.get('/test/routes', async (req, res) => {
  try {
    console.log('Testing route loading...');
    const balanceRoutes = require('./routes/balance').default;
    res.json({ 
      success: true, 
      message: 'Routes loaded successfully',
      routes: balanceRoutes.stack?.map((r: any) => r.route?.path).filter(Boolean)
    });
  } catch (error: any) {
    console.error('Routes test failed:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Test scheduler
app.get('/test/scheduler', async (req, res) => {
  try {
    console.log('Testing scheduler...');
    const { AutoRechargeScheduler } = require('./scheduler/AutoRechargeScheduler');
    const scheduler = new AutoRechargeScheduler();
    res.json({ 
      success: true, 
      message: 'Scheduler created successfully',
      isRunning: scheduler.isRunning()
    });
  } catch (error: any) {
    console.error('Scheduler test failed:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Start server immediately
const server = app.listen(port, () => {
  console.log(`✅ Progressive server started on port ${port}`);
  console.log(`🏥 Health check: http://localhost:${port}/health`);
  console.log(`🧪 Test endpoints:`);
  console.log(`   - /test/database`);
  console.log(`   - /test/routes`);
  console.log(`   - /test/scheduler`);
  logger.info(`Progressive server started on port ${port}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});