#!/usr/bin/env node

const crypto = require('crypto');

async function testLocalWebhook() {
  console.log('🧪 测试本地Webhook功能');
  
  const payload = {
    event_type: 'limit_exceeded',
    team_id: 'test-team-123',
    organization_id: 'test-org-123',
    current_usage: 1500,
    current_limit: 1000,
    exceeded_by: 500,
    timestamp: new Date().toISOString()
  };

  const secret = 'webhook-secret-key';
  const signature = `sha256=${crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload), 'utf8')
    .digest('hex')}`;

  console.log('📦 发送负载:', payload);
  console.log('🔐 签名:', signature);

  try {
    const response = await fetch('http://localhost:3003/webhooks/litellm/limit-exceeded', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': signature,
        'x-request-id': `test_${Date.now()}`
      },
      body: JSON.stringify(payload)
    });

    console.log('✅ 响应状态:', response.status);
    const responseJson = await response.json();
    console.log('📋 响应数据:', JSON.stringify(responseJson, null, 2));

    // 测试events端点
    console.log('\n📊 测试events端点');
    const eventsResponse = await fetch('http://localhost:3003/webhooks/events');
    const eventsData = await eventsResponse.json();
    console.log('📋 Events数据:', JSON.stringify(eventsData, null, 2));

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  }
}

// 检查Node.js版本
if (typeof fetch === 'undefined') {
  console.error('❌ 需要Node.js 18+支持fetch API');
  process.exit(1);
}

testLocalWebhook().catch(console.error);