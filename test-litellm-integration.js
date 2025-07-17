#!/usr/bin/env node

const crypto = require('crypto');

console.log('🧪 LiteLLM集成测试');

// 测试webhook签名生成
function generateTestSignature() {
  const payload = {
    event_type: 'limit_exceeded',
    team_id: 'test-team-123',
    organization_id: 'test-org-123',
    current_usage: 1500,
    current_limit: 1000,
    exceeded_by: 500,
    timestamp: new Date().toISOString()
  };

  const payloadString = JSON.stringify(payload);
  const secret = process.env.WEBHOOK_SECRET || 'webhook-secret-key';
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payloadString, 'utf8')
    .digest('hex');

  return {
    payload,
    signature: `sha256=${signature}`,
    payloadString
  };
}

// 测试webhook调用
async function testWebhookCall() {
  const { payload, signature } = generateTestSignature();
  const url = process.env.WEBHOOK_URL || 'https://balance-api-production-eafc.up.railway.app/webhooks/litellm/limit-exceeded';

  console.log('📡 发送测试webhook到:', url);
  console.log('📦 负载:', JSON.stringify(payload, null, 2));
  console.log('🔐 签名:', signature);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': signature,
        'x-request-id': `test_${Date.now()}`
      },
      body: JSON.stringify(payload)
    });

    console.log('✅ 响应状态:', response.status);
    
    const responseText = await response.text();
    console.log('📋 响应内容:', responseText);

    if (response.headers.get('content-type')?.includes('application/json')) {
      try {
        const responseJson = JSON.parse(responseText);
        console.log('📊 JSON响应:', JSON.stringify(responseJson, null, 2));
      } catch (e) {
        console.log('⚠️  无法解析JSON响应');
      }
    }

  } catch (error) {
    console.error('❌ Webhook调用失败:', error.message);
  }
}

// 测试KMS API连接
async function testKMSConnection() {
  const baseUrl = 'http://172.171.97.248:3090';
  
  console.log('\n🔌 测试KMS API连接');
  
  try {
    const response = await fetch(`${baseUrl}/organizations`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 5000
    });

    console.log('KMS响应状态:', response.status);
    
    if (response.ok) {
      const data = await response.json();
      console.log('KMS组织数据:', JSON.stringify(data, null, 2));
    } else {
      console.log('KMS响应错误:', await response.text());
    }

  } catch (error) {
    console.error('❌ KMS连接失败:', error.message);
  }
}

// 运行所有测试
async function runTests() {
  console.log('🚀 开始集成测试\n');
  
  await testKMSConnection();
  console.log('\n' + '='.repeat(50) + '\n');
  await testWebhookCall();
  
  console.log('\n✨ 测试完成');
}

// 检查Node.js版本是否支持fetch
if (typeof fetch === 'undefined') {
  console.error('❌ 需要Node.js 18+支持fetch API');
  process.exit(1);
}

runTests().catch(console.error);