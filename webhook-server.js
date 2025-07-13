const express = require('express');
const app = express();
const PORT = 8090;

// Middleware to parse JSON and raw body
app.use(express.json());
app.use(express.raw({ type: 'application/json' }));

// Store received webhooks
const webhooks = [];

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'Webhook server running',
    timestamp: new Date().toISOString(),
    publicUrl: 'http://172.171.97.248:1090',
    receivedWebhooks: webhooks.length,
    recentWebhooks: webhooks.slice(-5)
  });
});

// Webhook receiver endpoint
app.post('/webhook', (req, res) => {
  const webhook = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    headers: req.headers,
    body: req.body,
    method: req.method,
    url: req.url,
    ip: req.ip
  };
  
  webhooks.push(webhook);
  console.log('📥 Webhook received:', {
    id: webhook.id,
    timestamp: webhook.timestamp,
    type: req.body.type || 'unknown',
    event: req.body.event || req.body
  });
  
  // Respond with success
  res.json({ 
    received: true, 
    id: webhook.id,
    message: 'Webhook processed successfully' 
  });
});

// Stripe webhook endpoint
app.post('/stripe-webhook', (req, res) => {
  const event = req.body;
  
  console.log('💳 Stripe webhook received:', {
    type: event.type,
    id: event.id,
    created: new Date(event.created * 1000).toISOString()
  });
  
  // Handle different event types
  switch (event.type) {
    case 'customer.balance_funded':
      console.log('💰 Balance funded:', event.data.object);
      break;
    case 'payment_intent.succeeded':
      console.log('✅ Payment succeeded:', event.data.object);
      break;
    case 'payment_intent.failed':
      console.log('❌ Payment failed:', event.data.object);
      break;
    default:
      console.log('🔔 Other event:', event.type);
  }
  
  webhooks.push({
    id: Date.now(),
    timestamp: new Date().toISOString(),
    stripeEvent: event,
    type: 'stripe'
  });
  
  res.json({ received: true });
});

// View all webhooks
app.get('/webhooks', (req, res) => {
  res.json({
    total: webhooks.length,
    webhooks: webhooks.slice(-20).reverse()
  });
});

// Clear webhooks
app.delete('/webhooks', (req, res) => {
  webhooks.length = 0;
  res.json({ message: 'All webhooks cleared' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Webhook server listening on port ${PORT}`);
  console.log(`📡 Public URL: http://172.171.97.248:1090`);
  console.log(`🔗 Local URL: http://localhost:${PORT}`);
  console.log('\nEndpoints:');
  console.log('  GET  / - Server status');
  console.log('  POST /webhook - General webhook receiver');
  console.log('  POST /stripe-webhook - Stripe webhook receiver');
  console.log('  GET  /webhooks - View received webhooks');
  console.log('  DELETE /webhooks - Clear webhook history');
});