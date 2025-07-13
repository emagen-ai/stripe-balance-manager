require('dotenv').config();
const http = require('http');

const USER_ID = 'cmd19la3k0000d3bvxl8nch31';
const BASE_URL = 'http://localhost:3000';

function makeRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const response = {
            statusCode: res.statusCode,
            headers: res.headers,
            body: body ? JSON.parse(body) : null
          };
          resolve(response);
        } catch (error) {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: body
          });
        }
      });
    });

    req.on('error', reject);
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

async function testEndpoints() {
  console.log('🧪 Testing API Endpoints\n');

  try {
    // Test health endpoint
    console.log('1. Testing health endpoint...');
    const healthResponse = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/health',
      method: 'GET'
    });
    console.log('✅ Health check:', healthResponse.statusCode, healthResponse.body);

    // Test balance status
    console.log('\n2. Testing balance status...');
    const statusResponse = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: `/api/balance/status/${USER_ID}`,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': USER_ID
      }
    });
    console.log('✅ Balance status:', statusResponse.statusCode);
    console.log('   Response:', JSON.stringify(statusResponse.body, null, 2));

    // Test balance config
    console.log('\n3. Testing balance config...');
    const configResponse = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: `/api/balance/config/${USER_ID}`,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': USER_ID
      }
    });
    console.log('✅ Balance config:', configResponse.statusCode);
    console.log('   Response:', JSON.stringify(configResponse.body, null, 2));

    // Test manual recharge (this might fail due to no payment method)
    console.log('\n4. Testing manual recharge...');
    const rechargeResponse = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: `/api/balance/recharge/${USER_ID}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': USER_ID
      }
    });
    console.log('✅ Manual recharge:', rechargeResponse.statusCode);
    console.log('   Response:', JSON.stringify(rechargeResponse.body, null, 2));

    console.log('\n🎉 API endpoint testing completed!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Start server and run tests
async function runTests() {
  console.log('Starting API server...');
  
  // Import and start the app
  const app = require('./dist/app');
  const server = app.listen(3000, () => {
    console.log('✅ Server started on port 3000\n');
    
    // Wait a moment for server to be ready
    setTimeout(async () => {
      await testEndpoints();
      server.close();
      process.exit(0);
    }, 2000);
  });
}

runTests();