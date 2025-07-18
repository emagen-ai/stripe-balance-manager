import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import { kmsClient } from './keyManagementClient';
import { StripeService } from '../config/stripe';

const prisma = new PrismaClient();

export class BalanceManager {
  /**
   * 核心职责1: 记录和管理 org 的余额（balance）
   * 根据公式: balance = balance_last_month + deposit_this_month - usage_this_month
   */
  static async updateOrganizationBalance(organizationId: string): Promise<{
    currentBalance: number;
    lastMonthBalance: number;
    depositThisMonth: number;
    usageThisMonth: number;
  }> {
    try {
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;
      const lastMonth = currentMonth === 1 ? 12 : currentMonth - 1;
      const lastMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear;

      // 1. 获取LiteLLM当前usage信息
      const spendInfo = await kmsClient.getOrganizationSpend(organizationId);
      const currentUsage = parseFloat(spendInfo.spend);

      logger.info('LiteLLM支出信息', {
        organization_id: organizationId,
        spend: spendInfo.spend,
        quota: spendInfo.quota,
        remaining: spendInfo.remaining
      });

      // 2. 获取上个月余额
      const lastMonthStats = await prisma.organizationMonthlyStats.findUnique({
        where: {
          c_organization_id_year_month: {
            c_organization_id: organizationId,
            year: lastMonthYear,
            month: lastMonth
          }
        }
      });

      const lastMonthBalance = lastMonthStats ? parseFloat(lastMonthStats.balance_end_month.toString()) : 0;

      // 3. 获取本月充值记录
      const thisMonthStart = new Date(currentYear, currentMonth - 1, 1);
      const thisMonthEnd = new Date(currentYear, currentMonth, 0, 23, 59, 59, 999);

      const depositRecords = await prisma.rechargeRecord.findMany({
        where: {
          c_organization_id: organizationId,
          status: 'COMPLETED',
          createdAt: {
            gte: thisMonthStart,
            lte: thisMonthEnd
          }
        }
      });

      const depositThisMonth = depositRecords.reduce((sum, record) => 
        sum + parseFloat(record.amount.toString()), 0
      );

      // 4. 获取本月usage（假设从LiteLLM获取的是总usage，需要计算本月增量）
      const lastMonthUsageStats = await prisma.organizationMonthlyStats.findUnique({
        where: {
          c_organization_id_year_month: {
            c_organization_id: organizationId,
            year: lastMonthYear,
            month: lastMonth
          }
        }
      });

      const lastMonthTotalUsage = lastMonthUsageStats ? parseFloat(lastMonthUsageStats.usage_this_month.toString()) : 0;
      const usageThisMonth = Math.max(0, currentUsage - lastMonthTotalUsage);

      // 5. 计算当前余额
      const currentBalance = lastMonthBalance + depositThisMonth - usageThisMonth;

      // 6. 更新或创建本月统计记录
      await prisma.organizationMonthlyStats.upsert({
        where: {
          c_organization_id_year_month: {
            c_organization_id: organizationId,
            year: currentYear,
            month: currentMonth
          }
        },
        update: {
          deposit_this_month: depositThisMonth,
          usage_this_month: usageThisMonth,
          balance_end_month: currentBalance
        },
        create: {
          c_organization_id: organizationId,
          year: currentYear,
          month: currentMonth,
          balance_start_month: lastMonthBalance,
          deposit_this_month: depositThisMonth,
          usage_this_month: usageThisMonth,
          balance_end_month: currentBalance
        }
      });

      // 7. 更新组织配置中的当前余额
      await prisma.organizationBalanceConfig.update({
        where: { c_organization_id: organizationId },
        data: { current_balance: currentBalance }
      });

      // 8. 记录余额变更历史
      await prisma.organizationBalanceHistory.create({
        data: {
          c_organization_id: organizationId,
          balance_before: lastMonthBalance,
          balance_after: currentBalance,
          change_amount: currentBalance - lastMonthBalance,
          change_type: 'balance_update',
          description: `Monthly balance update: last=${lastMonthBalance}, deposit=${depositThisMonth}, usage=${usageThisMonth}`
        }
      });

      logger.info('组织余额更新完成', {
        organization_id: organizationId,
        last_month_balance: lastMonthBalance,
        deposit_this_month: depositThisMonth,
        usage_this_month: usageThisMonth,
        current_balance: currentBalance
      });

      return {
        currentBalance,
        lastMonthBalance,
        depositThisMonth,
        usageThisMonth
      };

    } catch (error: any) {
      logger.error('更新组织余额失败', {
        organization_id: organizationId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * 核心职责2: 自动充值逻辑检查
   * 当 team_balance < least_balance 时触发
   */
  static async checkAndTriggerAutoRecharge(organizationId: string): Promise<{
    needsRecharge: boolean;
    currentBalance: number;
    leastBalance: number;
    chargeAmount?: number;
    reason?: string;
  }> {
    try {
      // 1. 更新当前余额
      const balanceInfo = await this.updateOrganizationBalance(organizationId);

      // 2. 获取组织配置
      const orgConfig = await prisma.organizationBalanceConfig.findUnique({
        where: { c_organization_id: organizationId }
      });

      if (!orgConfig) {
        throw new Error(`Organization ${organizationId} not found`);
      }

      const currentBalance = balanceInfo.currentBalance;
      const leastBalance = parseFloat(orgConfig.least_balance.toString());
      const addBalanceUpTo = parseFloat(orgConfig.add_balance_up_to.toString());
      const orgLimit = parseFloat(orgConfig.org_limit.toString());

      // 3. 检查是否需要充值
      if (currentBalance >= leastBalance) {
        return {
          needsRecharge: false,
          currentBalance,
          leastBalance,
          reason: 'Balance is sufficient'
        };
      }

      // 4. 检查自动充值是否启用
      if (!orgConfig.auto_recharge_enabled) {
        return {
          needsRecharge: true,
          currentBalance,
          leastBalance,
          reason: 'Auto recharge disabled'
        };
      }

      // 5. 计算扣款额度
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;

      // 获取本月已充值金额
      const monthlyStats = await prisma.organizationMonthlyStats.findUnique({
        where: {
          c_organization_id_year_month: {
            c_organization_id: organizationId,
            year: currentYear,
            month: currentMonth
          }
        }
      });

      const depositCurrentMonth = monthlyStats ? parseFloat(monthlyStats.deposit_this_month.toString()) : 0;

      // 计算手续费
      const rechargeAmount = addBalanceUpTo - currentBalance;
      const fee = StripeService.calculateFee(rechargeAmount);
      
      // 扣款额度 = min(手续费 + add_balance_up_to - 当前余额, org_limit - deposit_current_month)
      const chargeAmount = Math.min(
        fee + rechargeAmount,
        orgLimit - depositCurrentMonth
      );

      // 检查是否超出组织限额
      if (chargeAmount <= 0) {
        return {
          needsRecharge: true,
          currentBalance,
          leastBalance,
          reason: 'Monthly deposit limit exceeded'
        };
      }

      logger.info('自动充值检查完成', {
        organization_id: organizationId,
        current_balance: currentBalance,
        least_balance: leastBalance,
        add_balance_up_to: addBalanceUpTo,
        charge_amount: chargeAmount,
        deposit_current_month: depositCurrentMonth,
        org_limit: orgLimit
      });

      return {
        needsRecharge: true,
        currentBalance,
        leastBalance,
        chargeAmount
      };

    } catch (error: any) {
      logger.error('自动充值检查失败', {
        organization_id: organizationId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * 核心职责3: 执行自动充值
   */
  static async executeAutoRecharge(organizationId: string, chargeAmount: number): Promise<{
    success: boolean;
    paymentIntentId?: string;
    newBalance?: number;
    error?: string;
  }> {
    try {
      // 1. 获取组织配置
      const orgConfig = await prisma.organizationBalanceConfig.findUnique({
        where: { c_organization_id: organizationId }
      });

      if (!orgConfig || !orgConfig.stripe_customer_id || !orgConfig.default_payment_method_id) {
        throw new Error('No payment method configured');
      }

      // 2. 计算实际充值金额（扣除手续费）
      const fee = StripeService.calculateFee(chargeAmount);
      const actualRechargeAmount = chargeAmount - fee;

      // 3. 执行Stripe支付
      const paymentResult = await StripeService.processPayment({
        customerId: orgConfig.stripe_customer_id,
        amount: actualRechargeAmount,
        paymentMethodId: orgConfig.default_payment_method_id,
        metadata: {
          organization_id: organizationId,
          type: 'auto_recharge',
          actual_charge: chargeAmount.toString()
        },
        description: `Auto recharge for ${organizationId}`
      });

      if (!paymentResult.success) {
        throw new Error(`Payment failed: ${paymentResult.error}`);
      }

      // 4. 记录充值记录
      const rechargeRecord = await prisma.rechargeRecord.create({
        data: {
          c_organization_id: organizationId,
          amount: actualRechargeAmount,
          fee: fee,
          totalCharged: chargeAmount,
          balanceBefore: parseFloat(orgConfig.current_balance.toString()),
          balanceAfter: parseFloat(orgConfig.current_balance.toString()) + actualRechargeAmount,
          stripePaymentIntentId: paymentResult.paymentIntentId || 'unknown',
          stripeStatus: paymentResult.status || 'unknown',
          status: 'COMPLETED',
          isAutomatic: true,
          triggeredBy: 'auto_recharge'
        }
      });

      // 5. 更新余额
      await this.updateOrganizationBalance(organizationId);

      // 6. 更新LiteLLM team limit
      await this.updateTeamLimitInLiteLLM(organizationId);

      logger.info('自动充值执行成功', {
        organization_id: organizationId,
        charge_amount: chargeAmount,
        actual_recharge_amount: actualRechargeAmount,
        payment_intent_id: paymentResult.paymentIntentId,
        recharge_record_id: rechargeRecord.id
      });

      return {
        success: true,
        paymentIntentId: paymentResult.paymentIntentId,
        newBalance: parseFloat(orgConfig.current_balance.toString()) + actualRechargeAmount
      };

    } catch (error: any) {
      logger.error('自动充值执行失败', {
        organization_id: organizationId,
        charge_amount: chargeAmount,
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 核心职责4: 更新LiteLLM team limit
   * team_limit_indeed = min(team_limit_frontend, org_balance)
   */
  static async updateTeamLimitInLiteLLM(organizationId: string): Promise<void> {
    try {
      // 1. 获取组织信息
      const orgConfig = await prisma.organizationBalanceConfig.findUnique({
        where: { c_organization_id: organizationId }
      });

      if (!orgConfig || !orgConfig.litellm_team_id) {
        throw new Error('Organization or team ID not found');
      }

      // 2. 获取当前余额
      const currentBalance = parseFloat(orgConfig.current_balance.toString());

      // 3. 获取LiteLLM中的team信息
      const teamInfo = await kmsClient.getTeam(orgConfig.litellm_team_id);
      const teamLimitFrontend = parseFloat(teamInfo.quota || '0');

      // 4. 计算实际应设置的limit
      const teamLimitIndeed = Math.min(teamLimitFrontend, currentBalance);

      // 5. 更新LiteLLM中的team limit
      await kmsClient.updateTeamQuota(orgConfig.litellm_team_id, teamLimitIndeed);

      logger.info('LiteLLM team limit更新成功', {
        organization_id: organizationId,
        team_id: orgConfig.litellm_team_id,
        team_limit_frontend: teamLimitFrontend,
        org_balance: currentBalance,
        team_limit_indeed: teamLimitIndeed
      });

    } catch (error: any) {
      logger.error('更新LiteLLM team limit失败', {
        organization_id: organizationId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * 获取组织余额详细信息
   */
  static async getOrganizationBalanceDetails(organizationId: string): Promise<{
    currentBalance: number;
    leastBalance: number;
    addBalanceUpTo: number;
    orgLimit: number;
    monthlyStats: any;
    recentHistory: any[];
  }> {
    try {
      // 1. 更新余额
      await this.updateOrganizationBalance(organizationId);

      // 2. 获取组织配置
      const orgConfig = await prisma.organizationBalanceConfig.findUnique({
        where: { c_organization_id: organizationId }
      });

      if (!orgConfig) {
        throw new Error(`Organization ${organizationId} not found`);
      }

      // 3. 获取本月统计
      const now = new Date();
      const monthlyStats = await prisma.organizationMonthlyStats.findUnique({
        where: {
          c_organization_id_year_month: {
            c_organization_id: organizationId,
            year: now.getFullYear(),
            month: now.getMonth() + 1
          }
        }
      });

      // 4. 获取最近的余额变更历史
      const recentHistory = await prisma.organizationBalanceHistory.findMany({
        where: { c_organization_id: organizationId },
        orderBy: { created_at: 'desc' },
        take: 10
      });

      return {
        currentBalance: parseFloat(orgConfig.current_balance.toString()),
        leastBalance: parseFloat(orgConfig.least_balance.toString()),
        addBalanceUpTo: parseFloat(orgConfig.add_balance_up_to.toString()),
        orgLimit: parseFloat(orgConfig.org_limit.toString()),
        monthlyStats,
        recentHistory
      };

    } catch (error: any) {
      logger.error('获取组织余额详情失败', {
        organization_id: organizationId,
        error: error.message
      });
      throw error;
    }
  }
}

export default BalanceManager;