import express from 'express';
import Joi from 'joi';
import { db } from '../config/database';
import { BalanceMonitorService } from '../services/BalanceMonitorService';
import { AutoRechargeService } from '../services/AutoRechargeService';
import { logger } from '../config/logger';
import { BalanceConfigInput } from '../types';
import { Decimal } from '@prisma/client/runtime/library';

const router = express.Router();
const balanceMonitor = new BalanceMonitorService();
const autoRechargeService = new AutoRechargeService();

const balanceConfigSchema = Joi.object({
  minimumBalance: Joi.number().min(0).required(),
  targetBalance: Joi.number().min(0).required(),
  autoRechargeEnabled: Joi.boolean().required(),
  defaultPaymentMethodId: Joi.string().optional(),
  maxDailyRecharges: Joi.number().min(1).max(10).optional(),
  maxRechargeAmount: Joi.number().min(100).max(100000).optional()
}).custom((value, helpers) => {
  if (value.targetBalance <= value.minimumBalance) {
    return helpers.error('any.invalid', { 
      message: 'Target balance must be greater than minimum balance' 
    });
  }
  return value;
});

router.get('/config/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const config = await db.balanceConfig.findUnique({
      where: { userId },
      include: {
        user: {
          select: {
            email: true,
            stripeCustomerId: true
          }
        }
      }
    });

    if (!config) {
      return res.status(404).json({ error: 'Balance configuration not found' });
    }

    res.json({
      ...config,
      minimumBalance: config.minimumBalance.toNumber(),
      targetBalance: config.targetBalance.toNumber(),
      maxRechargeAmount: config.maxRechargeAmount.toNumber()
    });

  } catch (error) {
    logger.error('Failed to get balance config', { userId: req.params.userId, error });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/config/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { error, value } = balanceConfigSchema.validate(req.body);

    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const configData: BalanceConfigInput = value;

    const user = await db.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const config = await db.balanceConfig.upsert({
      where: { userId },
      update: {
        minimumBalance: new Decimal(configData.minimumBalance),
        targetBalance: new Decimal(configData.targetBalance),
        autoRechargeEnabled: configData.autoRechargeEnabled,
        defaultPaymentMethodId: configData.defaultPaymentMethodId,
        maxDailyRecharges: configData.maxDailyRecharges || 3,
        maxRechargeAmount: new Decimal(configData.maxRechargeAmount || 10000)
      },
      create: {
        userId,
        minimumBalance: new Decimal(configData.minimumBalance),
        targetBalance: new Decimal(configData.targetBalance),
        autoRechargeEnabled: configData.autoRechargeEnabled,
        defaultPaymentMethodId: configData.defaultPaymentMethodId,
        maxDailyRecharges: configData.maxDailyRecharges || 3,
        maxRechargeAmount: new Decimal(configData.maxRechargeAmount || 10000)
      }
    });

    logger.info('Balance configuration updated', { userId, config: configData });

    res.json({
      ...config,
      minimumBalance: config.minimumBalance.toNumber(),
      targetBalance: config.targetBalance.toNumber(),
      maxRechargeAmount: config.maxRechargeAmount.toNumber()
    });

  } catch (error) {
    logger.error('Failed to update balance config', { userId: req.params.userId, error });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/status/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const balanceCheck = await balanceMonitor.checkUserBalance(userId);
    const canRecharge = await balanceMonitor.canUserRecharge(userId);

    res.json({
      ...balanceCheck,
      canRecharge: canRecharge.canRecharge,
      rechargeBlockedReason: canRecharge.reason
    });

  } catch (error) {
    logger.error('Failed to get balance status', { userId: req.params.userId, error });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/recharge/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await autoRechargeService.executeAutoRecharge(userId);

    if (result.success) {
      res.json({
        success: true,
        message: 'Recharge completed successfully',
        rechargeRecordId: result.rechargeRecordId,
        amount: result.amount,
        fee: result.fee
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error
      });
    }

  } catch (error) {
    logger.error('Manual recharge failed', { userId: req.params.userId, error });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    
    const skip = (Number(page) - 1) * Number(limit);

    const [records, total] = await Promise.all([
      db.rechargeRecord.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(limit)
      }),
      db.rechargeRecord.count({ where: { userId } })
    ]);

    const formattedRecords = records.map(record => ({
      ...record,
      amount: record.amount.toNumber(),
      fee: record.fee.toNumber(),
      totalCharged: record.totalCharged.toNumber(),
      balanceBefore: record.balanceBefore.toNumber(),
      balanceAfter: record.balanceAfter.toNumber()
    }));

    res.json({
      records: formattedRecords,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit))
      }
    });

  } catch (error) {
    logger.error('Failed to get recharge history', { userId: req.params.userId, error });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;