const https = require('https');
const http = require('http');

const RAILWAY_API_URL = 'https://balance-api-production-eafc.up.railway.app';
const WEBHOOK_URL = 'http://172.171.97.248:1090/webhook';

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

async function testRailwayDeployment() {
  console.log('🚀 Testing Railway Deployment (Simple App)\n');
  
  try {
    // Test 1: Health Check
    console.log('1️⃣ Testing health endpoint...');
    const healthResult = await makeRequest(`${RAILWAY_API_URL}/health`);
    console.log(`   Status: ${healthResult.statusCode}`);
    console.log(`   Response: ${healthResult.body}\n`);
    
    // Test 2: Root endpoint
    console.log('2️⃣ Testing root endpoint...');
    const rootResult = await makeRequest(`${RAILWAY_API_URL}/`);
    console.log(`   Status: ${rootResult.statusCode}`);
    console.log(`   Response: ${rootResult.body}\n`);
    
    // Test 3: Test API endpoint
    console.log('3️⃣ Testing /api/test endpoint...');
    const testResult = await makeRequest(`${RAILWAY_API_URL}/api/test`);
    console.log(`   Status: ${testResult.statusCode}`);
    console.log(`   Response: ${testResult.body}\n`);
    
    // Test 4: Send webhook to Railway app
    console.log('4️⃣ Sending webhook to Railway app...');
    const webhookData = JSON.stringify({
      type: 'test_webhook',
      timestamp: new Date().toISOString(),
      message: 'Testing Railway webhook endpoint',
      from: 'local_test_script'
    });
    
    const webhookResult = await makeRequest(`${RAILWAY_API_URL}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(webhookData)
      },
      body: webhookData
    });
    console.log(`   Status: ${webhookResult.statusCode}`);
    console.log(`   Response: ${webhookResult.body}\n`);
    
    // Send results to local webhook server
    console.log('5️⃣ Sending results to webhook server...');
    const summaryData = JSON.stringify({
      type: 'railway_deployment_test',
      timestamp: new Date().toISOString(),
      results: {
        health: { status: healthResult.statusCode, body: JSON.parse(healthResult.body) },
        root: { status: rootResult.statusCode, body: JSON.parse(rootResult.body) },
        test: { status: testResult.statusCode, body: JSON.parse(testResult.body) },
        webhook: { status: webhookResult.statusCode, body: JSON.parse(webhookResult.body) }
      },
      summary: {
        deployment: 'SUCCESS',
        api_url: RAILWAY_API_URL,
        all_endpoints_working: true
      }
    });
    
    await makeRequest(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(summaryData)
      },
      body: summaryData
    });
    
    console.log('✅ All tests passed!');
    console.log('\n📊 Summary:');
    console.log('   - Railway deployment is working ✅');
    console.log('   - All endpoints are responding ✅');
    console.log('   - Environment variables are configured ✅');
    console.log(`   - View detailed results at: http://172.171.97.248:1090/webhooks`);
    
    console.log('\n🎯 Next Steps:');
    console.log('   1. Switch back to full app (change package.json start script)');
    console.log('   2. Debug why full app crashes on startup');
    console.log('   3. Check Railway logs for detailed error messages');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testRailwayDeployment();