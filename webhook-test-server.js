#!/usr/bin/env node

const express = require('express');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 3002;

app.use(express.json());

// 简化的webhook签名验证
function verifySignature(payload, signature) {
  const secret = process.env.WEBHOOK_SECRET || 'webhook-secret-key';
  const expectedSignature = `sha256=${crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload), 'utf8')
    .digest('hex')}`;
  return signature === expectedSignature;
}

// LiteLLM Webhook端点
app.post('/webhooks/litellm/limit-exceeded', (req, res) => {
  console.log('🔔 收到webhook请求:', {
    headers: req.headers,
    body: req.body
  });

  const signature = req.headers['x-webhook-signature'];
  
  if (!signature) {
    return res.status(401).json({ error: 'Missing signature' });
  }

  if (!verifySignature(req.body, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const payload = req.body;
  
  // 模拟处理逻辑
  console.log('✅ Webhook签名验证通过');
  console.log('📋 处理组织:', payload.team_id);
  console.log('💰 超限金额:', payload.exceeded_by);
  
  res.json({
    success: true,
    message: 'Webhook处理成功',
    team_id: payload.team_id,
    action: 'auto_recharged',
    recharged_amount: payload.exceeded_by || 500
  });
});

// 测试端点
app.get('/webhooks/events', (req, res) => {
  res.json({
    success: true,
    events: [
      {
        id: 'test_event_1',
        event_type: 'limit_exceeded',
        team_id: 'test-team-123',
        processed: true,
        success: true
      }
    ]
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'webhook-test-server',
    timestamp: new Date().toISOString()
  });
});

app.listen(port, () => {
  console.log(`🚀 Webhook测试服务器启动在端口 ${port}`);
  console.log(`📡 测试端点: http://localhost:${port}/webhooks/litellm/limit-exceeded`);
});

process.on('SIGINT', () => {
  console.log('\n👋 服务器关闭');
  process.exit(0);
});