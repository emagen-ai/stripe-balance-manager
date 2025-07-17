#!/usr/bin/env node

const crypto = require('crypto');

async function finalIntegrationTest() {
  console.log('🚀 最终集成测试');
  
  const baseUrl = 'https://balance-api-production-eafc.up.railway.app';
  
  // 使用已知的team_id进行测试
  const payload = {
    event_type: 'limit_exceeded',
    team_id: '4447bd54-a3fc-404a-a1c4-b8cc2319b50f', // 来自KMS的已知team_id
    organization_id: 'test_org_001',
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

  console.log('📦 发送测试负载:', JSON.stringify(payload, null, 2));
  console.log('🔐 使用签名:', signature);

  try {
    const response = await fetch(`${baseUrl}/webhooks/litellm/limit-exceeded`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': signature,
        'x-request-id': `final_test_${Date.now()}`
      },
      body: JSON.stringify(payload)
    });

    console.log('✅ 响应状态:', response.status);
    
    const responseText = await response.text();
    console.log('📋 完整响应:', responseText);

    if (response.status === 200) {
      try {
        const responseJson = JSON.parse(responseText);
        console.log('🎉 JSON响应:', JSON.stringify(responseJson, null, 2));
      } catch (e) {
        console.log('⚠️  无法解析JSON响应');
      }
    }

    // 检查事件记录
    console.log('\n📊 检查事件记录');
    const eventsResponse = await fetch(`${baseUrl}/webhooks/events?limit=5`);
    if (eventsResponse.ok) {
      const eventsData = await eventsResponse.json();
      console.log('📋 最新事件:', JSON.stringify(eventsData, null, 2));
    }

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  }
}

// 检查Node.js版本
if (typeof fetch === 'undefined') {
  console.error('❌ 需要Node.js 18+支持fetch API');
  process.exit(1);
}

finalIntegrationTest().catch(console.error);