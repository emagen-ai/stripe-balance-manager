console.log('🚀 Starting Balance Manager (Full Mode)...');

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

// Import components with error handling
console.log('📦 Loading dependencies...');
import { DatabaseManager } from './config/database';
import { logger } from './config/logger';
import { AutoRechargeScheduler } from './scheduler/AutoRechargeScheduler';
import balanceRoutes from './routes/balance';
import paymentRoutes from './routes/payment';
import webhookRoutes from './routes/webhooks';
import workosWebhookRoutes from './routes/workos-webhooks';
import organizationRoutes from './routes/organizations';
import kmsProxyRoutes from './routes/kms-proxy';
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
      // Railway 部署的前端URL（如果有）
      process.env.FRONTEND_URL,
      // 如果有其他前端域名，添加在这里
    ].filter(Boolean); // 过滤掉undefined值
    
    // 允许无 origin 的请求（比如 Postman、服务器端请求）
    if (!origin) {
      callback(null, true);
      return;
    }
    
    // 检查来源是否在允许列表中
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // 在开发环境允许所有，生产环境拒绝
      if (process.env.NODE_ENV === 'development') {
        logger.warn(`CORS request from unauthorized origin: ${origin} (allowed in dev mode)`);
        callback(null, true);
      } else {
        logger.warn(`CORS request blocked from unauthorized origin: ${origin}`);
        callback(new Error(`CORS policy: origin ${origin} not allowed`));
      }
    }
  },
  credentials: true, // 允许携带认证信息
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-User-Id'],
  exposedHeaders: ['Content-Length', 'X-Request-Id'],
  maxAge: 86400, // 预检请求的缓存时间（24小时）
  optionsSuccessStatus: 200 // 某些旧浏览器（IE11）对204有问题
};

app.use(cors(corsOptions));

// 显式处理所有 OPTIONS 请求
app.options('*', cors(corsOptions));

app.use(express.json());
app.use(requestLogger);

// Add routes
app.use('/api/balance', balanceRoutes); // 余额管理API（管理工具，暂不需要认证）
app.use('/api/payment', authenticateUser, paymentRoutes);
app.use('/api/organizations', organizationRoutes); // 组织管理端点
app.use('/api/kms', kmsProxyRoutes); // KMS代理端点
app.use('/webhooks', webhookRoutes); // Stripe Webhook端点不需要认证
app.use('/webhooks', workosWebhookRoutes); // WorkOS Webhook端点不需要认证

// Serve static files for payment setup page
app.use(express.static('public'));

// Root route for verification panel
app.get('/', (req, res) => {
  res.sendFile('index.html', { root: 'public' });
});

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