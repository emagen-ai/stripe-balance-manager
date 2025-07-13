import { db } from '../config/database';
import { StripeService } from '../config/stripe';
import { logger } from '../config/logger';
import { BalanceCheckResult, RechargeCalculation } from '../types';

export class BalanceMonitorService {
  async checkUserBalance(userId: string): Promise<BalanceCheckResult> {
    try {
      const user = await db.user.findUnique({
        where: { id: userId },
        include: { balanceConfig: true }
      });

      if (!user || !user.balanceConfig) {
        throw new Error('User or balance configuration not found');
      }

      if (!user.balanceConfig.autoRechargeEnabled) {
        return {
          needsRecharge: false,
          currentBalance: 0,
          minimumBalance: user.balanceConfig.minimumBalance.toNumber(),
          targetBalance: user.balanceConfig.targetBalance.toNumber()
        };
      }

      const currentBalance = await StripeService.getCustomerBalance(user.stripeCustomerId);
      const currentBalanceDecimal = currentBalance / 100; // Convert from cents
      const minimumBalance = user.balanceConfig.minimumBalance.toNumber();
      const targetBalance = user.balanceConfig.targetBalance.toNumber();

      const needsRecharge = currentBalanceDecimal < minimumBalance;
      
      let calculation: RechargeCalculation | undefined;
      
      if (needsRecharge) {
        const rechargeAmount = targetBalance - currentBalanceDecimal;
        const fee = StripeService.calculateFee(rechargeAmount);
        const totalCharge = rechargeAmount + fee;
        const newBalance = currentBalanceDecimal + rechargeAmount;

        calculation = {
          rechargeAmount,
          fee,
          totalCharge,
          newBalance
        };
      }

      logger.info('Balance check completed', {
        userId,
        currentBalance: currentBalanceDecimal,
        minimumBalance,
        targetBalance,
        needsRecharge,
        calculation
      });

      return {
        needsRecharge,
        currentBalance: currentBalanceDecimal,
        minimumBalance,
        targetBalance,
        calculation
      };

    } catch (error) {
      logger.error('Failed to check user balance', { userId, error });
      throw error;
    }
  }

  async checkAllUsersBalance(): Promise<{ userId: string; result: BalanceCheckResult }[]> {
    try {
      const users = await db.user.findMany({
        where: {
          balanceConfig: {
            autoRechargeEnabled: true
          }
        },
        include: { balanceConfig: true }
      });

      const results = await Promise.allSettled(
        users.map(async (user) => ({
          userId: user.id,
          result: await this.checkUserBalance(user.id)
        }))
      );

      const successfulResults = results
        .filter((result): result is PromiseFulfilledResult<{ userId: string; result: BalanceCheckResult }> => 
          result.status === 'fulfilled'
        )
        .map(result => result.value);

      const failedResults = results.filter(result => result.status === 'rejected');
      
      if (failedResults.length > 0) {
        logger.warn('Some balance checks failed', { 
          failedCount: failedResults.length,
          totalCount: users.length 
        });
      }

      logger.info('Batch balance check completed', {
        totalUsers: users.length,
        successfulChecks: successfulResults.length,
        usersNeedingRecharge: successfulResults.filter(r => r.result.needsRecharge).length
      });

      return successfulResults;

    } catch (error) {
      logger.error('Failed to check all users balance', error);
      throw error;
    }
  }

  async canUserRecharge(userId: string): Promise<{ canRecharge: boolean; reason?: string }> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const dailyLimit = await db.dailyRechargeLimit.findUnique({
        where: {
          userId_date: {
            userId,
            date: today
          }
        }
      });

      const user = await db.user.findUnique({
        where: { id: userId },
        include: { balanceConfig: true }
      });

      if (!user?.balanceConfig) {
        return { canRecharge: false, reason: 'User configuration not found' };
      }

      const maxDailyRecharges = user.balanceConfig.maxDailyRecharges;
      const currentCount = dailyLimit?.count || 0;

      if (currentCount >= maxDailyRecharges) {
        return { 
          canRecharge: false, 
          reason: `Daily recharge limit reached (${currentCount}/${maxDailyRecharges})` 
        };
      }

      return { canRecharge: true };

    } catch (error) {
      logger.error('Failed to check if user can recharge', { userId, error });
      return { canRecharge: false, reason: 'System error' };
    }
  }
}