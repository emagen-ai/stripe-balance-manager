const https = require('https');
const http = require('http');

const RAILWAY_API_URL = 'https://balance-api-production-eafc.up.railway.app';
const WEBHOOK_URL = 'http://172.171.97.248:1090/webhook';
const TEST_USER_ID = 'cmd19la3k0000d3bvxl8nch31';

function makeRequest(url, options = {}) {
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

async function sendWebhook(message, data = {}) {
  try {
    const webhookData = JSON.stringify({
      type: 'railway_test',
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
    console.log(`📤 Webhook sent: ${message}`);
  } catch (error) {
    console.error('❌ Webhook error:', error.message);
  }
}

async function testRailwayAPI() {
  console.log('🧪 Testing Railway Deployment\n');
  console.log(`API URL: ${RAILWAY_API_URL}`);
  console.log(`Webhook URL: ${WEBHOOK_URL}\n`);
  
  try {
    // Test 1: Health Check
    console.log('1️⃣ Testing health endpoint...');
    await sendWebhook('Starting Railway API tests');
    
    const healthResult = await makeRequest(`${RAILWAY_API_URL}/health`);
    console.log(`   Status: ${healthResult.statusCode}`);
    console.log(`   Response: ${healthResult.body}\n`);
    
    await sendWebhook('Health check completed', {
      status: healthResult.statusCode,
      response: healthResult.body
    });
    
    // Test 2: Balance Status (with auth header)
    console.log('2️⃣ Testing balance status endpoint...');
    const statusUrl = `${RAILWAY_API_URL}/api/balance/status/${TEST_USER_ID}`;
    const statusResult = await makeRequest(statusUrl, {
      method: 'GET',
      headers: {
        'x-user-id': TEST_USER_ID,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`   Status: ${statusResult.statusCode}`);
    console.log(`   Response: ${statusResult.body}\n`);
    
    await sendWebhook('Balance status check', {
      status: statusResult.statusCode,
      response: statusResult.body,
      userId: TEST_USER_ID
    });
    
    // Test 3: Balance Config
    console.log('3️⃣ Testing balance config endpoint...');
    const configUrl = `${RAILWAY_API_URL}/api/balance/config/${TEST_USER_ID}`;
    const configResult = await makeRequest(configUrl, {
      method: 'GET',
      headers: {
        'x-user-id': TEST_USER_ID,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`   Status: ${configResult.statusCode}`);
    console.log(`   Response: ${configResult.body}\n`);
    
    await sendWebhook('Balance config check', {
      status: configResult.statusCode,
      response: configResult.body
    });
    
    // Test 4: Recharge History
    console.log('4️⃣ Testing recharge history endpoint...');
    const historyUrl = `${RAILWAY_API_URL}/api/balance/history/${TEST_USER_ID}`;
    const historyResult = await makeRequest(historyUrl, {
      method: 'GET',
      headers: {
        'x-user-id': TEST_USER_ID,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`   Status: ${historyResult.statusCode}`);
    console.log(`   Response: ${historyResult.body}\n`);
    
    await sendWebhook('Recharge history check', {
      status: historyResult.statusCode,
      response: historyResult.body
    });
    
    // Summary
    console.log('📊 Test Summary:');
    console.log(`   Health: ${healthResult.statusCode === 200 ? '✅' : '❌'}`);
    console.log(`   Balance Status: ${statusResult.statusCode === 200 ? '✅' : '❌'}`);
    console.log(`   Balance Config: ${configResult.statusCode === 200 ? '✅' : '❌'}`);
    console.log(`   Recharge History: ${historyResult.statusCode === 200 ? '✅' : '❌'}`);
    
    await sendWebhook('Railway API tests completed', {
      health: healthResult.statusCode,
      balanceStatus: statusResult.statusCode,
      balanceConfig: configResult.statusCode,
      rechargeHistory: historyResult.statusCode
    });
    
    console.log('\n✅ Tests completed! Check webhook server for detailed logs.');
    console.log('   View webhooks at: http://172.171.97.248:1090/webhooks');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    await sendWebhook('Railway API test failed', {
      error: error.message
    });
  }
}

testRailwayAPI();