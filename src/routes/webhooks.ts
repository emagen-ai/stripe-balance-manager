import express from 'express';
import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import { verifyWebhookSignature, verifyWebhookTimestamp } from '../utils/webhookSecurity';
import { organizationSyncService } from '../services/organizationSync';
import { kmsClient } from '../services/keyManagementClient';
import { StripeService } from '../config/stripe';

const router = express.Router();
const prisma = new PrismaClient();

// LiteLLM Webhook负载接口
interface LiteLLMWebhookPayload {
  event_type: 'balance_low' | 'limit_exceeded' | 'quota_warning' | 'payment_success';
  team_id: string;
  organization_id?: string;
  current_usage?: number;
  current_limit?: number;
  current_balance?: number;
  exceeded_by?: number;
  warning_threshold?: number;
  timestamp: string;
  metadata?: Record<string, any>;
}

/**
 * 处理LiteLLM余额不足/超限通知
 */
router.post('/litellm/limit-exceeded', async (req, res) => {
  const requestId = req.headers['x-request-id'] || `req_${Date.now()}`;
  
  logger.info('接收到LiteLLM余额/超限webhook', { 
    request_id: requestId,
    headers: req.headers,
    body: req.body
  });

  try {
    // 1. 验证webhook签名
    const signature = req.headers['x-webhook-signature'] as string;
    if (!verifyWebhookSignature(req.body, signature)) {
      logger.warn('Webhook签名验证失败', { request_id: requestId });
      return res.status(401).json({ 
        error: 'Invalid signature',
        request_id: requestId 
      });
    }

    const payload: LiteLLMWebhookPayload = req.body;
    
    // 2. 验证时间戳
    if (!verifyWebhookTimestamp(payload.timestamp)) {
      logger.warn('Webhook时间戳验证失败', { 
        request_id: requestId,
        timestamp: payload.timestamp
      });
      return res.status(400).json({ 
        error: 'Invalid timestamp',
        request_id: requestId 
      });
    }

    // 3. 记录webhook事件
    const webhookEvent = await prisma.webhookEvent.create({
      data: {
        event_type: payload.event_type,
        team_id: payload.team_id,
        organization_id: payload.organization_id,
        payload: payload as any,
        processed: false,
        success: false
      }
    });

    logger.info('Webhook事件记录创建', { 
      request_id: requestId,
      webhook_event_id: webhookEvent.id,
      event_type: payload.event_type,
      team_id: payload.team_id
    });

    // 4. 通过team_id查找对应的组织配置
    const orgConfig = await prisma.organizationBalanceConfig.findFirst({
      where: { litellm_team_id: payload.team_id }
    });

    if (!orgConfig) {
      logger.error('找不到对应的组织配置', { 
        request_id: requestId,
        team_id: payload.team_id
      });
      
      await prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: {
          processed: true,
          success: false,
          error_message: 'Organization not found for team_id'
        }
      });

      return res.status(404).json({ 
        error: 'Organization not found for team_id',
        team_id: payload.team_id,
        request_id: requestId
      });
    }

    logger.info('找到对应的组织配置', { 
      request_id: requestId,
      organization_id: orgConfig.c_organization_id,
      team_id: payload.team_id,
      auto_recharge_enabled: orgConfig.auto_recharge_enabled
    });

    // 5. 检查是否启用自动充值
    if (!orgConfig.auto_recharge_enabled) {
      logger.info('自动充值未启用', { 
        request_id: requestId,
        organization_id: orgConfig.c_organization_id
      });
      
      await prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: {
          processed: true,
          success: true,
          response_data: { message: 'Auto recharge disabled', action: 'none' }
        }
      });

      return res.status(200).json({ 
        message: 'Auto recharge disabled',
        action: 'none',
        organization_id: orgConfig.c_organization_id,
        request_id: requestId
      });
    }

    // 6. 触发自动充值
    try {
      const rechargeResult = await handleAutoRecharge(orgConfig, payload, webhookEvent.id);
      
      await prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: {
          processed: true,
          success: true,
          response_data: rechargeResult
        }
      });

      logger.info('自动充值处理完成', { 
        request_id: requestId,
        organization_id: orgConfig.c_organization_id,
        result: rechargeResult
      });

      return res.status(200).json({
        success: true,
        action: 'auto_recharged',
        organization_id: orgConfig.c_organization_id,
        request_id: requestId,
        ...rechargeResult
      });

    } catch (rechargeError: any) {
      logger.error('自动充值处理失败', { 
        request_id: requestId,
        organization_id: orgConfig.c_organization_id,
        error: rechargeError.message
      });

      await prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: {
          processed: true,
          success: false,
          error_message: rechargeError.message
        }
      });

      return res.status(500).json({
        error: 'Auto recharge failed',
        message: rechargeError.message,
        organization_id: orgConfig.c_organization_id,
        request_id: requestId
      });
    }

  } catch (error: any) {
    logger.error('Webhook处理失败', { 
      request_id: requestId,
      error: error.message,
      stack: error.stack
    });

    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message,
      request_id: requestId
    });
  }
});

/**
 * 处理自动充值逻辑
 */
async function handleAutoRecharge(
  orgConfig: any,
  payload: LiteLLMWebhookPayload,
  webhookEventId: string
): Promise<any> {
  logger.info('开始处理自动充值', { 
    organization_id: orgConfig.c_organization_id,
    webhook_event_id: webhookEventId,
    current_usage: payload.current_usage,
    current_limit: payload.current_limit
  });

  // 1. 检查日充值次数限制
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const todayRecharges = await prisma.rechargeRecord.count({
    where: {
      c_organization_id: orgConfig.c_organization_id,
      triggered_by_webhook: true,
      createdAt: {
        gte: today
      }
    }
  });

  if (todayRecharges >= orgConfig.max_daily_recharges) {
    throw new Error(`Daily recharge limit exceeded (${todayRecharges}/${orgConfig.max_daily_recharges})`);
  }

  // 2. 获取当前余额信息
  const spendInfo = await kmsClient.getOrganizationSpend(orgConfig.c_organization_id);
  const currentBalance = parseFloat(spendInfo.remaining);
  const minimumBalance = Number(orgConfig.minimum_balance);
  const targetBalance = Number(orgConfig.target_balance);

  logger.info('当前余额信息', {
    organization_id: orgConfig.c_organization_id,
    current_balance: currentBalance,
    minimum_balance: minimumBalance,
    target_balance: targetBalance,
    spend: spendInfo.spend,
    quota: spendInfo.quota
  });

  // 3. 检查是否需要充值
  if (currentBalance >= minimumBalance) {
    logger.info('余额充足，无需充值', {
      organization_id: orgConfig.c_organization_id,
      current_balance: currentBalance,
      minimum_balance: minimumBalance
    });
    
    return {
      action: 'no_recharge_needed',
      current_balance: currentBalance,
      minimum_balance: minimumBalance,
      message: 'Balance is sufficient'
    };
  }

  // 4. 计算充值金额
  const rechargeAmount = Math.max(
    Number(orgConfig.minimum_recharge_amount),
    targetBalance - currentBalance
  );

  logger.info('计算充值金额', {
    organization_id: orgConfig.c_organization_id,
    current_balance: currentBalance,
    minimum_balance: minimumBalance,
    target_balance: targetBalance,
    minimum_recharge_amount: orgConfig.minimum_recharge_amount,
    recharge_amount: rechargeAmount
  });

  // 3. 检查支付方式是否存在
  if (!orgConfig.stripe_customer_id || !orgConfig.default_payment_method_id) {
    throw new Error(`No payment method configured for organization. Customer ID: ${orgConfig.stripe_customer_id}, Payment Method: ${orgConfig.default_payment_method_id}`);
  }

  // 4. 执行Stripe支付
  const paymentResult = await StripeService.processPayment({
    customerId: orgConfig.stripe_customer_id,
    amount: rechargeAmount,
    paymentMethodId: orgConfig.default_payment_method_id,
    metadata: {
      organization_id: orgConfig.c_organization_id,
      triggered_by: 'webhook',
      webhook_event_id: webhookEventId,
      litellm_team_id: payload.team_id
    }
  });

  if (!paymentResult.success) {
    throw new Error(`Stripe payment failed: ${paymentResult.error}`);
  }

  // 5. 记录充值记录
  const rechargeRecord = await prisma.rechargeRecord.create({
    data: {
      c_organization_id: orgConfig.c_organization_id,
      amount: rechargeAmount,
      fee: paymentResult.fee,
      totalCharged: paymentResult.totalAmount,
      balanceBefore: currentBalance,
      balanceAfter: currentBalance + rechargeAmount,
      stripePaymentIntentId: paymentResult.paymentIntentId || 'unknown',
      stripeStatus: paymentResult.status || 'unknown',
      status: 'COMPLETED',
      isAutomatic: true,
      triggeredBy: 'webhook',
      triggered_by_webhook: true,
      webhook_event_id: webhookEventId
    }
  });

  logger.info('充值记录创建成功', {
    organization_id: orgConfig.c_organization_id,
    recharge_record_id: rechargeRecord.id,
    amount: rechargeAmount,
    payment_intent_id: paymentResult.paymentIntentId
  });

  // 5. 同步组织配额到KMS（由于KMS不支持更新，我们只记录日志）
  try {
    await organizationSyncService.syncOrganizationToKMS(orgConfig.c_organization_id);
    logger.info('组织配额同步完成', { 
      organization_id: orgConfig.c_organization_id
    });
  } catch (syncError: any) {
    logger.warn('组织配额同步失败', { 
      organization_id: orgConfig.c_organization_id,
      error: syncError.message
    });
  }

  return {
    recharged_amount: rechargeAmount,
    payment_intent_id: paymentResult.paymentIntentId,
    recharge_record_id: rechargeRecord.id,
    balance_before: currentBalance,
    balance_after: currentBalance + rechargeAmount,
    daily_recharge_count: todayRecharges + 1,
    max_daily_recharges: orgConfig.max_daily_recharges
  };
}

/**
 * 测试webhook端点
 */
router.post('/test/simulate', async (req, res) => {
  const { organization_id, team_id, current_usage, current_limit } = req.body;
  
  logger.info('模拟webhook测试', { 
    organization_id,
    team_id,
    current_usage,
    current_limit
  });

  try {
    // 查找组织配置
    const orgConfig = await prisma.organizationBalanceConfig.findUnique({
      where: { c_organization_id: organization_id }
    });

    if (!orgConfig) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // 模拟webhook payload
    const payload: LiteLLMWebhookPayload = {
      event_type: 'limit_exceeded',
      team_id: team_id || orgConfig.litellm_team_id || 'test_team',
      organization_id,
      current_usage: current_usage || 520,
      current_limit: current_limit || 500,
      exceeded_by: (current_usage || 520) - (current_limit || 500),
      timestamp: new Date().toISOString()
    };

    // 生成测试签名
    const { generateWebhookSignature } = await import('../utils/webhookSecurity');
    const signature = generateWebhookSignature(payload);

    // 模拟发送到webhook端点
    const response = await fetch(`${req.protocol}://${req.get('host')}/webhooks/litellm/limit-exceeded`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': signature,
        'x-request-id': `test_${Date.now()}`
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    return res.status(200).json({
      success: true,
      test_payload: payload,
      webhook_response: result
    });

  } catch (error: any) {
    logger.error('Webhook测试失败', { error: error.message });
    return res.status(500).json({ 
      error: 'Test failed',
      message: error.message 
    });
  }
});

/**
 * 获取webhook事件列表
 */
router.get('/events', async (req, res) => {
  try {
    const { organization_id, limit = 50, offset = 0 } = req.query;
    
    const where = organization_id ? { organization_id: organization_id as string } : {};
    
    const events = await prisma.webhookEvent.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: parseInt(limit as string),
      skip: parseInt(offset as string)
    });

    return res.status(200).json({
      success: true,
      events: events.map(event => ({
        id: event.id,
        event_type: event.event_type,
        team_id: event.team_id,
        organization_id: event.organization_id,
        processed: event.processed,
        success: event.success,
        error_message: event.error_message,
        created_at: event.created_at
      })),
      total: events.length,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string)
    });

  } catch (error: any) {
    logger.error('获取webhook事件失败', { error: error.message });
    return res.status(500).json({ 
      error: 'Failed to get webhook events',
      message: error.message 
    });
  }
});

export default router;