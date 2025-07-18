import express from 'express';
import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import { kmsClient } from '../services/keyManagementClient';
import { StripeService } from '../config/stripe';

const router = express.Router();
const prisma = new PrismaClient();

/**
 * 获取所有组织配置
 */
router.get('/', async (req, res) => {
  try {
    const organizations = await prisma.organizationBalanceConfig.findMany({
      orderBy: { created_at: 'desc' }
    });

    res.json({
      success: true,
      organizations: organizations.map(org => ({
        id: org.id,
        c_organization_id: org.c_organization_id,
        litellm_team_id: org.litellm_team_id,
        minimum_balance: org.minimum_balance,
        target_balance: org.target_balance,
        auto_recharge_enabled: org.auto_recharge_enabled,
        stripe_customer_id: org.stripe_customer_id,
        has_payment_method: !!org.default_payment_method_id,
        default_payment_method_id: org.default_payment_method_id,
        max_daily_recharges: org.max_daily_recharges,
        minimum_recharge_amount: org.minimum_recharge_amount,
        created_at: org.created_at,
        updated_at: org.updated_at
      }))
    });
  } catch (error: any) {
    logger.error('获取组织配置失败', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch organizations'
    });
  }
});

/**
 * 获取单个组织配置
 */
router.get('/:organizationId', async (req, res) => {
  try {
    const { organizationId } = req.params;
    
    const organization = await prisma.organizationBalanceConfig.findUnique({
      where: { c_organization_id: organizationId }
    });

    if (!organization) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found'
      });
    }

    res.json({
      success: true,
      organization: {
        id: organization.id,
        c_organization_id: organization.c_organization_id,
        litellm_team_id: organization.litellm_team_id,
        minimum_balance: organization.minimum_balance,
        target_balance: organization.target_balance,
        auto_recharge_enabled: organization.auto_recharge_enabled,
        stripe_customer_id: organization.stripe_customer_id,
        default_payment_method_id: organization.default_payment_method_id,
        max_daily_recharges: organization.max_daily_recharges,
        minimum_recharge_amount: organization.minimum_recharge_amount,
        created_at: organization.created_at,
        updated_at: organization.updated_at
      }
    });
  } catch (error: any) {
    logger.error('获取组织配置失败', { error: error.message, organizationId: req.params.organizationId });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch organization'
    });
  }
});

/**
 * 创建或更新组织配置
 */
router.post('/', async (req, res) => {
  try {
    const {
      c_organization_id,
      litellm_team_id,
      minimum_balance = 100,
      target_balance = 1000,
      auto_recharge_enabled = true,
      max_daily_recharges = 5,
      minimum_recharge_amount = 100
    } = req.body;

    if (!c_organization_id) {
      return res.status(400).json({
        success: false,
        error: 'Organization ID is required'
      });
    }

    // 检查是否已存在
    const existingOrg = await prisma.organizationBalanceConfig.findUnique({
      where: { c_organization_id }
    });

    let organization;
    if (existingOrg) {
      // 更新现有配置
      organization = await prisma.organizationBalanceConfig.update({
        where: { c_organization_id },
        data: {
          litellm_team_id,
          minimum_balance,
          target_balance,
          auto_recharge_enabled,
          max_daily_recharges,
          minimum_recharge_amount
        }
      });
      
      logger.info('组织配置已更新', {
        c_organization_id,
        litellm_team_id,
        auto_recharge_enabled
      });
    } else {
      // 创建新配置
      organization = await prisma.organizationBalanceConfig.create({
        data: {
          c_organization_id,
          litellm_team_id,
          minimum_balance,
          target_balance,
          auto_recharge_enabled,
          max_daily_recharges,
          minimum_recharge_amount
        }
      });
      
      logger.info('组织配置已创建', {
        c_organization_id,
        litellm_team_id,
        auto_recharge_enabled
      });
    }

    res.json({
      success: true,
      organization: {
        id: organization.id,
        c_organization_id: organization.c_organization_id,
        litellm_team_id: organization.litellm_team_id,
        minimum_balance: organization.minimum_balance,
        target_balance: organization.target_balance,
        auto_recharge_enabled: organization.auto_recharge_enabled,
        stripe_customer_id: organization.stripe_customer_id,
        max_daily_recharges: organization.max_daily_recharges,
        minimum_recharge_amount: organization.minimum_recharge_amount
      }
    });
  } catch (error: any) {
    logger.error('保存组织配置失败', { error: error.message, body: req.body });
    res.status(500).json({
      success: false,
      error: 'Failed to save organization configuration'
    });
  }
});

/**
 * 同步组织配额到KMS
 */
router.post('/:organizationId/sync', async (req, res) => {
  try {
    const { organizationId } = req.params;
    
    const organization = await prisma.organizationBalanceConfig.findUnique({
      where: { c_organization_id: organizationId }
    });

    if (!organization) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found'
      });
    }

    if (!organization.litellm_team_id) {
      return res.status(400).json({
        success: false,
        error: 'LiteLLM team ID not configured'
      });
    }

    // 同步配额到KMS
    try {
      // 首先获取KMS中的组织信息
      const kmsOrganizations = await kmsClient.listOrganizations();
      const kmsOrg = kmsOrganizations.find(org => org.c_organization_id === organizationId);
      
      if (!kmsOrg) {
        return res.status(404).json({
          success: false,
          error: 'Organization not found in KMS'
        });
      }

      // 更新配额
      const newQuota = Math.max(100, Number(organization.target_balance));
      await kmsClient.updateOrganizationQuota(organizationId, newQuota);

      logger.info('组织配额同步成功', {
        c_organization_id: organizationId,
        old_quota: kmsOrg.quota,
        new_quota: newQuota,
        kms_id: kmsOrg.id
      });

      res.json({
        success: true,
        message: 'Organization quota synced successfully',
        old_quota: kmsOrg.quota,
        new_quota: newQuota
      });
    } catch (kmsError: any) {
      logger.error('KMS同步失败', { error: kmsError.message, organizationId });
      return res.status(500).json({
        success: false,
        error: `KMS sync failed: ${kmsError.message}`
      });
    }
  } catch (error: any) {
    logger.error('组织同步失败', { error: error.message, organizationId: req.params.organizationId });
    res.status(500).json({
      success: false,
      error: 'Failed to sync organization'
    });
  }
});

/**
 * 配置组织的Stripe客户
 */
router.post('/:organizationId/stripe-customer', async (req, res) => {
  try {
    const { organizationId } = req.params;
    
    const organization = await prisma.organizationBalanceConfig.findUnique({
      where: { c_organization_id: organizationId }
    });

    if (!organization) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found'
      });
    }

    let customerId = organization.stripe_customer_id;
    
    // 如果没有Stripe客户，或客户ID无效，创建一个新的
    if (!customerId || customerId === 'cus_test123') {
      try {
        const customer = await StripeService.createCustomer({
          metadata: {
            organization_id: organizationId,
            litellm_team_id: organization.litellm_team_id || ''
          }
        });
        
        customerId = customer.id;
        
        // 更新数据库中的客户ID
        await prisma.organizationBalanceConfig.update({
          where: { c_organization_id: organizationId },
          data: { stripe_customer_id: customerId }
        });
        
        logger.info('Stripe客户已创建', {
          c_organization_id: organizationId,
          stripe_customer_id: customerId
        });
      } catch (stripeError: any) {
        logger.error('创建Stripe客户失败', { error: stripeError.message, organizationId });
        return res.status(500).json({
          success: false,
          error: `Failed to create Stripe customer: ${stripeError.message}`
        });
      }
    }

    res.json({
      success: true,
      stripe_customer_id: customerId
    });
  } catch (error: any) {
    logger.error('配置Stripe客户失败', { error: error.message, organizationId: req.params.organizationId });
    res.status(500).json({
      success: false,
      error: 'Failed to configure Stripe customer'
    });
  }
});

/**
 * 创建组织的Stripe Setup Intent
 */
router.post('/:organizationId/setup-intent', async (req, res) => {
  try {
    const { organizationId } = req.params;
    
    const organization = await prisma.organizationBalanceConfig.findUnique({
      where: { c_organization_id: organizationId }
    });

    if (!organization) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found'
      });
    }

    let customerId = organization.stripe_customer_id;
    
    // 如果没有Stripe客户，或客户ID无效，先创建一个
    if (!customerId || customerId === 'cus_test123') {
      try {
        const customer = await StripeService.createCustomer({
          metadata: {
            organization_id: organizationId,
            litellm_team_id: organization.litellm_team_id || ''
          }
        });
        
        customerId = customer.id;
        
        await prisma.organizationBalanceConfig.update({
          where: { c_organization_id: organizationId },
          data: { stripe_customer_id: customerId }
        });
      } catch (stripeError: any) {
        logger.error('创建Stripe客户失败', { error: stripeError.message, organizationId });
        return res.status(500).json({
          success: false,
          error: `Failed to create Stripe customer: ${stripeError.message}`
        });
      }
    }

    // 创建Setup Intent
    try {
      const setupIntent = await StripeService.createSetupIntent({
        customer: customerId,
        metadata: {
          organization_id: organizationId,
          litellm_team_id: organization.litellm_team_id || ''
        }
      });

      res.json({
        success: true,
        client_secret: setupIntent.client_secret
      });
    } catch (stripeError: any) {
      logger.error('创建Setup Intent失败', { error: stripeError.message, organizationId });
      res.status(500).json({
        success: false,
        error: `Failed to create setup intent: ${stripeError.message}`
      });
    }
  } catch (error: any) {
    logger.error('创建Setup Intent失败', { error: error.message, organizationId: req.params.organizationId });
    res.status(500).json({
      success: false,
      error: 'Failed to create setup intent'
    });
  }
});

/**
 * 获取组织的支付方式
 */
router.get('/:organizationId/payment-methods', async (req, res) => {
  try {
    const { organizationId } = req.params;
    
    const organization = await prisma.organizationBalanceConfig.findUnique({
      where: { c_organization_id: organizationId }
    });

    if (!organization || !organization.stripe_customer_id) {
      return res.json({
        success: true,
        payment_methods: []
      });
    }

    try {
      const paymentMethods = await StripeService.listPaymentMethods(organization.stripe_customer_id);
      
      res.json({
        success: true,
        payment_methods: paymentMethods.map(pm => ({
          id: pm.id,
          type: pm.type,
          card: pm.card ? {
            brand: pm.card.brand,
            last4: pm.card.last4,
            exp_month: pm.card.exp_month,
            exp_year: pm.card.exp_year
          } : null,
          created: pm.created
        }))
      });
    } catch (stripeError: any) {
      logger.error('获取支付方式失败', { error: stripeError.message, organizationId });
      res.status(500).json({
        success: false,
        error: `Failed to get payment methods: ${stripeError.message}`
      });
    }
  } catch (error: any) {
    logger.error('获取支付方式失败', { error: error.message, organizationId: req.params.organizationId });
    res.status(500).json({
      success: false,
      error: 'Failed to get payment methods'
    });
  }
});

/**
 * 添加支付方式到组织
 */
router.post('/:organizationId/payment-methods', async (req, res) => {
  try {
    const { organizationId } = req.params;
    const { payment_method_id, set_as_default } = req.body;
    
    if (!payment_method_id) {
      return res.status(400).json({
        success: false,
        error: 'Payment method ID is required'
      });
    }

    const organization = await prisma.organizationBalanceConfig.findUnique({
      where: { c_organization_id: organizationId }
    });

    if (!organization) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found'
      });
    }

    // 确保有 Stripe 客户
    let customerId = organization.stripe_customer_id;
    if (!customerId || customerId === 'cus_test123') {
      try {
        const customer = await StripeService.createCustomer({
          metadata: {
            organization_id: organizationId,
            litellm_team_id: organization.litellm_team_id || ''
          }
        });
        
        customerId = customer.id;
        
        await prisma.organizationBalanceConfig.update({
          where: { c_organization_id: organizationId },
          data: { stripe_customer_id: customerId }
        });
      } catch (stripeError: any) {
        logger.error('创建Stripe客户失败', { error: stripeError.message, organizationId });
        return res.status(500).json({
          success: false,
          error: `Failed to create Stripe customer: ${stripeError.message}`
        });
      }
    }

    try {
      // 将支付方式附加到客户
      await StripeService.attachPaymentMethodToCustomer(payment_method_id, customerId);
      
      // 如果需要设为默认
      if (set_as_default || !organization.default_payment_method_id) {
        await StripeService.setDefaultPaymentMethod(customerId, payment_method_id);
        
        await prisma.organizationBalanceConfig.update({
          where: { c_organization_id: organizationId },
          data: { default_payment_method_id: payment_method_id }
        });
      }

      // 获取支付方式详情
      const paymentMethod = await StripeService.getPaymentMethod(payment_method_id);
      
      logger.info('支付方式已添加', {
        c_organization_id: organizationId,
        stripe_customer_id: customerId,
        payment_method_id: payment_method_id,
        set_as_default: set_as_default || !organization.default_payment_method_id
      });

      res.json({
        success: true,
        payment_method: {
          id: paymentMethod.id,
          type: paymentMethod.type,
          brand: paymentMethod.card?.brand,
          last4: paymentMethod.card?.last4,
          exp_month: paymentMethod.card?.exp_month,
          exp_year: paymentMethod.card?.exp_year,
          is_default: set_as_default || !organization.default_payment_method_id,
          created_at: new Date(paymentMethod.created * 1000).toISOString()
        }
      });
    } catch (stripeError: any) {
      logger.error('添加支付方式失败', { error: stripeError.message, organizationId, payment_method_id });
      res.status(500).json({
        success: false,
        error: `Failed to add payment method: ${stripeError.message}`
      });
    }
  } catch (error: any) {
    logger.error('添加支付方式失败', { error: error.message, organizationId: req.params.organizationId });
    res.status(500).json({
      success: false,
      error: 'Failed to add payment method'
    });
  }
});

/**
 * 删除组织配置
 */
router.delete('/:organizationId', async (req, res) => {
  try {
    const { organizationId } = req.params;
    
    const organization = await prisma.organizationBalanceConfig.findUnique({
      where: { c_organization_id: organizationId }
    });

    if (!organization) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found'
      });
    }

    // 删除配置
    await prisma.organizationBalanceConfig.delete({
      where: { c_organization_id: organizationId }
    });

    logger.info('组织配置已删除', { c_organization_id: organizationId });

    res.json({
      success: true,
      message: 'Organization configuration deleted successfully'
    });
  } catch (error: any) {
    logger.error('删除组织配置失败', { error: error.message, organizationId: req.params.organizationId });
    res.status(500).json({
      success: false,
      error: 'Failed to delete organization configuration'
    });
  }
});

/**
 * 设置组织的默认支付方式
 */
router.post('/:organizationId/default-payment-method', async (req, res) => {
  try {
    const { organizationId } = req.params;
    const { paymentMethodId } = req.body;
    
    if (!paymentMethodId) {
      return res.status(400).json({
        success: false,
        error: 'Payment method ID is required'
      });
    }

    const organization = await prisma.organizationBalanceConfig.findUnique({
      where: { c_organization_id: organizationId }
    });

    if (!organization || !organization.stripe_customer_id) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found or no Stripe customer configured'
      });
    }

    try {
      // 验证支付方式是否属于该客户
      const paymentMethod = await StripeService.getPaymentMethod(paymentMethodId);
      if (paymentMethod.customer !== organization.stripe_customer_id) {
        return res.status(400).json({
          success: false,
          error: 'Payment method does not belong to this customer'
        });
      }

      // 设置为Stripe中的默认支付方式
      await StripeService.setDefaultPaymentMethod(organization.stripe_customer_id, paymentMethodId);

      // 更新数据库中的默认支付方式
      await prisma.organizationBalanceConfig.update({
        where: { c_organization_id: organizationId },
        data: { 
          default_payment_method_id: paymentMethodId 
        }
      });

      logger.info('默认支付方式已设置', {
        c_organization_id: organizationId,
        stripe_customer_id: organization.stripe_customer_id,
        payment_method_id: paymentMethodId
      });

      res.json({
        success: true,
        message: 'Default payment method set successfully',
        payment_method_id: paymentMethodId
      });
    } catch (stripeError: any) {
      logger.error('设置默认支付方式失败', { error: stripeError.message, organizationId, paymentMethodId });
      res.status(500).json({
        success: false,
        error: `Failed to set default payment method: ${stripeError.message}`
      });
    }
  } catch (error: any) {
    logger.error('设置默认支付方式失败', { error: error.message, organizationId: req.params.organizationId });
    res.status(500).json({
      success: false,
      error: 'Failed to set default payment method'
    });
  }
});

/**
 * 自动检测并设置默认支付方式（如果还没有设置）
 */
router.post('/:organizationId/auto-set-payment-method', async (req, res) => {
  try {
    const { organizationId } = req.params;
    
    const organization = await prisma.organizationBalanceConfig.findUnique({
      where: { c_organization_id: organizationId }
    });

    if (!organization || !organization.stripe_customer_id) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found or no Stripe customer configured'
      });
    }

    // 如果已经有默认支付方式，直接返回
    if (organization.default_payment_method_id) {
      return res.json({
        success: true,
        message: 'Default payment method already set',
        payment_method_id: organization.default_payment_method_id
      });
    }

    try {
      // 获取客户的所有支付方式
      const paymentMethods = await StripeService.listPaymentMethods(organization.stripe_customer_id);
      
      if (paymentMethods.length === 0) {
        return res.json({
          success: false,
          message: 'No payment methods found for this customer'
        });
      }

      // 使用第一个支付方式作为默认方式
      const defaultPaymentMethod = paymentMethods[0];

      // 设置为Stripe中的默认支付方式
      await StripeService.setDefaultPaymentMethod(organization.stripe_customer_id, defaultPaymentMethod.id);

      // 更新数据库中的默认支付方式
      await prisma.organizationBalanceConfig.update({
        where: { c_organization_id: organizationId },
        data: { 
          default_payment_method_id: defaultPaymentMethod.id 
        }
      });

      logger.info('自动设置默认支付方式', {
        c_organization_id: organizationId,
        stripe_customer_id: organization.stripe_customer_id,
        payment_method_id: defaultPaymentMethod.id,
        card_last4: defaultPaymentMethod.card?.last4
      });

      res.json({
        success: true,
        message: 'Default payment method set automatically',
        payment_method_id: defaultPaymentMethod.id,
        card_info: defaultPaymentMethod.card ? {
          brand: defaultPaymentMethod.card.brand,
          last4: defaultPaymentMethod.card.last4,
          exp_month: defaultPaymentMethod.card.exp_month,
          exp_year: defaultPaymentMethod.card.exp_year
        } : null
      });
    } catch (stripeError: any) {
      logger.error('自动设置默认支付方式失败', { error: stripeError.message, organizationId });
      res.status(500).json({
        success: false,
        error: `Failed to auto-set payment method: ${stripeError.message}`
      });
    }
  } catch (error: any) {
    logger.error('自动设置默认支付方式失败', { error: error.message, organizationId: req.params.organizationId });
    res.status(500).json({
      success: false,
      error: 'Failed to auto-set payment method'
    });
  }
});

/**
 * 创建组织的Stripe Portal会话
 */
router.post('/:organizationId/portal', async (req, res) => {
  try {
    const { organizationId } = req.params;
    const { returnUrl } = req.body;
    
    const organization = await prisma.organizationBalanceConfig.findUnique({
      where: { c_organization_id: organizationId }
    });

    if (!organization || !organization.stripe_customer_id) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found or no Stripe customer configured'
      });
    }

    try {
      // 创建Stripe Customer Portal会话
      const session = await StripeService.createPortalSession(
        organization.stripe_customer_id,
        returnUrl || `${process.env.BASE_URL || 'http://localhost:3000'}/organization-setup.html`
      );

      res.json({
        success: true,
        portalUrl: session.url
      });
    } catch (stripeError: any) {
      logger.error('创建Portal会话失败', { error: stripeError.message, organizationId });
      res.status(500).json({
        success: false,
        error: `Failed to create portal session: ${stripeError.message}`
      });
    }
  } catch (error: any) {
    logger.error('创建Portal会话失败', { error: error.message, organizationId: req.params.organizationId });
    res.status(500).json({
      success: false,
      error: 'Failed to create portal session'
    });
  }
});

export default router;