require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { BalanceMonitorService } = require('./dist/services/BalanceMonitorService');

const prisma = new PrismaClient();

async function testBalanceMonitoring() {
  try {
    console.log('🧪 Testing Balance Monitoring Service\n');

    // Get the test user
    const user = await prisma.user.findUnique({
      where: { email: 'test@example.com' },
      include: { balanceConfig: true }
    });

    if (!user) {
      console.log('❌ Test user not found. Run test-api.js first to create test data.');
      return;
    }

    console.log('✅ Found test user:', user.id);
    console.log('✅ Stripe Customer ID:', user.stripeCustomerId);
    console.log('✅ Balance Config:', user.balanceConfig);

    // Test balance monitoring
    const monitor = new BalanceMonitorService();
    
    console.log('\n🔍 Checking user balance...');
    const balanceResult = await monitor.checkUserBalance(user.id);
    
    console.log('✅ Balance Check Result:');
    console.log('  - Current Balance: ¥' + balanceResult.currentBalance);
    console.log('  - Minimum Balance: ¥' + balanceResult.minimumBalance);
    console.log('  - Target Balance: ¥' + balanceResult.targetBalance);
    console.log('  - Needs Recharge:', balanceResult.needsRecharge);
    
    if (balanceResult.calculation) {
      console.log('  - Recharge Amount: ¥' + balanceResult.calculation.rechargeAmount);
      console.log('  - Fee: ¥' + balanceResult.calculation.fee);
      console.log('  - Total Charge: ¥' + balanceResult.calculation.totalCharge);
    }

    // Test recharge eligibility
    console.log('\n🚦 Checking recharge eligibility...');
    const canRecharge = await monitor.canUserRecharge(user.id);
    console.log('✅ Can Recharge:', canRecharge.canRecharge);
    if (!canRecharge.canRecharge) {
      console.log('  - Reason:', canRecharge.reason);
    }

    // Test batch balance check
    console.log('\n📊 Testing batch balance check...');
    const batchResult = await monitor.checkAllUsersBalance();
    console.log('✅ Batch Check Results:');
    console.log('  - Total users checked:', batchResult.length);
    console.log('  - Users needing recharge:', batchResult.filter(r => r.result.needsRecharge).length);

    console.log('\n🎉 Balance monitoring tests completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testBalanceMonitoring();