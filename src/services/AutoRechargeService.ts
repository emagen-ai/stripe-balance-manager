import { db } from '../config/database';
import { StripeService } from '../config/stripe';
import { logger } from '../config/logger';
import { BalanceMonitorService } from './BalanceMonitorService';
import { AutoRechargeResult, RechargeRequest, RechargeStatus } from '../types';
import { Decimal } from '@prisma/client/runtime/library';

export class AutoRechargeService {
  private balanceMonitor: BalanceMonitorService;

  constructor() {
    this.balanceMonitor = new BalanceMonitorService();
  }

  async executeAutoRecharge(userId: string): Promise<AutoRechargeResult> {
    try {
      const canRechargeResult = await this.balanceMonitor.canUserRecharge(userId);
      if (!canRechargeResult.canRecharge) {
        return {
          success: false,
          error: canRechargeResult.reason
        };
      }

      const balanceCheck = await this.balanceMonitor.checkUserBalance(userId);
      if (!balanceCheck.needsRecharge || !balanceCheck.calculation) {
        return {
          success: false,
          error: 'No recharge needed'
        };
      }

      const user = await db.user.findUnique({
        where: { id: userId },
        include: { balanceConfig: true }
      });

      if (!user?.balanceConfig?.defaultPaymentMethodId) {
        return {
          success: false,
          error: 'No default payment method configured'
        };
      }

      const rechargeRequest: RechargeRequest = {
        userId,
        amount: balanceCheck.calculation.rechargeAmount,
        paymentMethodId: user.balanceConfig.defaultPaymentMethodId,
        balanceBefore: balanceCheck.currentBalance,
        isAutomatic: true
      };

      const result = await this.processRecharge(rechargeRequest);
      
      if (result.success) {
        await this.updateDailyRechargeCount(userId);
      }

      return result;

    } catch (error) {
      logger.error('Auto recharge execution failed', { userId, error });
      return {
        success: false,
        error: 'System error during auto recharge'
      };
    }
  }

  async processRecharge(request: RechargeRequest): Promise<AutoRechargeResult> {
    const { userId, amount, paymentMethodId, balanceBefore, isAutomatic } = request;
    
    try {
      const user = await db.user.findUnique({
        where: { id: userId }
      });

      if (!user) {
        throw new Error('User not found');
      }

      const fee = StripeService.calculateFee(amount);
      const totalCharge = amount + fee;

      const rechargeRecord = await db.rechargeRecord.create({
        data: {
          userId,
          amount: new Decimal(amount),
          fee: new Decimal(fee),
          totalCharged: new Decimal(totalCharge),
          balanceBefore: new Decimal(balanceBefore),
          balanceAfter: new Decimal(balanceBefore + amount),
          stripePaymentIntentId: '',
          stripeStatus: 'pending',
          status: RechargeStatus.PENDING,
          isAutomatic
        }
      });

      try {
        const paymentIntent = await StripeService.createPaymentIntent(
          user.stripeCustomerId,
          totalCharge,
          paymentMethodId,
          `${isAutomatic ? 'Automatic' : 'Manual'} balance recharge`
        );

        await db.rechargeRecord.update({
          where: { id: rechargeRecord.id },
          data: {
            stripePaymentIntentId: paymentIntent.id,
            stripeStatus: paymentIntent.status,
            status: RechargeStatus.PROCESSING
          }
        });

        if (paymentIntent.status === 'succeeded') {
          await StripeService.updateCustomerBalance(
            user.stripeCustomerId,
            amount,
            `Balance recharge from payment ${paymentIntent.id}`
          );

          await db.rechargeRecord.update({
            where: { id: rechargeRecord.id },
            data: {
              status: RechargeStatus.COMPLETED,
              stripeStatus: 'succeeded'
            }
          });

          logger.info('Recharge completed successfully', {
            userId,
            rechargeRecordId: rechargeRecord.id,
            amount,
            fee,
            totalCharge,
            paymentIntentId: paymentIntent.id
          });

          return {
            success: true,
            rechargeRecordId: rechargeRecord.id,
            amount,
            fee
          };
        } else {
          await db.rechargeRecord.update({
            where: { id: rechargeRecord.id },
            data: {
              status: RechargeStatus.FAILED,
              failureReason: `Payment intent status: ${paymentIntent.status}`
            }
          });

          return {
            success: false,
            error: `Payment not completed. Status: ${paymentIntent.status}`
          };
        }

      } catch (stripeError) {
        await db.rechargeRecord.update({
          where: { id: rechargeRecord.id },
          data: {
            status: RechargeStatus.FAILED,
            failureReason: stripeError instanceof Error ? stripeError.message : 'Stripe error'
          }
        });

        throw stripeError;
      }

    } catch (error) {
      logger.error('Recharge processing failed', { userId, amount, error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Processing error'
      };
    }
  }

  async processAllAutoRecharges(): Promise<{ total: number; successful: number; failed: number }> {
    try {
      const balanceChecks = await this.balanceMonitor.checkAllUsersBalance();
      const usersNeedingRecharge = balanceChecks.filter(check => check.result.needsRecharge);

      logger.info('Starting batch auto recharge', {
        totalUsers: balanceChecks.length,
        usersNeedingRecharge: usersNeedingRecharge.length
      });

      const results = await Promise.allSettled(
        usersNeedingRecharge.map(check => this.executeAutoRecharge(check.userId))
      );

      const successful = results.filter(result => 
        result.status === 'fulfilled' && result.value.success
      ).length;
      
      const failed = results.length - successful;

      logger.info('Batch auto recharge completed', {
        total: results.length,
        successful,
        failed
      });

      return {
        total: results.length,
        successful,
        failed
      };

    } catch (error) {
      logger.error('Batch auto recharge failed', error);
      throw error;
    }
  }

  private async updateDailyRechargeCount(userId: string): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await db.dailyRechargeLimit.upsert({
      where: {
        userId_date: {
          userId,
          date: today
        }
      },
      update: {
        count: {
          increment: 1
        }
      },
      create: {
        userId,
        date: today,
        count: 1
      }
    });
  }
}