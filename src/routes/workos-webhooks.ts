import express from 'express';
import crypto from 'crypto';
import { logger } from '../config/logger';
import { DatabaseManager } from '../config/database';

const router = express.Router();
const prisma = DatabaseManager.getInstance();

// WorkOS webhook 签名验证
function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  try {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload, 'utf8')
      .digest('hex');
      
    const receivedSignature = signature.replace('sha256=', '');
    
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(receivedSignature, 'hex')
    );
  } catch (error) {
    logger.error('Webhook signature verification error:', error);
    return false;
  }
}

// 处理组织创建事件
async function handleOrganizationCreated(orgData: any) {
  try {
    const { id: workos_org_id, name } = orgData;
    
    logger.info('Handling organization.created event', { workos_org_id, name });
    
    // 检查组织是否已存在
    const existingOrg = await prisma.organizationBalanceConfig.findUnique({
      where: { c_organization_id: workos_org_id }
    });
    
    if (existingOrg) {
      logger.info('Organization already exists, skipping creation', { workos_org_id });
      return;
    }
    
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
    
    logger.info('Organization balance config created successfully', {
      workos_org_id,
      name,
      id: organization.id,
      current_balance: organization.current_balance
    });
    
  } catch (error) {
    logger.error('Error handling organization.created event:', error);
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
  try {
    // 获取 webhook 签名和密钥
    const signature = req.headers['workos-signature'] as string;
    const webhookSecret = process.env.WORKOS_WEBHOOK_SECRET || 'Y8QkpVN9O5b9CKQdgpnIDKenf';
    
    if (!signature) {
      logger.warn('WorkOS webhook received without signature');
      return res.status(401).json({ error: 'Missing signature' });
    }
    
    // 验证 webhook 签名
    const payload = req.body.toString('utf8');
    const isValid = verifyWebhookSignature(payload, signature, webhookSecret);
    
    if (!isValid) {
      logger.warn('WorkOS webhook signature verification failed', { signature });
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    // 解析 webhook 数据
    const webhookData = JSON.parse(payload);
    const { event, data } = webhookData;
    
    logger.info('WorkOS webhook received', { event, organization_id: data?.id });
    
    // 根据事件类型处理
    switch (event) {
      case 'organization.created':
        await handleOrganizationCreated(data);
        break;
        
      case 'organization.updated':
        await handleOrganizationUpdated(data);
        break;
        
      case 'organization.deleted':
        await handleOrganizationDeleted(data);
        break;
        
      default:
        logger.info('Unhandled WorkOS webhook event', { event });
        break;
    }
    
    // 返回成功响应
    res.status(200).json({ 
      success: true, 
      message: 'Webhook processed successfully',
      event,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('WorkOS webhook processing error:', error);
    res.status(500).json({ 
      error: 'Webhook processing failed',
      message: error instanceof Error ? error.message : 'Unknown error'
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

export default router;