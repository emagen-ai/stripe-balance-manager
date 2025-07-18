import express from 'express';
import crypto from 'crypto';
import { logger } from '../config/logger';
import { DatabaseManager } from '../config/database';
import { StripeService } from '../config/stripe';

const router = express.Router();
const prisma = DatabaseManager.getInstance();

// 辅助函数：根据 WorkOS 组织 ID 获取 Stripe Customer ID
async function getStripeCustomerIdByOrgId(workosOrgId: string): Promise<string | null> {
  try {
    const org = await prisma.organizationBalanceConfig.findUnique({
      where: { c_organization_id: workosOrgId },
      select: { stripe_customer_id: true }
    });
    
    return org?.stripe_customer_id || null;
  } catch (error) {
    logger.error('Failed to get Stripe Customer ID for organization', {
      workosOrgId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return null;
  }
}

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
    
    // 1. 首先在 Stripe 创建 Customer
    logger.info('💳 Creating Stripe Customer for organization', { workos_org_id, name });
    let stripeCustomer;
    try {
      stripeCustomer = await StripeService.createCustomer({
        name: name || `Organization ${workos_org_id}`,
        email: `org-${workos_org_id}@workos-auto.generated`,
        metadata: {
          workos_organization_id: workos_org_id,
          source: 'workos_webhook',
          created_by: 'auto_sync'
        }
      });
      
      logger.info('✅ Stripe Customer created successfully', {
        workos_org_id,
        stripe_customer_id: stripeCustomer.id,
        customer_email: stripeCustomer.email
      });
    } catch (stripeError: any) {
      logger.error('❌ Failed to create Stripe Customer', {
        workos_org_id,
        name,
        error: stripeError.message,
        stack: stripeError.stack
      });
      throw new Error(`Failed to create Stripe Customer: ${stripeError.message}`);
    }
    
    // 2. 在 KMS 中创建组织
    logger.info('🔧 Creating organization in KMS', { workos_org_id, name });
    let kmsOrgResponse;
    try {
      const kmsApiUrl = process.env.KMS_API_URL || 'http://172.171.97.248:3090';
      const kmsResponse = await fetch(`${kmsApiUrl}/organizations/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          c_organization_id: workos_org_id,
          quota: 10000.00,          // 默认配额 $10,000
          min_limit: 100.00,        // 默认告警阈值 $100
          check_interval: 600       // 默认检查间隔 600秒
        })
      });
      
      if (kmsResponse.ok) {
        kmsOrgResponse = await kmsResponse.json();
        logger.info('✅ KMS organization created successfully', {
          workos_org_id,
          kms_response: kmsOrgResponse
        });
      } else {
        const errorText = await kmsResponse.text();
        logger.warn('⚠️ KMS organization creation failed but continuing', {
          workos_org_id,
          kms_status: kmsResponse.status,
          kms_error: errorText
        });
      }
    } catch (kmsError: any) {
      logger.warn('⚠️ KMS API error but continuing with balance config creation', {
        workos_org_id,
        kms_error: kmsError.message
      });
    }
    
    // 3. 创建组织余额配置（包含 Stripe Customer ID）
    const organization = await prisma.organizationBalanceConfig.create({
      data: {
        c_organization_id: workos_org_id,
        stripe_customer_id: stripeCustomer.id,      // 存储 Stripe Customer ID 映射
        litellm_team_id: (kmsOrgResponse as any)?.l_team_id, // 存储 LiteLLM Team ID（如果有）
        minimum_balance: 0,          // 默认最低余额 $0
        target_balance: 1000,        // 默认充值目标 $1000
        auto_recharge_enabled: true, // 默认启用自动充值
        auto_deduct_enabled: false,  // 默认关闭自动扣费
        current_balance: 0,          // 初始余额为 $0
        least_balance: 0,            // 最低余额阈值 $0
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
      stripe_customer_id: organization.stripe_customer_id,
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
        stripe_customer_id: existingOrg.stripe_customer_id,
        current_balance: existingOrg.current_balance,
        auto_recharge_enabled: existingOrg.auto_recharge_enabled
      });
      
      // 注意：出于安全考虑，我们不会自动删除 Stripe Customer 和数据库记录
      // 这样可以保留支付历史和审计记录
      
      // 如果需要完全删除，可以取消以下注释：
      // if (existingOrg.stripe_customer_id) {
      //   logger.info('Would delete Stripe Customer (currently disabled for safety)', {
      //     stripe_customer_id: existingOrg.stripe_customer_id
      //   });
      //   // 注意：删除 Stripe Customer 会删除所有相关的支付方式和历史记录
      //   // await stripe.customers.del(existingOrg.stripe_customer_id);
      // }
      // 
      // await prisma.organizationBalanceConfig.delete({
      //   where: { c_organization_id: workos_org_id }
      // });
      
      logger.info('Organization deletion processed (data preserved for audit)', { 
        workos_org_id,
        stripe_customer_id: existingOrg.stripe_customer_id,
        note: 'Data preserved for audit purposes'
      });
    } else {
      logger.info('Organization not found during deletion', { workos_org_id });
    }
    
  } catch (error) {
    logger.error('Error handling organization.deleted event:', error);
    throw error;
  }
}

// WorkOS webhook 端点 - 使用混淆路径以提高安全性
router.post('/workos/wos_sync_endpoint_secure_2024', 
  express.raw({ type: 'application/json', limit: '50mb' }), 
  async (req, res) => {
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

// 手动创建现有组织的端点（用于迁移已有组织）
router.post('/workos/manual-create-org', express.json(), async (req, res) => {
  try {
    const { organizationId, organizationName } = req.body;
    
    if (!organizationId) {
      return res.status(400).json({
        error: 'Missing organizationId',
        message: 'organizationId is required'
      });
    }
    
    logger.info('🔧 Manual organization creation requested', { 
      organizationId, 
      organizationName 
    });
    
    // 检查组织是否已存在
    const existingOrg = await prisma.organizationBalanceConfig.findUnique({
      where: { c_organization_id: organizationId }
    });
    
    if (existingOrg) {
      // 如果组织存在但没有 Stripe Customer ID，为其创建
      if (!existingOrg.stripe_customer_id) {
        logger.info('🔄 Organization exists but missing Stripe Customer, creating one', {
          organizationId,
          organizationName
        });
        
        try {
          // 创建 Stripe Customer
          const stripeCustomer = await StripeService.createCustomer({
            name: organizationName || `Organization ${organizationId}`,
            email: `org-${organizationId}@workos-manual.generated`,
            metadata: {
              workos_organization_id: organizationId,
              source: 'manual_creation',
              created_by: 'manual_migration'
            }
          });
          
          // 在 KMS 中创建组织（如果还没有）
          logger.info('🔧 Creating organization in KMS for existing org', { organizationId });
          let kmsOrgResponse;
          try {
            const kmsApiUrl = process.env.KMS_API_URL || 'http://172.171.97.248:3090';
            const kmsResponse = await fetch(`${kmsApiUrl}/organizations/`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                c_organization_id: organizationId,
                quota: 10000.00,          // 默认配额 $10,000
                min_limit: 100.00,        // 默认告警阈值 $100
                check_interval: 600       // 默认检查间隔 600秒
              })
            });
            
            if (kmsResponse.ok) {
              kmsOrgResponse = await kmsResponse.json();
              logger.info('✅ KMS organization created successfully for existing org', {
                organizationId,
                kms_response: kmsOrgResponse
              });
            } else {
              const errorText = await kmsResponse.text();
              logger.warn('⚠️ KMS organization creation failed for existing org', {
                organizationId,
                kms_status: kmsResponse.status,
                kms_error: errorText
              });
            }
          } catch (kmsError: any) {
            logger.warn('⚠️ KMS API error for existing org', {
              organizationId,
              kms_error: kmsError.message
            });
          }
          
          // 更新数据库
          const updatedOrg = await prisma.organizationBalanceConfig.update({
            where: { c_organization_id: organizationId },
            data: { 
              stripe_customer_id: stripeCustomer.id,
              litellm_team_id: (kmsOrgResponse as any)?.l_team_id // 存储 LiteLLM Team ID（如果有）
            }
          });
          
          logger.info('✅ Stripe Customer created and linked to existing organization', {
            organizationId,
            stripe_customer_id: stripeCustomer.id
          });
          
          return res.json({
            success: true,
            message: 'Stripe Customer created and linked to existing organization',
            data: {
              organizationId,
              stripe_customer_id: stripeCustomer.id,
              database_id: updatedOrg.id,
              updated_at: updatedOrg.updated_at
            },
            timestamp: new Date().toISOString()
          });
          
        } catch (stripeError: any) {
          logger.error('❌ Failed to create Stripe Customer for existing organization', {
            organizationId,
            error: stripeError.message
          });
          return res.status(500).json({
            error: 'Failed to create Stripe Customer',
            message: stripeError.message,
            organizationId
          });
        }
      }
      
      return res.json({
        success: false,
        message: 'Organization already exists with Stripe Customer',
        organizationId,
        stripe_customer_id: existingOrg.stripe_customer_id,
        created_at: existingOrg.created_at
      });
    }
    
    // 使用现有的处理逻辑
    await handleOrganizationCreated({
      id: organizationId,
      name: organizationName || `Organization ${organizationId}`
    });
    
    // 获取创建的结果
    const createdOrg = await prisma.organizationBalanceConfig.findUnique({
      where: { c_organization_id: organizationId }
    });
    
    res.json({
      success: true,
      message: 'Organization created successfully',
      data: {
        organizationId,
        stripe_customer_id: createdOrg?.stripe_customer_id,
        database_id: createdOrg?.id,
        created_at: createdOrg?.created_at
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('❌ Manual organization creation failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : 'No stack trace'
    });
    res.status(500).json({
      error: 'Manual organization creation failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// 为现有组织同步 KMS 的端点
router.post('/workos/sync-kms', express.json(), async (req, res) => {
  try {
    const { organizationId } = req.body;
    
    if (!organizationId) {
      return res.status(400).json({
        error: 'Missing organizationId',
        message: 'organizationId is required'
      });
    }
    
    logger.info('🔧 KMS sync requested for organization', { organizationId });
    
    // 检查组织是否存在
    const existingOrg = await prisma.organizationBalanceConfig.findUnique({
      where: { c_organization_id: organizationId }
    });
    
    if (!existingOrg) {
      return res.status(404).json({
        error: 'Organization not found',
        message: 'Organization does not exist in balance system',
        organizationId
      });
    }
    
    // 在 KMS 中创建组织
    logger.info('🔧 Creating organization in KMS', { organizationId });
    let kmsOrgResponse;
    try {
      const kmsApiUrl = process.env.KMS_API_URL || 'http://172.171.97.248:3090';
      const kmsResponse = await fetch(`${kmsApiUrl}/organizations/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          c_organization_id: organizationId,
          quota: 10000.00,          // 默认配额 $10,000
          min_limit: 100.00,        // 默认告警阈值 $100
          check_interval: 600       // 默认检查间隔 600秒
        })
      });
      
      if (kmsResponse.ok) {
        kmsOrgResponse = await kmsResponse.json();
        logger.info('✅ KMS organization created successfully', {
          organizationId,
          kms_response: kmsOrgResponse
        });
        
        // 更新数据库中的 LiteLLM Team ID
        if ((kmsOrgResponse as any)?.l_team_id) {
          await prisma.organizationBalanceConfig.update({
            where: { c_organization_id: organizationId },
            data: { litellm_team_id: (kmsOrgResponse as any).l_team_id }
          });
          
          logger.info('✅ LiteLLM Team ID updated in database', {
            organizationId,
            litellm_team_id: (kmsOrgResponse as any).l_team_id
          });
        }
        
        return res.json({
          success: true,
          message: 'KMS organization created and synced successfully',
          data: {
            organizationId,
            kms_response: kmsOrgResponse,
            litellm_team_id: (kmsOrgResponse as any)?.l_team_id
          },
          timestamp: new Date().toISOString()
        });
        
      } else {
        const errorText = await kmsResponse.text();
        logger.error('❌ KMS organization creation failed', {
          organizationId,
          kms_status: kmsResponse.status,
          kms_error: errorText
        });
        
        return res.status(500).json({
          error: 'KMS organization creation failed',
          message: errorText,
          kms_status: kmsResponse.status,
          organizationId
        });
      }
    } catch (kmsError: any) {
      logger.error('❌ KMS API error', {
        organizationId,
        kms_error: kmsError.message
      });
      
      return res.status(500).json({
        error: 'KMS API error',
        message: kmsError.message,
        organizationId
      });
    }
    
  } catch (error) {
    logger.error('❌ KMS sync failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : 'No stack trace'
    });
    res.status(500).json({
      error: 'KMS sync failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
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