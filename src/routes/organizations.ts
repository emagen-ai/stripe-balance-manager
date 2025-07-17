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
    
    // 如果没有Stripe客户，创建一个
    if (!customerId) {
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
    
    // 如果没有Stripe客户，先创建一个
    if (!customerId) {
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

export default router;