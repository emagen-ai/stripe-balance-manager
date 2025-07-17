#!/usr/bin/env node

const crypto = require('crypto');

async function testProductionWebhook() {
  console.log('🧪 测试生产环境Webhook');
  
  const baseUrl = 'https://balance-api-production-eafc.up.railway.app';
  
  // 先测试健康检查
  console.log('\n🔍 检查服务健康状态');
  try {
    const healthResponse = await fetch(`${baseUrl}/health`);
    const healthData = await healthResponse.json();
    console.log('✅ 健康状态:', JSON.stringify(healthData, null, 2));
  } catch (error) {
    console.error('❌ 健康检查失败:', error.message);
    return;
  }

  // 测试管理端点
  console.log('\n🔧 测试管理端点');
  try {
    const adminResponse = await fetch(`${baseUrl}/api/admin/trigger-recharge`);
    console.log('📊 管理端点状态:', adminResponse.status);
    if (adminResponse.ok) {
      const adminData = await adminResponse.json();
      console.log('✅ 管理响应:', JSON.stringify(adminData, null, 2));
    } else {
      const adminError = await adminResponse.text();
      console.log('⚠️  管理端点错误:', adminError);
    }
  } catch (error) {
    console.error('❌ 管理端点失败:', error.message);
  }

  // 测试webhook端点存在性（不发送签名）
  console.log('\n📡 测试Webhook端点可访问性');
  try {
    const webhookResponse = await fetch(`${baseUrl}/webhooks/litellm/limit-exceeded`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: 'ping' })
    });
    
    console.log('📊 Webhook端点状态:', webhookResponse.status);
    const webhookText = await webhookResponse.text();
    console.log('📋 Webhook响应:', webhookText.substring(0, 300));
    
    if (webhookResponse.status === 401) {
      console.log('✅ Webhook端点存在（签名验证失败是正常的）');
    } else if (webhookResponse.status === 404) {
      console.log('❌ Webhook端点不存在');
    }
    
  } catch (error) {
    console.error('❌ Webhook测试失败:', error.message);
  }

  // 测试events端点
  console.log('\n📊 测试Events端点');
  try {
    const eventsResponse = await fetch(`${baseUrl}/webhooks/events`);
    console.log('📊 Events端点状态:', eventsResponse.status);
    
    if (eventsResponse.ok) {
      const eventsData = await eventsResponse.json();
      console.log('✅ Events响应:', JSON.stringify(eventsData, null, 2));
    } else {
      const eventsError = await eventsResponse.text();
      console.log('⚠️  Events错误:', eventsError.substring(0, 200));
    }
  } catch (error) {
    console.error('❌ Events测试失败:', error.message);
  }
}

// 检查Node.js版本
if (typeof fetch === 'undefined') {
  console.error('❌ 需要Node.js 18+支持fetch API');
  process.exit(1);
}

testProductionWebhook().catch(console.error);