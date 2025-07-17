#!/usr/bin/env node

const crypto = require('crypto');

async function testWithCorrectSecret() {
  console.log('🔐 使用正确的webhook密钥测试');
  
  const baseUrl = 'https://balance-api-production-eafc.up.railway.app';
  
  const payload = {
    event_type: 'limit_exceeded',
    team_id: '4447bd54-a3fc-404a-a1c4-b8cc2319b50f',
    organization_id: 'test_org_001',
    current_usage: 1500,
    current_limit: 1000,
    exceeded_by: 500,
    timestamp: new Date().toISOString()
  };

  // 尝试两个密钥
  const secrets = [
    'webhook-secret-key',         // 我设置的
    'default_webhook_secret'      // 代码中的默认值
  ];

  for (const secret of secrets) {
    console.log(`\n🔑 测试密钥: ${secret}`);
    
    const signature = `sha256=${crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(payload), 'utf8')
      .digest('hex')}`;

    try {
      const response = await fetch(`${baseUrl}/webhooks/litellm/limit-exceeded`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-signature': signature,
          'x-request-id': `secret_test_${Date.now()}`
        },
        body: JSON.stringify(payload)
      });

      console.log('📊 状态码:', response.status);
      const responseText = await response.text();
      console.log('📋 响应:', responseText.substring(0, 200));

      if (response.status === 200) {
        console.log('🎉 成功！找到正确的密钥');
        try {
          const responseJson = JSON.parse(responseText);
          console.log('✅ 完整响应:', JSON.stringify(responseJson, null, 2));
        } catch (e) {
          console.log('响应不是JSON格式');
        }
        break;
      }

    } catch (error) {
      console.error('❌ 请求失败:', error.message);
    }
  }
}

testWithCorrectSecret().catch(console.error);