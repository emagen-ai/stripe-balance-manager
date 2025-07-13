const https = require('https');
const http = require('http');

const API_URL = 'https://balance-api-production-eafc.up.railway.app';
const WEBHOOK_URL = 'http://172.171.97.248:1090/webhook';

async function makeRequest(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          body: data
        });
      });
    }).on('error', reject);
  });
}

async function sendWebhook(message, data) {
  const webhookData = JSON.stringify({
    type: 'progressive_test',
    message,
    timestamp: new Date().toISOString(),
    data
  });
  
  return new Promise((resolve, reject) => {
    const req = http.request(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(webhookData)
      }
    }, (res) => {
      res.on('data', () => {});
      res.on('end', () => resolve());
    });
    
    req.on('error', reject);
    req.write(webhookData);
    req.end();
  });
}

async function testProgressive() {
  console.log('🧪 Testing Progressive Deployment\n');
  
  try {
    // Test 1: Health Check
    console.log('1️⃣ Health check...');
    const health = await makeRequest(`${API_URL}/health`);
    console.log(`   Status: ${health.statusCode}`);
    console.log(`   Response: ${health.body}\n`);
    await sendWebhook('Health check', JSON.parse(health.body));
    
    // Test 2: Database Connection
    console.log('2️⃣ Testing database connection...');
    const db = await makeRequest(`${API_URL}/test/database`);
    console.log(`   Status: ${db.statusCode}`);
    console.log(`   Response: ${db.body}\n`);
    await sendWebhook('Database test', JSON.parse(db.body));
    
    // Test 3: Routes Loading
    console.log('3️⃣ Testing routes loading...');
    const routes = await makeRequest(`${API_URL}/test/routes`);
    console.log(`   Status: ${routes.statusCode}`);
    console.log(`   Response: ${routes.body}\n`);
    await sendWebhook('Routes test', JSON.parse(routes.body));
    
    // Test 4: Scheduler
    console.log('4️⃣ Testing scheduler...');
    const scheduler = await makeRequest(`${API_URL}/test/scheduler`);
    console.log(`   Status: ${scheduler.statusCode}`);
    console.log(`   Response: ${scheduler.body}\n`);
    await sendWebhook('Scheduler test', JSON.parse(scheduler.body));
    
    // Summary
    const healthData = JSON.parse(health.body);
    const dbData = db.statusCode === 200 ? JSON.parse(db.body) : { success: false };
    const routesData = routes.statusCode === 200 ? JSON.parse(routes.body) : { success: false };
    const schedulerData = scheduler.statusCode === 200 ? JSON.parse(scheduler.body) : { success: false };
    
    console.log('📊 Component Status:');
    console.log(`   Server: ${health.statusCode === 200 ? '✅' : '❌'}`);
    console.log(`   Database: ${dbData.success ? '✅' : '❌'}`);
    console.log(`   Routes: ${routesData.success ? '✅' : '❌'}`);
    console.log(`   Scheduler: ${schedulerData.success ? '✅' : '❌'}`);
    
    await sendWebhook('Progressive test complete', {
      server: health.statusCode === 200,
      database: dbData.success,
      routes: routesData.success,
      scheduler: schedulerData.success
    });
    
    console.log('\n✅ Progressive testing complete!');
    console.log('   View detailed results at: http://172.171.97.248:1090/webhooks');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    await sendWebhook('Progressive test failed', { error: error.message });
  }
}

testProgressive();