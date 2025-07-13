import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Simple health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    version: '1.0.0'
  });
});

// Test endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Stripe Balance Manager API',
    endpoints: [
      'GET /health',
      'GET /api/test',
      'POST /webhook'
    ]
  });
});

// Test API endpoint
app.get('/api/test', (req, res) => {
  res.json({
    success: true,
    data: {
      stripe_configured: !!process.env.STRIPE_SECRET_KEY,
      database_configured: !!process.env.DATABASE_URL,
      timestamp: new Date().toISOString()
    }
  });
});

// Webhook receiver
app.post('/webhook', (req, res) => {
  console.log('Webhook received:', {
    timestamp: new Date().toISOString(),
    body: req.body
  });
  res.json({ received: true });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(port, () => {
  console.log(`🚀 Simple server started on port ${port}`);
  console.log(`🏥 Health check: http://localhost:${port}/health`);
});