const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkOrganizationData() {
  const orgId = 'org_01JY6WTE4T4N41FZ0TVA0TFVVX';
  
  try {
    console.log(`\n=== Checking data for organization: ${orgId} ===\n`);
    
    // 1. Check OrganizationBalanceConfig
    const orgConfig = await prisma.organizationBalanceConfig.findUnique({
      where: { c_organization_id: orgId },
      include: {
        users: true,
        rechargeRecords: {
          orderBy: { createdAt: 'desc' },
          take: 5
        }
      }
    });
    
    if (orgConfig) {
      console.log('Organization Balance Config:');
      console.log('- Organization ID:', orgConfig.c_organization_id);
      console.log('- Stripe Customer ID:', orgConfig.stripe_customer_id);
      console.log('- LiteLLM Team ID:', orgConfig.litellm_team_id);
      console.log('- Current Balance:', orgConfig.current_balance.toString());
      console.log('- Auto Recharge Enabled:', orgConfig.auto_recharge_enabled);
      console.log('- Default Payment Method ID:', orgConfig.default_payment_method_id);
      console.log('- Minimum Balance:', orgConfig.minimum_balance.toString());
      console.log('- Target Balance:', orgConfig.target_balance.toString());
      console.log('- Associated Users:', orgConfig.users.length);
      console.log('- Recent Recharge Records:', orgConfig.rechargeRecords.length);
      
      if (orgConfig.users.length > 0) {
        console.log('\nAssociated Users:');
        orgConfig.users.forEach(user => {
          console.log(`  - ${user.email} (${user.stripeCustomerId})`);
        });
      }
      
      if (orgConfig.rechargeRecords.length > 0) {
        console.log('\nRecent Recharge Records:');
        orgConfig.rechargeRecords.forEach(record => {
          console.log(`  - ${record.createdAt.toISOString()}: $${record.amount} (Status: ${record.status})`);
        });
      }
    } else {
      console.log('No OrganizationBalanceConfig found for this organization ID.');
    }
    
    // 2. Check if there are any users with this organization ID
    const users = await prisma.user.findMany({
      where: { c_organization_id: orgId },
      include: { balanceConfig: true }
    });
    
    console.log(`\n=== Users with organization ID ${orgId} ===`);
    console.log('Found users:', users.length);
    
    users.forEach(user => {
      console.log(`\nUser: ${user.email}`);
      console.log('- User ID:', user.id);
      console.log('- Stripe Customer ID:', user.stripeCustomerId);
      console.log('- LiteLLM Team ID:', user.litellm_team_id);
      console.log('- Has Balance Config:', !!user.balanceConfig);
      
      if (user.balanceConfig) {
        console.log('  - Default Payment Method:', user.balanceConfig.defaultPaymentMethodId);
        console.log('  - Auto Recharge Enabled:', user.balanceConfig.autoRechargeEnabled);
      }
    });
    
    // 3. Check for any webhook events
    const webhookEvents = await prisma.webhookEvent.findMany({
      where: {
        OR: [
          { organization_id: orgId },
          { team_id: orgConfig?.litellm_team_id || '' }
        ]
      },
      orderBy: { created_at: 'desc' },
      take: 10
    });
    
    console.log(`\n=== Recent Webhook Events ===`);
    console.log('Found events:', webhookEvents.length);
    
    webhookEvents.forEach(event => {
      console.log(`\n- ${event.created_at.toISOString()}: ${event.event_type}`);
      console.log('  Team ID:', event.team_id);
      console.log('  Processed:', event.processed);
      console.log('  Success:', event.success);
      if (event.error_message) {
        console.log('  Error:', event.error_message);
      }
    });
    
  } catch (error) {
    console.error('Error querying database:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkOrganizationData();