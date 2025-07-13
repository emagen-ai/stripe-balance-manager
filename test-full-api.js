const https = require('https');
const http = require('http');

const API_URL = 'https://balance-api-production-eafc.up.railway.app';
const WEBHOOK_URL = 'http://172.171.97.248:1090/webhook';
const TEST_USER_ID = 'cmd19la3k0000d3bvxl8nch31';

async function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https');
    const client = isHttps ? https : http;
    
    const req = client.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });
    
    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function sendWebhook(message, data) {
  try {
    const webhookData = JSON.stringify({
      type: 'full_api_test',
      message,
      timestamp: new Date().toISOString(),
      data
    });
    
    await makeRequest(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(webhookData)
      },
      body: webhookData
    });
  } catch (error) {
    console.error('Webhook error:', error.message);
  }
}

async function testFullAPI() {
  console.log('🎯 Testing Full Balance Manager API\n');
  
  try {
    // Test 1: Health Check
    console.log('1️⃣ Health check...');
    const health = await makeRequest(`${API_URL}/health`);
    console.log(`   Status: ${health.statusCode}`);
    console.log(`   Response: ${health.body}\n`);
    await sendWebhook('Health check', JSON.parse(health.body));
    
    // Test 2: Balance Status
    console.log('2️⃣ Balance status...');
    const status = await makeRequest(`${API_URL}/api/balance/status/${TEST_USER_ID}`, {
      method: 'GET',
      headers: {
        'x-user-id': TEST_USER_ID,
        'Content-Type': 'application/json'
      }
    });
    console.log(`   Status: ${status.statusCode}`);
    console.log(`   Response: ${status.body}\n`);
    await sendWebhook('Balance status', {
      statusCode: status.statusCode,
      response: status.statusCode === 200 ? JSON.parse(status.body) : status.body
    });
    
    // Test 3: Balance Config
    console.log('3️⃣ Balance config...');
    const config = await makeRequest(`${API_URL}/api/balance/config/${TEST_USER_ID}`, {
      method: 'GET',
      headers: {
        'x-user-id': TEST_USER_ID,
        'Content-Type': 'application/json'
      }
    });
    console.log(`   Status: ${config.statusCode}`);
    console.log(`   Response: ${config.body}\n`);
    await sendWebhook('Balance config', {
      statusCode: config.statusCode,
      response: config.statusCode === 200 ? JSON.parse(config.body) : config.body
    });
    
    // Test 4: Update Config
    console.log('4️⃣ Update config...');
    const updateData = JSON.stringify({
      minimumBalance: 150,
      targetBalance: 600,
      autoRechargeEnabled: true,
      maxDailyRecharges: 5
    });
    
    const updateConfig = await makeRequest(`${API_URL}/api/balance/config/${TEST_USER_ID}`, {
      method: 'POST',
      headers: {
        'x-user-id': TEST_USER_ID,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(updateData)
      },
      body: updateData
    });
    console.log(`   Status: ${updateConfig.statusCode}`);
    console.log(`   Response: ${updateConfig.body}\n`);
    await sendWebhook('Config update', {
      statusCode: updateConfig.statusCode,
      response: updateConfig.statusCode === 200 ? JSON.parse(updateConfig.body) : updateConfig.body
    });
    
    // Test 5: Recharge History
    console.log('5️⃣ Recharge history...');
    const history = await makeRequest(`${API_URL}/api/balance/history/${TEST_USER_ID}`, {
      method: 'GET',
      headers: {
        'x-user-id': TEST_USER_ID,
        'Content-Type': 'application/json'
      }
    });
    console.log(`   Status: ${history.statusCode}`);
    console.log(`   Response: ${history.body}\n`);
    await sendWebhook('Recharge history', {
      statusCode: history.statusCode,
      response: history.statusCode === 200 ? JSON.parse(history.body) : history.body
    });
    
    // Test 6: Manual Recharge Trigger
    console.log('6️⃣ Manual recharge trigger...');
    const recharge = await makeRequest(`${API_URL}/api/balance/recharge/${TEST_USER_ID}`, {
      method: 'POST',
      headers: {
        'x-user-id': TEST_USER_ID,
        'Content-Type': 'application/json'
      }
    });
    console.log(`   Status: ${recharge.statusCode}`);
    console.log(`   Response: ${recharge.body}\n`);
    await sendWebhook('Manual recharge', {
      statusCode: recharge.statusCode,
      response: recharge.statusCode === 200 ? JSON.parse(recharge.body) : recharge.body
    });
    
    // Test 7: Admin Trigger
    console.log('7️⃣ Admin recharge trigger...');
    const adminTrigger = await makeRequest(`${API_URL}/api/admin/trigger-recharge`);
    console.log(`   Status: ${adminTrigger.statusCode}`);
    console.log(`   Response: ${adminTrigger.body}\n`);
    await sendWebhook('Admin trigger', {
      statusCode: adminTrigger.statusCode,
      response: adminTrigger.statusCode === 200 ? JSON.parse(adminTrigger.body) : adminTrigger.body
    });
    
    // Summary
    console.log('📊 API Test Summary:');
    console.log(`   Health: ${health.statusCode === 200 ? '✅' : '❌'} (${health.statusCode})`);
    console.log(`   Balance Status: ${status.statusCode === 200 ? '✅' : '❌'} (${status.statusCode})`);
    console.log(`   Balance Config: ${config.statusCode === 200 ? '✅' : '❌'} (${config.statusCode})`);
    console.log(`   Config Update: ${updateConfig.statusCode === 200 ? '✅' : '❌'} (${updateConfig.statusCode})`);
    console.log(`   Recharge History: ${history.statusCode === 200 ? '✅' : '❌'} (${history.statusCode})`);
    console.log(`   Manual Recharge: ${recharge.statusCode === 200 ? '✅' : '❌'} (${recharge.statusCode})`);
    console.log(`   Admin Trigger: ${adminTrigger.statusCode === 200 ? '✅' : '❌'} (${adminTrigger.statusCode})`);
    
    await sendWebhook('Full API test complete', {
      summary: {
        health: health.statusCode,
        balanceStatus: status.statusCode,
        balanceConfig: config.statusCode,
        configUpdate: updateConfig.statusCode,
        rechargeHistory: history.statusCode,
        manualRecharge: recharge.statusCode,
        adminTrigger: adminTrigger.statusCode
      },
      testUser: TEST_USER_ID,
      apiUrl: API_URL
    });
    
    console.log('\n🎉 Full API testing complete!');
    console.log('   View detailed results at: http://172.171.97.248:1090/webhooks');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    await sendWebhook('Full API test failed', { error: error.message });
  }
}

testFullAPI();