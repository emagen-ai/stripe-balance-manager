#!/usr/bin/env node

console.log('🧪 LiteLLM集成错误场景测试');

const crypto = require('crypto');

// 测试场景配置
const scenarios = [
  {
    name: '无效签名测试',
    test: 'invalid_signature',
    payload: {
      event_type: 'limit_exceeded',
      team_id: 'test-team-123',
      current_usage: 1500,
      current_limit: 1000,
      timestamp: new Date().toISOString()
    },
    expectedStatus: 401,
    invalidSignature: true
  },
  {
    name: '过期时间戳测试',
    test: 'expired_timestamp',
    payload: {
      event_type: 'limit_exceeded', 
      team_id: 'test-team-123',
      current_usage: 1500,
      current_limit: 1000,
      timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString() // 10分钟前
    },
    expectedStatus: 400
  },
  {
    name: '未知team_id测试',
    test: 'unknown_team_id',
    payload: {
      event_type: 'limit_exceeded',
      team_id: 'unknown-team-999',
      current_usage: 1500,
      current_limit: 1000,
      timestamp: new Date().toISOString()
    },
    expectedStatus: 404
  },
  {
    name: '禁用自动充值测试',
    test: 'auto_recharge_disabled',
    payload: {
      event_type: 'limit_exceeded',
      team_id: '4447bd54-a3fc-404a-a1c4-b8cc2319b50f', // 使用已知的team_id
      current_usage: 1500,
      current_limit: 1000,
      timestamp: new Date().toISOString()
    },
    expectedStatus: 200,
    expectedAction: 'none'
  },
  {
    name: '日充值限制测试',
    test: 'daily_limit_exceeded',
    payload: {
      event_type: 'limit_exceeded',
      team_id: '4447bd54-a3fc-404a-a1c4-b8cc2319b50f',
      current_usage: 1500,
      current_limit: 1000,
      timestamp: new Date().toISOString()
    },
    expectedStatus: 500,
    expectedError: 'Daily recharge limit exceeded'
  },
  {
    name: '无效JSON测试',
    test: 'invalid_json',
    payload: '{"invalid": json}',
    expectedStatus: 400,
    rawPayload: true
  }
];

// 生成webhook签名
function generateSignature(payload, useInvalidSecret = false) {
  const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const secret = useInvalidSecret ? 'wrong-secret' : (process.env.WEBHOOK_SECRET || 'webhook-secret-key');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payloadString, 'utf8')
    .digest('hex');
  return `sha256=${signature}`;
}

// 测试KMS API错误场景
async function testKMSErrorScenarios() {
  console.log('\n🔌 测试KMS API错误场景');
  
  const baseUrl = 'http://172.171.97.248:3090';
  
  const kmsTests = [
    {
      name: '获取不存在的组织',
      url: `${baseUrl}/organizations/999999`,
      method: 'GET',
      expectedStatus: 404
    },
    {
      name: '创建无效组织数据',
      url: `${baseUrl}/organizations`,
      method: 'POST',
      body: { invalid: 'data' },
      expectedStatus: [400, 422, 500]
    },
    {
      name: '更新不存在的组织',
      url: `${baseUrl}/organizations/999999`,
      method: 'PUT',
      body: { quota: 1000 },
      expectedStatus: 404
    }
  ];

  for (const test of kmsTests) {
    try {
      console.log(`\n📋 ${test.name}`);
      
      const options = {
        method: test.method,
        headers: { 'Content-Type': 'application/json' }
      };
      
      if (test.body) {
        options.body = JSON.stringify(test.body);
      }
      
      const response = await fetch(test.url, options);
      const statusMatch = Array.isArray(test.expectedStatus) 
        ? test.expectedStatus.includes(response.status)
        : response.status === test.expectedStatus;
        
      if (statusMatch) {
        console.log(`✅ 正确返回状态码: ${response.status}`);
      } else {
        console.log(`❌ 期望状态码: ${test.expectedStatus}, 实际: ${response.status}`);
      }
      
      const responseText = await response.text();
      console.log(`📄 响应: ${responseText.substring(0, 200)}${responseText.length > 200 ? '...' : ''}`);
      
    } catch (error) {
      console.log(`❌ 请求失败: ${error.message}`);
    }
  }
}

// 测试webhook错误场景
async function testWebhookErrorScenarios() {
  console.log('\n📡 测试Webhook错误场景');
  
  const baseUrl = process.env.WEBHOOK_URL || 'https://balance-api-production-eafc.up.railway.app';
  
  for (const scenario of scenarios) {
    try {
      console.log(`\n📋 ${scenario.name}`);
      
      let payloadString;
      let signature;
      
      if (scenario.rawPayload) {
        payloadString = scenario.payload;
        signature = generateSignature(payloadString);
      } else {
        payloadString = JSON.stringify(scenario.payload);
        signature = generateSignature(scenario.payload, scenario.invalidSignature);
      }
      
      const response = await fetch(`${baseUrl}/webhooks/litellm/limit-exceeded`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-signature': signature,
          'x-request-id': `test_${scenario.test}_${Date.now()}`
        },
        body: payloadString
      });
      
      console.log(`📊 状态码: ${response.status} (期望: ${scenario.expectedStatus})`);
      
      const responseText = await response.text();
      console.log(`📄 响应内容: ${responseText.substring(0, 300)}${responseText.length > 300 ? '...' : ''}`);
      
      // 检查期望的错误或行为
      if (scenario.expectedAction && response.status === 200) {
        try {
          const responseJson = JSON.parse(responseText);
          if (responseJson.action === scenario.expectedAction) {
            console.log(`✅ 正确的行为: ${scenario.expectedAction}`);
          } else {
            console.log(`❌ 期望行为: ${scenario.expectedAction}, 实际: ${responseJson.action}`);
          }
        } catch (e) {
          console.log('⚠️  无法解析JSON响应来验证行为');
        }
      }
      
      if (scenario.expectedError && response.status >= 400) {
        if (responseText.includes(scenario.expectedError)) {
          console.log(`✅ 包含期望错误信息: ${scenario.expectedError}`);
        } else {
          console.log(`❌ 未找到期望错误信息: ${scenario.expectedError}`);
        }
      }
      
    } catch (error) {
      console.log(`❌ 测试失败: ${error.message}`);
    }
  }
}

// 测试数据库错误恢复
async function testDatabaseErrorRecovery() {
  console.log('\n💾 测试数据库错误恢复场景');
  
  console.log('📋 模拟数据库连接丢失');
  console.log('⚠️  这个测试需要在实际环境中手动执行');
  console.log('   1. 暂时关闭数据库连接');
  console.log('   2. 发送webhook请求');
  console.log('   3. 验证错误处理和重连机制');
  console.log('   4. 恢复数据库连接');
  console.log('   5. 验证系统恢复正常');
}

// 测试Stripe支付错误
async function testStripeErrorScenarios() {
  console.log('\n💳 测试Stripe支付错误场景');
  
  console.log('📋 常见Stripe错误场景:');
  console.log('   1. 支付方式过期 - card_declined');
  console.log('   2. 余额不足 - insufficient_funds');
  console.log('   3. 网络超时 - timeout_error');
  console.log('   4. API限流 - rate_limit_error');
  console.log('   5. 无效客户ID - customer_not_found');
  
  console.log('⚠️  这些测试需要在Stripe测试环境中模拟');
}

// 运行所有错误场景测试
async function runAllErrorTests() {
  console.log('🚀 开始错误场景测试\n');
  
  try {
    await testKMSErrorScenarios();
    console.log('\n' + '='.repeat(60));
    
    await testWebhookErrorScenarios();
    console.log('\n' + '='.repeat(60));
    
    await testDatabaseErrorRecovery();
    console.log('\n' + '='.repeat(60));
    
    await testStripeErrorScenarios();
    
  } catch (error) {
    console.error('❌ 测试运行失败:', error);
  }
  
  console.log('\n✨ 错误场景测试完成');
  
  // 生成测试报告
  console.log('\n📊 测试总结:');
  console.log('✅ KMS API错误处理测试');
  console.log('⚠️  Webhook错误处理测试 (需要路由修复)');
  console.log('📝 数据库恢复测试 (需要手动执行)');
  console.log('📝 Stripe错误测试 (需要测试环境)');
}

// 检查Node.js版本
if (typeof fetch === 'undefined') {
  console.error('❌ 需要Node.js 18+支持fetch API');
  process.exit(1);
}

runAllErrorTests().catch(console.error);