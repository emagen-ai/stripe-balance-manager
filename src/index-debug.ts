console.log('🚀 Starting Balance Manager (Debug Mode)...');
console.log('Environment:', process.env.NODE_ENV);
console.log('Port:', process.env.PORT);

// Test imports one by one
try {
  console.log('1. Loading dotenv...');
  require('dotenv').config();
  console.log('✅ dotenv loaded');

  console.log('2. Loading express...');
  const express = require('express');
  console.log('✅ express loaded');

  console.log('3. Loading database config...');
  const { DatabaseManager } = require('./config/database');
  console.log('✅ database config loaded');

  console.log('4. Creating Express app...');
  const app = express();
  const port = process.env.PORT || 3000;
  app.use(express.json());
  console.log('✅ Express app created');

  console.log('5. Adding health endpoint...');
  app.get('/health', (req: any, res: any) => {
    res.json({ 
      status: 'healthy',
      mode: 'debug',
      timestamp: new Date().toISOString() 
    });
  });
  console.log('✅ Health endpoint added');

  console.log('6. Starting server without database...');
  app.listen(port, () => {
    console.log(`✅ Debug server started on port ${port}`);
    console.log(`🏥 Health check: http://localhost:${port}/health`);
  });

} catch (error) {
  console.error('❌ Startup error:', error);
  process.exit(1);
}