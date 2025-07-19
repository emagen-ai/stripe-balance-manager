const axios = require('axios');

async function testPaymentMethodsEndpoint() {
  const organizationId = 'org_01JY6WTE4T4N41FZ0TVA0TFVVX';
  const baseUrl = 'http://localhost:3000';
  
  try {
    console.log(`\n=== Testing Payment Methods Endpoint ===`);
    console.log(`URL: ${baseUrl}/api/organizations/${organizationId}/payment-methods`);
    
    const response = await axios.get(`${baseUrl}/api/organizations/${organizationId}/payment-methods`);
    
    console.log('\nResponse Status:', response.status);
    console.log('Response Data:', JSON.stringify(response.data, null, 2));
    
  } catch (error) {
    if (error.response) {
      console.error('\nError Response Status:', error.response.status);
      console.error('Error Response Data:', error.response.data);
      console.error('Error Response Headers:', error.response.headers);
    } else if (error.request) {
      console.error('\nNo response received');
      console.error('Request:', error.request);
    } else {
      console.error('\nError:', error.message);
    }
  }
}

testPaymentMethodsEndpoint();