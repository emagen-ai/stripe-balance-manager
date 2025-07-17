// 测试组织级数据库操作
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testOrganizationOperations() {
    console.log('=== 测试组织级数据库操作 ===');
    
    try {
        // 1. 创建组织配置
        console.log('1. 创建组织配置...');
        const orgConfig = await prisma.organizationBalanceConfig.create({
            data: {
                c_organization_id: 'test_org_001',
                stripe_customer_id: 'cus_test123',
                minimum_balance: 200,
                target_balance: 1000,
                auto_recharge_enabled: true,
                minimum_recharge_amount: 100
            }
        });
        console.log('✅ 组织配置创建成功:', orgConfig);
        
        // 2. 查询组织配置
        console.log('\n2. 查询组织配置...');
        const foundOrg = await prisma.organizationBalanceConfig.findUnique({
            where: { c_organization_id: 'test_org_001' }
        });
        console.log('✅ 组织配置查询成功:', foundOrg);
        
        // 3. 创建充值记录
        console.log('\n3. 创建组织级充值记录...');
        const rechargeRecord = await prisma.rechargeRecord.create({
            data: {
                c_organization_id: 'test_org_001',
                amount: 500,
                fee: 14.5,
                totalCharged: 514.5,
                balanceBefore: 100,
                balanceAfter: 600,
                stripePaymentIntentId: 'pi_test_webhook_' + Date.now(),
                stripeStatus: 'succeeded',
                status: 'COMPLETED',
                isAutomatic: true,
                triggeredBy: 'webhook',
                triggered_by_webhook: true,
                webhook_event_id: 'webhook_test_001'
            }
        });
        console.log('✅ 充值记录创建成功:', rechargeRecord);
        
        // 4. 创建webhook事件记录
        console.log('\n4. 创建webhook事件记录...');
        const webhookEvent = await prisma.webhookEvent.create({
            data: {
                event_type: 'limit_exceeded',
                team_id: 'team_test_001',
                organization_id: 'test_org_001',
                payload: {
                    current_usage: 520,
                    current_limit: 500,
                    exceeded_by: 20
                },
                processed: true,
                success: true,
                response_data: {
                    recharged_amount: 500,
                    new_quota: 1000
                }
            }
        });
        console.log('✅ Webhook事件记录创建成功:', webhookEvent);
        
        // 5. 关联查询
        console.log('\n5. 关联查询...');
        const orgWithRecords = await prisma.organizationBalanceConfig.findUnique({
            where: { c_organization_id: 'test_org_001' },
            include: {
                rechargeRecords: true,
                users: true
            }
        });
        console.log('✅ 关联查询成功:', {
            organization: orgWithRecords.c_organization_id,
            rechargeRecordsCount: orgWithRecords.rechargeRecords.length,
            usersCount: orgWithRecords.users.length
        });
        
        // 6. 更新组织配置
        console.log('\n6. 更新组织配置...');
        const updatedOrg = await prisma.organizationBalanceConfig.update({
            where: { c_organization_id: 'test_org_001' },
            data: {
                litellm_team_id: 'team_litellm_001',
                minimum_balance: 150
            }
        });
        console.log('✅ 组织配置更新成功:', updatedOrg);
        
        console.log('\n=== 所有测试通过 ===');
        
    } catch (error) {
        console.error('❌ 测试失败:', error);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

testOrganizationOperations().catch(console.error);