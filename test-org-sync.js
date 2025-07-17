// 测试组织同步服务
const { PrismaClient } = require('@prisma/client');
const { OrganizationSyncService } = require('./dist/services/organizationSync');
const { KeyManagementClient } = require('./dist/services/keyManagementClient');

const prisma = new PrismaClient();
const kmsClient = new KeyManagementClient('http://172.171.97.248:3090');
const syncService = new OrganizationSyncService(prisma, kmsClient);

async function testOrganizationSync() {
    console.log('=== 测试组织同步服务 ===');
    
    const testOrgId = `sync_test_${Date.now()}`;
    
    try {
        // 1. 创建组织配置
        console.log('1. 创建组织配置...');
        await syncService.createOrganizationConfig({
            c_organization_id: testOrgId,
            stripe_customer_id: 'cus_test_sync',
            minimum_balance: 150,
            target_balance: 800,
            auto_recharge_enabled: true,
            minimum_recharge_amount: 200
        });
        console.log('✅ 组织配置创建成功');
        
        // 2. 创建一些充值记录
        console.log('\n2. 创建充值记录...');
        const rechargeRecord = await prisma.rechargeRecord.create({
            data: {
                c_organization_id: testOrgId,
                amount: 500,
                fee: 14.5,
                totalCharged: 514.5,
                balanceBefore: 0,
                balanceAfter: 500,
                stripePaymentIntentId: 'pi_test_sync_' + Date.now(),
                stripeStatus: 'succeeded',
                status: 'COMPLETED',
                isAutomatic: false,
                triggeredBy: 'manual'
            }
        });
        console.log('✅ 充值记录创建成功:', rechargeRecord.id);
        
        // 3. 获取组织完整信息
        console.log('\n3. 获取组织完整信息...');
        const orgInfo = await syncService.getOrganizationInfo(testOrgId);
        console.log('✅ 组织完整信息:', {
            config: {
                id: orgInfo.config.c_organization_id,
                minimum_balance: orgInfo.config.minimum_balance,
                target_balance: orgInfo.config.target_balance,
                litellm_team_id: orgInfo.config.litellm_team_id
            },
            kms: {
                id: orgInfo.kms.c_organization_id,
                l_team_id: orgInfo.kms.l_team_id,
                quota: orgInfo.kms.quota
            },
            spend: orgInfo.spend,
            balance: orgInfo.balance
        });
        
        // 4. 再次同步（测试幂等性）
        console.log('\n4. 再次同步（测试幂等性）...');
        await syncService.syncOrganizationToKMS(testOrgId);
        console.log('✅ 再次同步成功');
        
        // 5. 测试现有组织同步
        console.log('\n5. 测试现有组织同步...');
        const existingOrgs = await prisma.organizationBalanceConfig.findMany();
        console.log('现有组织数量:', existingOrgs.length);
        
        for (const org of existingOrgs.slice(0, 2)) { // 只测试前2个
            try {
                await syncService.syncOrganizationToKMS(org.c_organization_id);
                console.log(`✅ 同步成功: ${org.c_organization_id}`);
            } catch (error) {
                console.log(`❌ 同步失败: ${org.c_organization_id} - ${error.message}`);
            }
        }
        
        // 6. 测试批量同步
        console.log('\n6. 测试批量同步...');
        await syncService.syncAllOrganizations();
        console.log('✅ 批量同步完成');
        
        // 7. 清理测试数据
        console.log('\n7. 清理测试数据...');
        await prisma.rechargeRecord.deleteMany({
            where: { c_organization_id: testOrgId }
        });
        await prisma.organizationBalanceConfig.delete({
            where: { c_organization_id: testOrgId }
        });
        console.log('✅ 测试数据清理完成');
        
        console.log('\n=== 组织同步测试完成 ===');
        
    } catch (error) {
        console.error('❌ 测试失败:', error);
        
        // 清理测试数据
        try {
            await prisma.rechargeRecord.deleteMany({
                where: { c_organization_id: testOrgId }
            });
            await prisma.organizationBalanceConfig.delete({
                where: { c_organization_id: testOrgId }
            });
            console.log('✅ 测试数据清理完成');
        } catch (cleanupError) {
            console.log('⚠️ 清理失败:', cleanupError.message);
        }
        
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

// 运行测试
testOrganizationSync().catch(console.error);