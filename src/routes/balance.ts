import express from 'express';
import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import BalanceManager from '../services/balanceManager';

const router = express.Router();
const prisma = new PrismaClient();

/**
 * 获取组织余额详细信息
 */
router.get('/:organizationId', async (req, res) => {
  try {
    const { organizationId } = req.params;
    
    const balanceDetails = await BalanceManager.getOrganizationBalanceDetails(organizationId);
    
    res.json({
      success: true,
      data: balanceDetails
    });
  } catch (error: any) {
    logger.error('获取组织余额详情失败', { 
      organizationId: req.params.organizationId, 
      error: error.message 
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to get organization balance',
      message: error.message
    });
  }
});

/**
 * 手动检查余额并触发自动充值（前端点击检查）
 */
router.post('/:organizationId/check-recharge', async (req, res) => {
  try {
    const { organizationId } = req.params;
    
    logger.info('手动检查自动充值', { organization_id: organizationId });
    
    // 1. 检查是否需要充值
    const checkResult = await BalanceManager.checkAndTriggerAutoRecharge(organizationId);
    
    if (!checkResult.needsRecharge) {
      return res.json({
        success: true,
        action: 'no_recharge_needed',
        data: checkResult
      });
    }
    
    // 2. 如果需要充值且有充值金额，执行充值
    if (checkResult.chargeAmount && checkResult.chargeAmount > 0) {
      const rechargeResult = await BalanceManager.executeAutoRecharge(
        organizationId, 
        checkResult.chargeAmount
      );
      
      if (rechargeResult.success) {
        return res.json({
          success: true,
          action: 'auto_recharged',
          data: {
            ...checkResult,
            rechargeResult
          }
        });
      } else {
        return res.status(500).json({
          success: false,
          action: 'recharge_failed',
          error: rechargeResult.error,
          data: checkResult
        });
      }
    } else {
      return res.json({
        success: true,
        action: 'recharge_not_possible',
        reason: checkResult.reason,
        data: checkResult
      });
    }
    
  } catch (error: any) {
    logger.error('检查自动充值失败', { 
      organizationId: req.params.organizationId, 
      error: error.message 
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to check auto recharge',
      message: error.message
    });
  }
});

/**
 * 更新组织余额配置
 */
router.put('/:organizationId/config', async (req, res) => {
  try {
    const { organizationId } = req.params;
    const {
      least_balance,
      add_balance_up_to,
      org_limit,
      auto_recharge_enabled
    } = req.body;
    
    // 更新组织配置
    const updatedConfig = await prisma.organizationBalanceConfig.update({
      where: { c_organization_id: organizationId },
      data: {
        least_balance: least_balance ? parseFloat(least_balance) : undefined,
        add_balance_up_to: add_balance_up_to ? parseFloat(add_balance_up_to) : undefined,
        org_limit: org_limit ? parseFloat(org_limit) : undefined,
        auto_recharge_enabled: auto_recharge_enabled !== undefined ? auto_recharge_enabled : undefined
      }
    });
    
    logger.info('组织余额配置已更新', {
      organization_id: organizationId,
      least_balance,
      add_balance_up_to,
      org_limit,
      auto_recharge_enabled
    });
    
    res.json({
      success: true,
      data: {
        id: updatedConfig.id,
        c_organization_id: updatedConfig.c_organization_id,
        current_balance: parseFloat(updatedConfig.current_balance.toString()),
        least_balance: parseFloat(updatedConfig.least_balance.toString()),
        add_balance_up_to: parseFloat(updatedConfig.add_balance_up_to.toString()),
        org_limit: parseFloat(updatedConfig.org_limit.toString()),
        auto_recharge_enabled: updatedConfig.auto_recharge_enabled
      }
    });
    
  } catch (error: any) {
    logger.error('更新组织余额配置失败', { 
      organizationId: req.params.organizationId, 
      error: error.message 
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to update balance config',
      message: error.message
    });
  }
});

/**
 * 获取组织余额历史
 */
router.get('/:organizationId/history', async (req, res) => {
  try {
    const { organizationId } = req.params;
    const { limit = 20, offset = 0 } = req.query;
    
    const history = await prisma.organizationBalanceHistory.findMany({
      where: { c_organization_id: organizationId },
      orderBy: { created_at: 'desc' },
      take: parseInt(limit as string),
      skip: parseInt(offset as string)
    });
    
    res.json({
      success: true,
      data: history.map(h => ({
        id: h.id,
        balance_before: parseFloat(h.balance_before.toString()),
        balance_after: parseFloat(h.balance_after.toString()),
        change_amount: parseFloat(h.change_amount.toString()),
        change_type: h.change_type,
        description: h.description,
        created_at: h.created_at
      }))
    });
    
  } catch (error: any) {
    logger.error('获取组织余额历史失败', { 
      organizationId: req.params.organizationId, 
      error: error.message 
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to get balance history',
      message: error.message
    });
  }
});

/**
 * 获取组织月度统计
 */
router.get('/:organizationId/monthly-stats', async (req, res) => {
  try {
    const { organizationId } = req.params;
    const { year, month } = req.query;
    
    let whereCondition: any = { c_organization_id: organizationId };
    
    if (year) {
      whereCondition.year = parseInt(year as string);
    }
    if (month) {
      whereCondition.month = parseInt(month as string);
    }
    
    const stats = await prisma.organizationMonthlyStats.findMany({
      where: whereCondition,
      orderBy: [
        { year: 'desc' },
        { month: 'desc' }
      ]
    });
    
    res.json({
      success: true,
      data: stats.map(s => ({
        id: s.id,
        year: s.year,
        month: s.month,
        balance_start_month: parseFloat(s.balance_start_month.toString()),
        deposit_this_month: parseFloat(s.deposit_this_month.toString()),
        usage_this_month: parseFloat(s.usage_this_month.toString()),
        balance_end_month: parseFloat(s.balance_end_month.toString()),
        created_at: s.created_at,
        updated_at: s.updated_at
      }))
    });
    
  } catch (error: any) {
    logger.error('获取组织月度统计失败', { 
      organizationId: req.params.organizationId, 
      error: error.message 
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to get monthly stats',
      message: error.message
    });
  }
});

/**
 * 手动更新LiteLLM team limit
 */
router.post('/:organizationId/update-team-limit', async (req, res) => {
  try {
    const { organizationId } = req.params;
    
    await BalanceManager.updateTeamLimitInLiteLLM(organizationId);
    
    res.json({
      success: true,
      message: 'Team limit updated successfully'
    });
    
  } catch (error: any) {
    logger.error('更新team limit失败', { 
      organizationId: req.params.organizationId, 
      error: error.message 
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to update team limit',
      message: error.message
    });
  }
});

export default router;