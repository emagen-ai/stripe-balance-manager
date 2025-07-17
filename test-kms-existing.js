// 测试现有组织的KMS功能
const { KeyManagementClient } = require('./dist/services/keyManagementClient');

const kmsClient = new KeyManagementClient('http://172.171.97.248:3090');

async function testExistingOrganization() {
    console.log('=== 测试现有组织的KMS功能 ===');
    
    try {
        // 1. 列出现有组织
        console.log('1. 列出现有组织...');
        const orgs = await kmsClient.listOrganizations();
        console.log('✅ 现有组织列表:', orgs.map(o => ({
            id: o.c_organization_id,
            quota: o.quota,
            l_team_id: o.l_team_id
        })));
        
        if (orgs.length === 0) {
            console.log('没有现有组织可测试');
            return;
        }
        
        const testOrg = orgs[0];
        console.log(`\n使用测试组织: ${testOrg.c_organization_id}`);
        
        // 2. 获取组织信息
        console.log('\n2. 获取组织信息...');
        const orgInfo = await kmsClient.getOrganization(testOrg.c_organization_id);
        console.log('✅ 组织信息:', {
            id: orgInfo.c_organization_id,
            quota: orgInfo.quota,
            l_team_id: orgInfo.l_team_id
        });
        
        // 3. 获取组织支出
        console.log('\n3. 获取组织支出...');
        const spend = await kmsClient.getOrganizationSpend(testOrg.c_organization_id);
        console.log('✅ 组织支出信息:', spend);
        
        // 4. 列出组织下的团队
        console.log('\n4. 列出组织下的团队...');
        const teams = await kmsClient.listTeams(testOrg.c_organization_id);
        console.log('✅ 团队列表:', teams.map(t => ({
            id: t.c_team_id,
            quota: t.quota,
            l_user_id: t.l_user_id
        })));
        
        // 5. 如果有团队，测试团队支出
        if (teams.length > 0) {
            const testTeam = teams[0];
            console.log(`\n5. 获取团队支出: ${testTeam.c_team_id}...`);
            const teamSpend = await kmsClient.getTeamSpend(testTeam.c_team_id, testOrg.c_organization_id);
            console.log('✅ 团队支出信息:', teamSpend);
        }
        
        // 6. 测试配额更新（小心操作）
        console.log('\n6. 测试配额更新...');
        console.log('⚠️ 注意：这会删除并重新创建组织');
        
        // 先保存原配额
        const originalQuota = parseFloat(testOrg.quota);
        const newQuota = originalQuota + 100;
        
        console.log(`将配额从 ${originalQuota} 更新到 ${newQuota}`);
        const updatedOrg = await kmsClient.updateOrganizationQuota(testOrg.c_organization_id, newQuota);
        console.log('✅ 配额更新成功:', {
            id: updatedOrg.c_organization_id,
            old_quota: originalQuota,
            new_quota: updatedOrg.quota
        });
        
        // 7. 恢复原配额
        console.log('\n7. 恢复原配额...');
        const restoredOrg = await kmsClient.updateOrganizationQuota(testOrg.c_organization_id, originalQuota);
        console.log('✅ 配额恢复成功:', {
            id: restoredOrg.c_organization_id,
            quota: restoredOrg.quota
        });
        
        console.log('\n=== 现有组织测试完成 ===');
        
    } catch (error) {
        console.error('❌ 测试失败:', error.message);
        console.error('错误详情:', error);
    }
}

// 运行测试
testExistingOrganization().catch(console.error);