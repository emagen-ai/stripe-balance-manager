import express from 'express';
import crypto from 'crypto';
import { logger } from '../config/logger';
import { DatabaseManager } from '../config/database';

const router = express.Router();
const prisma = DatabaseManager.getInstance();

// WorkOS webhook 签名验证
// WorkOS 使用格式: "t=timestamp, v1=signature"
function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  try {
    logger.info('🔍 Parsing WorkOS signature format', { 
      signatureFormat: signature,
      payloadLength: payload.length
    });
    
    // 解析 WorkOS 签名格式: "t=timestamp, v1=signature"
    const signatureParts = signature.split(', ');
    let timestamp = '';
    let receivedSignature = '';
    
    for (const part of signatureParts) {
      const [key, value] = part.split('=');
      if (key === 't') {
        timestamp = value;
      } else if (key === 'v1') {
        receivedSignature = value;
      }
    }
    
    if (!timestamp || !receivedSignature) {
      logger.error('❌ Invalid WorkOS signature format', { 
        timestamp, 
        hasSignature: !!receivedSignature,
        signatureFormat: signature
      });
      return false;
    }
    
    logger.info('✅ Parsed WorkOS signature', { 
      timestamp, 
      signaturePrefix: receivedSignature.substring(0, 10) + '...'
    });
    
    // 构建签名字符串: timestamp + . + payload
    const signaturePayload = timestamp + '.' + payload;
    
    // 生成期望的签名
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(signaturePayload, 'utf8')
      .digest('hex');
    
    logger.info('🔐 Signature verification details', {
      signaturePayloadLength: signaturePayload.length,
      expectedSigLength: expectedSignature.length,
      receivedSigLength: receivedSignature.length,
      expectedSigSample: expectedSignature.substring(0, 10) + '...',
      receivedSigSample: receivedSignature.substring(0, 10) + '...',
      payloadSample: payload.substring(0, 50) + '...'
    });
    
    // 确保两个签名长度相同
    if (expectedSignature.length !== receivedSignature.length) {
      logger.error('❌ Signature length mismatch', {
        expectedLength: expectedSignature.length,
        receivedLength: receivedSignature.length,
        expectedSig: expectedSignature,
        receivedSig: receivedSignature
      });
      return false;
    }
    
    // 比较签名
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(receivedSignature, 'hex')
    );
    
  } catch (error) {
    logger.error('❌ Webhook signature verification error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      code: (error as any)?.code,
      signature: signature.substring(0, 50) + '...',
      payloadLength: payload.length
    });
    return false;
  }
}

// 处理组织创建事件
async function handleOrganizationCreated(orgData: any) {
  try {
    const { id: workos_org_id, name } = orgData;
    
    logger.info('🏢 Started handling organization.created event', { 
      workos_org_id, 
      name,
      orgDataKeys: Object.keys(orgData || {})
    });
    
    // 检查组织是否已存在
    logger.info('🔍 Checking if organization already exists in database', { workos_org_id });
    const existingOrg = await prisma.organizationBalanceConfig.findUnique({
      where: { c_organization_id: workos_org_id }
    });
    
    if (existingOrg) {
      logger.info('⚠️ Organization already exists, skipping creation', { 
        workos_org_id,
        existing_balance: existingOrg.current_balance,
        existing_created_at: existingOrg.created_at
      });
      return;
    }
    
    logger.info('📝 Creating new organization balance configuration', { workos_org_id, name });
    
    // 创建组织余额配置
    const organization = await prisma.organizationBalanceConfig.create({
      data: {
        c_organization_id: workos_org_id,
        minimum_balance: 100,        // 默认最低余额 $100
        target_balance: 1000,        // 默认充值目标 $1000
        auto_recharge_enabled: true, // 默认启用自动充值
        current_balance: 0,          // 初始余额为 $0
        least_balance: 100,          // 最低余额阈值
        add_balance_up_to: 1000,     // 充值到此金额
        org_limit: 10000,           // 默认组织限额 $10,000
        max_daily_recharges: 5,     // 默认每日最大充值次数
        minimum_recharge_amount: 100 // 默认最小充值金额 $100
      }
    });
    
    logger.info('✅ Organization balance config created successfully', {
      workos_org_id,
      name,
      database_id: organization.id,
      current_balance: organization.current_balance,
      auto_recharge_enabled: organization.auto_recharge_enabled,
      created_at: organization.created_at
    });
    
  } catch (error) {
    logger.error('❌ Error handling organization.created event', {
      workos_org_id: orgData?.id,
      name: orgData?.name,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : 'No stack trace'
    });
    throw error;
  }
}

// 处理组织更新事件
async function handleOrganizationUpdated(orgData: any) {
  try {
    const { id: workos_org_id, name } = orgData;
    
    logger.info('Handling organization.updated event', { workos_org_id, name });
    
    // 检查组织是否存在
    const existingOrg = await prisma.organizationBalanceConfig.findUnique({
      where: { c_organization_id: workos_org_id }
    });
    
    if (!existingOrg) {
      logger.info('Organization not found during update, creating new one', { workos_org_id });
      await handleOrganizationCreated(orgData);
      return;
    }
    
    // 这里可以根据需要更新组织信息
    // 目前我们只记录事件，不更新余额配置
    logger.info('Organization update processed', { workos_org_id, name });
    
  } catch (error) {
    logger.error('Error handling organization.updated event:', error);
    throw error;
  }
}

// 处理组织删除事件
async function handleOrganizationDeleted(orgData: any) {
  try {
    const { id: workos_org_id, name } = orgData;
    
    logger.info('Handling organization.deleted event', { workos_org_id, name });
    
    // 注意：在生产环境中，您可能不想立即删除余额数据
    // 而是标记为已删除，以便保留审计记录
    
    const existingOrg = await prisma.organizationBalanceConfig.findUnique({
      where: { c_organization_id: workos_org_id }
    });
    
    if (existingOrg) {
      // 记录删除前的状态
      logger.info('Organization marked for deletion', {
        workos_org_id,
        name,
        current_balance: existingOrg.current_balance,
        auto_recharge_enabled: existingOrg.auto_recharge_enabled
      });
      
      // 可以选择删除或标记为已删除
      // await prisma.organizationBalanceConfig.delete({
      //   where: { c_organization_id: workos_org_id }
      // });
      
      logger.info('Organization deletion processed', { workos_org_id });
    } else {
      logger.info('Organization not found during deletion', { workos_org_id });
    }
    
  } catch (error) {
    logger.error('Error handling organization.deleted event:', error);
    throw error;
  }
}

// WorkOS webhook 端点 - 使用混淆路径以提高安全性
router.post('/workos/wos_sync_endpoint_secure_2024', express.raw({ type: 'application/json' }), async (req, res) => {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).substring(2, 15);
  
  // 记录请求接收
  logger.info('🔔 WorkOS Webhook Request Received', {
    requestId,
    timestamp: new Date().toISOString(),
    userAgent: req.headers['user-agent'],
    contentType: req.headers['content-type'],
    contentLength: req.headers['content-length'],
    origin: req.headers['origin'] || 'N/A',
    hasSignature: !!req.headers['workos-signature']
  });

  try {
    // 获取 webhook 签名和密钥
    const signature = req.headers['workos-signature'] as string;
    const webhookSecret = process.env.WORKOS_WEBHOOK_SECRET || 'Y8QkpVN9O5b9CKQdgpnIDKenf';
    
    if (!signature) {
      logger.warn('❌ WorkOS webhook received without signature', { requestId });
      return res.status(401).json({ 
        error: 'Missing signature',
        requestId,
        timestamp: new Date().toISOString()
      });
    }
    
    // 记录签名验证开始
    logger.info('🔐 Verifying webhook signature', { 
      requestId,
      signaturePrefix: signature.substring(0, 20) + '...'
    });
    
    // 调试请求体信息
    logger.info('🔍 Request body debug info', {
      requestId,
      bodyType: typeof req.body,
      isBuffer: Buffer.isBuffer(req.body),
      bodyLength: req.body?.length || 0,
      bodyConstructor: req.body?.constructor?.name || 'unknown'
    });
    
    // 验证 webhook 签名
    const payload = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body);
    
    logger.info('🔍 Payload debug info', {
      requestId,
      payloadType: typeof payload,
      payloadLength: payload.length,
      payloadStart: payload.substring(0, 100)
    });
    
    const isValid = verifyWebhookSignature(payload, signature, webhookSecret);
    
    if (!isValid) {
      logger.warn('❌ WorkOS webhook signature verification failed', { 
        requestId,
        signature: signature.substring(0, 20) + '...',
        payloadLength: payload.length
      });
      return res.status(401).json({ 
        error: 'Invalid signature',
        requestId,
        timestamp: new Date().toISOString()
      });
    }
    
    logger.info('✅ Webhook signature verified successfully', { requestId });
    
    // 解析 webhook 数据
    const webhookData = JSON.parse(payload);
    const { event, data } = webhookData;
    
    logger.info('📥 WorkOS webhook data parsed', { 
      requestId,
      event, 
      organization_id: data?.id,
      organization_name: data?.name,
      dataKeys: Object.keys(data || {})
    });
    
    // 根据事件类型处理
    let processingResult = { success: false, action: 'unknown' };
    
    switch (event) {
      case 'organization.created':
        logger.info('🏢 Processing organization.created event', { requestId, orgId: data?.id });
        await handleOrganizationCreated(data);
        processingResult = { success: true, action: 'created' };
        break;
        
      case 'organization.updated':
        logger.info('📝 Processing organization.updated event', { requestId, orgId: data?.id });
        await handleOrganizationUpdated(data);
        processingResult = { success: true, action: 'updated' };
        break;
        
      case 'organization.deleted':
        logger.info('🗑️ Processing organization.deleted event', { requestId, orgId: data?.id });
        await handleOrganizationDeleted(data);
        processingResult = { success: true, action: 'deleted' };
        break;
        
      default:
        logger.info('⚠️ Unhandled WorkOS webhook event', { requestId, event });
        processingResult = { success: true, action: 'ignored' };
        break;
    }
    
    const processingTime = Date.now() - startTime;
    
    // 记录成功处理
    logger.info('✅ WorkOS webhook processed successfully', {
      requestId,
      event,
      organization_id: data?.id,
      action: processingResult.action,
      processingTimeMs: processingTime,
      timestamp: new Date().toISOString()
    });
    
    // 返回成功响应
    res.status(200).json({ 
      success: true, 
      message: 'Webhook processed successfully',
      requestId,
      event,
      action: processingResult.action,
      organization_id: data?.id,
      processingTimeMs: processingTime,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    const processingTime = Date.now() - startTime;
    
    logger.error('❌ WorkOS webhook processing error', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : 'No stack trace',
      processingTimeMs: processingTime,
      timestamp: new Date().toISOString()
    });
    
    res.status(500).json({ 
      error: 'Webhook processing failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      requestId,
      timestamp: new Date().toISOString()
    });
  }
});

// 健康检查端点
router.get('/workos/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'workos-webhook',
    timestamp: new Date().toISOString()
  });
});

// 测试端点 - 模拟 WorkOS webhook 调用（仅用于测试）
router.post('/workos/test', async (req, res) => {
  try {
    const testOrgData = {
      id: 'org_test_' + Date.now(),
      name: 'Test Organization ' + new Date().toLocaleTimeString()
    };
    
    logger.info('🧪 Testing WorkOS webhook simulation', { testOrgData });
    
    await handleOrganizationCreated(testOrgData);
    
    res.json({
      success: true,
      message: 'Test webhook processed successfully',
      testOrgData,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('❌ Test webhook failed', error);
    res.status(500).json({
      error: 'Test webhook failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;