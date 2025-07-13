const https = require('https');

const API_URL = 'https://balance-api-production-eafc.up.railway.app';
const TEST_USER_ID = 'cmd19la3k0000d3bvxl8nch31';

async function testCustomerPortal() {
  console.log('🧪 Testing Stripe Customer Portal Integration\n');
  
  const postData = JSON.stringify({
    returnUrl: `${API_URL}/payment-success.html?userId=${TEST_USER_ID}`
  });

  const options = {
    hostname: 'balance-api-production-eafc.up.railway.app',
    port: 443,
    path: `/api/payment/portal/${TEST_USER_ID}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': TEST_USER_ID,
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`Status Code: ${res.statusCode}`);
        console.log(`Response: ${data}\n`);
        
        try {
          const response = JSON.parse(data);
          if (response.success && response.portalUrl) {
            console.log('✅ Customer Portal session created successfully!');
            console.log(`🔗 Portal URL: ${response.portalUrl}`);
            console.log('\n📋 Instructions:');
            console.log('1. Copy the Portal URL above');
            console.log('2. Open it in your browser');
            console.log('3. Add a test payment method using:');
            console.log('   - Card: 4242424242424242');
            console.log('   - Expiry: Any future date');
            console.log('   - CVC: Any 3 digits');
            console.log('4. The portal will redirect back to your app');
          } else {
            console.log('❌ Failed to create portal session');
            console.log('🛠️  This likely means the Customer Portal is not configured yet');
            console.log('📖 Follow the configuration steps to set it up');
          }
        } catch (error) {
          console.log('❌ Invalid JSON response');
        }
        resolve();
      });
    });

    req.on('error', (error) => {
      console.error('❌ Request failed:', error.message);
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

testCustomerPortal().catch(console.error);