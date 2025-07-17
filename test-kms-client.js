// 测试KMS API客户端
const { KeyManagementClient } = require('./dist/services/keyManagementClient');

const kmsClient = new KeyManagementClient('http://172.171.97.248:3090');

async function testKMSClient() {
    console.log('=== 测试KMS API客户端 ===');
    
    const testOrgId = `test_kms_${Date.now()}`;
    const testTeamId = `team_${Date.now()}`;
    
    try {
        // 1. 测试服务连接（通过列出组织）
        console.log('1. 测试服务连接...');
        try {
            const orgs = await kmsClient.listOrganizations();
            console.log('✅ KMS服务连接成功，现有组织数量:', orgs.length);
        } catch (error) {
            console.log('❌ KMS服务不可用，跳过测试');
            console.log('   请确保KMS服务运行在 http://172.171.97.248:3090');
            console.log('   错误:', error.message);
            return;
        }
        
        // 2. 创建组织
        console.log('\n2. 创建组织...');
        const orgData = {
            c_organization_id: testOrgId,
            quota: 1000
        };
        const createdOrg = await kmsClient.createOrganization(orgData);
        console.log('✅ 组织创建成功:', createdOrg);
        
        // 3. 获取组织信息
        console.log('\n3. 获取组织信息...');
        const fetchedOrg = await kmsClient.getOrganization(testOrgId);
        console.log('✅ 组织信息获取成功:', fetchedOrg);
        
        // 4. 更新组织配额
        console.log('\n4. 更新组织配额...');
        const updatedOrg = await kmsClient.updateOrganizationQuota(testOrgId, 1500);
        console.log('✅ 组织配额更新成功:', updatedOrg);
        
        // 5. 创建团队
        console.log('\n5. 创建团队...');
        const teamData = {
            c_organization_id: testOrgId,
            c_team_id: testTeamId,
            quota: 500
        };
        const createdTeam = await kmsClient.createTeam(teamData);
        console.log('✅ 团队创建成功:', createdTeam);
        
        // 6. 获取团队信息
        console.log('\n6. 获取团队信息...');
        const fetchedTeam = await kmsClient.getTeam(testTeamId);
        console.log('✅ 团队信息获取成功:', fetchedTeam);
        
        // 7. 列出组织下的团队
        console.log('\n7. 列出组织下的团队...');
        const teams = await kmsClient.listTeams(testOrgId);
        console.log('✅ 团队列表获取成功:', teams);
        
        // 8. 列出所有组织
        console.log('\n8. 列出所有组织...');
        const organizations = await kmsClient.listOrganizations();
        console.log('✅ 组织列表获取成功:', organizations.length, '个组织');
        
        // 9. 测试错误处理
        console.log('\n9. 测试错误处理...');
        try {
            await kmsClient.getOrganization('nonexistent_org');
            console.log('❌ 应该抛出错误');
        } catch (error) {
            console.log('✅ 错误处理正确:', error.message);
        }
        
        // 10. 清理测试数据
        console.log('\n10. 清理测试数据...');
        await kmsClient.deleteOrganization(testOrgId);
        console.log('✅ 测试数据清理完成');
        
        console.log('\n=== 所有KMS测试通过 ===');
        
    } catch (error) {
        console.error('❌ KMS测试失败:', error);
        
        // 尝试清理
        try {
            await kmsClient.deleteOrganization(testOrgId);
            console.log('✅ 测试数据清理完成');
        } catch (cleanupError) {
            console.log('⚠️ 清理失败:', cleanupError.message);
        }
        
        throw error;
    }
}

// 运行测试
testKMSClient().catch(console.error);