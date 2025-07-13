require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const Stripe = require('stripe');

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function setupTestData() {
  try {
    console.log('🚀 Setting up test data...');

    // Create a test customer in Stripe
    console.log('Creating Stripe customer...');
    const customer = await stripe.customers.create({
      email: 'test@example.com',
      name: 'Test User',
      description: 'Test customer for balance manager',
    });
    console.log('✅ Stripe customer created:', customer.id);

    // Create user in database
    console.log('Creating user in database...');
    const user = await prisma.user.create({
      data: {
        email: 'test@example.com',
        stripeCustomerId: customer.id,
      },
    });
    console.log('✅ User created:', user.id);

    // Create balance configuration
    console.log('Creating balance configuration...');
    const balanceConfig = await prisma.balanceConfig.create({
      data: {
        userId: user.id,
        minimumBalance: 100.00,
        targetBalance: 500.00,
        autoRechargeEnabled: true,
        maxDailyRecharges: 3,
        maxRechargeAmount: 10000.00,
      },
    });
    console.log('✅ Balance config created:', balanceConfig.id);

    // Set customer balance to a low amount to trigger recharge
    console.log('Setting low customer balance in Stripe...');
    await stripe.customers.createBalanceTransaction(customer.id, {
      amount: -5000, // -50 CNY (in cents)
      currency: 'cny',
      description: 'Initial low balance for testing',
    });
    console.log('✅ Customer balance set to low amount');

    console.log('\n📊 Test Data Summary:');
    console.log('- User ID:', user.id);
    console.log('- Stripe Customer ID:', customer.id);
    console.log('- Minimum Balance: ¥100');
    console.log('- Target Balance: ¥500');
    console.log('- Current Stripe Balance: ¥50 (below minimum)');
    
    return { user, customer, balanceConfig };

  } catch (error) {
    console.error('❌ Error setting up test data:', error);
    throw error;
  }
}

async function testBalanceCheck(userId) {
  try {
    console.log('\n🔍 Testing balance check...');
    
    // We'll simulate the balance check logic here since we can't easily call the API
    const { BalanceMonitorService } = require('./dist/services/BalanceMonitorService');
    const monitor = new BalanceMonitorService();
    
    const result = await monitor.checkUserBalance(userId);
    console.log('✅ Balance check result:', JSON.stringify(result, null, 2));
    
    return result;
  } catch (error) {
    console.error('❌ Balance check failed:', error);
    throw error;
  }
}

async function main() {
  try {
    console.log('🧪 Starting Balance Manager Tests\n');
    
    // Setup test data
    const { user, customer } = await setupTestData();
    
    // Test balance monitoring
    // await testBalanceCheck(user.id);
    
    console.log('\n✅ Test setup completed successfully!');
    console.log('\n📝 Next steps:');
    console.log('1. Start the API server: npm run dev');
    console.log('2. Test the endpoints with curl or Postman');
    console.log(`3. Get balance status: GET /api/balance/status/${user.id}`);
    console.log(`4. Update config: POST /api/balance/config/${user.id}`);
    console.log(`5. Trigger recharge: POST /api/balance/recharge/${user.id}`);
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();