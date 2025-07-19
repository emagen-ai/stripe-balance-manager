import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';

console.log('🚀 Starting app initialization...');

dotenv.config();

console.log('📦 Loading dependencies...');

import { DatabaseManager } from './config/database';
import { logger } from './config/logger';
import { AutoRechargeScheduler } from './scheduler/AutoRechargeScheduler';
import balanceRoutes from './routes/balance';
import organizationRoutes from './routes/organizations';
import webhookRoutes from './routes/webhooks';
import { requestLogger, authenticateUser } from './middleware/security';

console.log('✅ Dependencies loaded');

const app = express();
const port = process.env.PORT || 3000;

// CORS 配置
const corsOptions = {
  origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
    // 允许的来源列表
    const allowedOrigins = [
      'http://172.171.97.248:1088',
      'http://localhost:1088',
      'http://localhost:3000',
      'https://localhost:3000',
      // 如果有其他前端域名，添加在这里
    ];
    
    // 允许无 origin 的请求（比如 Postman）
    if (!origin) {
      callback(null, true);
      return;
    }
    
    // 检查来源是否在允许列表中
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // 在生产环境中，您可能想要记录被拒绝的来源
      logger.warn(`CORS request from unauthorized origin: ${origin}`);
      callback(null, true); // 暂时允许所有来源，生产环境可以改为 false
    }
  },
  credentials: true, // 允许携带认证信息
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  maxAge: 86400 // 预检请求的缓存时间（24小时）
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(requestLogger);

// 静态文件服务
app.use(express.static(path.join(__dirname, '../public')));

app.use('/api/balance', balanceRoutes); // 余额管理API（管理工具，暂不需要认证）
app.use('/api/organizations', organizationRoutes);
app.use('/webhooks', webhookRoutes); // Webhook端点不需要认证

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
    console.log('🔌 Connecting to database...');
    await DatabaseManager.connect();
    console.log('✅ Database connected');
    
    console.log('⏰ Starting auto recharge scheduler...');
    autoRechargeScheduler.start();
    console.log('✅ Scheduler started');
    
    app.listen(port, () => {
      console.log(`✅ Balance Manager server started on port ${port}`);
      logger.info(`Balance Manager server started on port ${port}`);
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
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