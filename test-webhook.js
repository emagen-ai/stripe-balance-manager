// 测试Webhook功能
const { generateWebhookSignature } = require('./dist/utils/webhookSecurity');

async function testWebhook() {
    console.log('=== 测试Webhook功能 ===');
    
    const baseUrl = 'http://localhost:3000';
    const testOrgId = 'test_org_001';
    
    try {
        // 1. 测试签名生成
        console.log('1. 测试签名生成...');
        const testPayload = {
            event_type: 'limit_exceeded',
            team_id: 'test_team_001',
            organization_id: testOrgId,
            current_usage: 520,
            current_limit: 500,
            exceeded_by: 20,
            timestamp: new Date().toISOString()
        };
        
        const signature = generateWebhookSignature(testPayload, 'default_webhook_secret');
        console.log('✅ 签名生成成功:', signature.substring(0, 20) + '...');
        
        // 2. 测试无效签名
        console.log('\n2. 测试无效签名...');
        const invalidResponse = await fetch(`${baseUrl}/webhooks/litellm/limit-exceeded`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-webhook-signature': 'sha256=invalid_signature'
            },
            body: JSON.stringify(testPayload)
        });
        
        console.log('无效签名响应状态:', invalidResponse.status);
        if (invalidResponse.status === 401) {
            console.log('✅ 无效签名正确被拒绝');
        } else {
            console.log('❌ 无效签名应该被拒绝');
        }
        
        // 3. 测试有效webhook（需要先设置环境）
        console.log('\n3. 测试有效webhook...');
        const validResponse = await fetch(`${baseUrl}/webhooks/litellm/limit-exceeded`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-webhook-signature': signature
            },
            body: JSON.stringify(testPayload)
        });
        
        const validResult = await validResponse.json();
        console.log('有效webhook响应状态:', validResponse.status);
        console.log('有效webhook响应内容:', validResult);
        
        // 4. 测试webhook事件查询
        console.log('\n4. 测试webhook事件查询...');
        const eventsResponse = await fetch(`${baseUrl}/webhooks/events?organization_id=${testOrgId}&limit=10`);
        const eventsResult = await eventsResponse.json();
        console.log('✅ Webhook事件查询成功，事件数量:', eventsResult.events?.length || 0);
        
        // 5. 测试webhook模拟
        console.log('\n5. 测试webhook模拟...');
        const simulateResponse = await fetch(`${baseUrl}/webhooks/test/simulate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                organization_id: testOrgId,
                team_id: 'test_team_001',
                current_usage: 620,
                current_limit: 600
            })
        });
        
        const simulateResult = await simulateResponse.json();
        console.log('Webhook模拟响应:', simulateResult);
        
        console.log('\n=== Webhook测试完成 ===');
        
    } catch (error) {
        console.error('❌ Webhook测试失败:', error.message);
        throw error;
    }
}

// 运行测试
testWebhook().catch(console.error);