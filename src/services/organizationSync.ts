import { PrismaClient } from '@prisma/client';
import { kmsClient, KeyManagementClient } from './keyManagementClient';
import { logger } from '../config/logger';

export class OrganizationSyncService {
  constructor(
    private prisma: PrismaClient,
    private kmsClient: KeyManagementClient
  ) {}

  /**
   * 同步组织到KMS
   */
  async syncOrganizationToKMS(c_organization_id: string): Promise<void> {
    logger.info('开始同步组织到KMS', { organization_id: c_organization_id });
    
    try {
      // 1. 从数据库获取组织配置
      const orgConfig = await this.prisma.organizationBalanceConfig.findUnique({
        where: { c_organization_id },
        include: {
          rechargeRecords: {
            where: { status: 'COMPLETED' },
            orderBy: { createdAt: 'desc' }
          }
        }
      });

      if (!orgConfig) {
        throw new Error(`Organization ${c_organization_id} not found in database`);
      }

      // 2. 计算当前可用配额
      const currentBalance = await this.calculateCurrentBalance(c_organization_id);
      const quota = Math.max(100, Number(currentBalance)); // KMS要求配额必须大于0，最少100

      logger.info('计算出的配额', { 
        organization_id: c_organization_id,
        current_balance: currentBalance,
        quota
      });

      // 3. 检查KMS中是否存在该组织
      let kmsOrg;
      try {
        kmsOrg = await this.kmsClient.getOrganization(c_organization_id);
        logger.info('KMS中已存在组织', { 
          organization_id: c_organization_id,
          l_team_id: kmsOrg.l_team_id,
          current_quota: kmsOrg.quota
        });
      } catch (error: any) {
        if (error.status === 404) {
          // 组织不存在，需要创建
          logger.info('KMS中不存在组织，需要创建', { organization_id: c_organization_id });
          
          try {
            kmsOrg = await this.kmsClient.createOrganization({
              c_organization_id,
              quota
            });
            
            logger.info('KMS组织创建成功', { 
              organization_id: c_organization_id,
              l_team_id: kmsOrg.l_team_id,
              quota: kmsOrg.quota
            });
          } catch (createError: any) {
            if (createError.status === 500) {
              logger.warn('KMS创建组织失败，可能已存在', { 
                organization_id: c_organization_id,
                error: createError.message
              });
              // 重试获取组织
              kmsOrg = await this.kmsClient.getOrganization(c_organization_id);
            } else {
              throw createError;
            }
          }
        } else {
          throw error;
        }
      }

      // 4. 更新数据库中的litellm_team_id
      if (kmsOrg.l_team_id && orgConfig.litellm_team_id !== kmsOrg.l_team_id) {
        await this.prisma.organizationBalanceConfig.update({
          where: { c_organization_id },
          data: { litellm_team_id: kmsOrg.l_team_id }
        });
        
        logger.info('更新数据库中的litellm_team_id', { 
          organization_id: c_organization_id,
          l_team_id: kmsOrg.l_team_id
        });
      }

      // 5. 由于KMS不支持配额更新，我们只记录差异
      const currentQuota = parseFloat(kmsOrg.quota);
      if (Math.abs(currentQuota - quota) > 0.01) {
        logger.warn('KMS配额与计算配额不一致', {
          organization_id: c_organization_id,
          kms_quota: currentQuota,
          calculated_quota: quota,
          difference: quota - currentQuota
        });
      }

      logger.info('组织同步完成', { 
        organization_id: c_organization_id,
        l_team_id: kmsOrg.l_team_id,
        quota: kmsOrg.quota
      });

    } catch (error: any) {
      logger.error('组织同步失败', { 
        organization_id: c_organization_id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * 计算当前可用余额
   */
  private async calculateCurrentBalance(c_organization_id: string): Promise<number> {
    try {
      // 1. 获取成功的充值记录
      const rechargeRecords = await this.prisma.rechargeRecord.findMany({
        where: { 
          c_organization_id,
          status: 'COMPLETED'
        },
        orderBy: { createdAt: 'desc' }
      });

      const totalRecharged = rechargeRecords.reduce((sum, record) => 
        sum + Number(record.amount), 0);

      logger.info('充值记录汇总', {
        organization_id: c_organization_id,
        recharge_count: rechargeRecords.length,
        total_recharged: totalRecharged
      });

      // 2. 尝试从KMS获取实时支出
      try {
        const spend = await this.kmsClient.getOrganizationSpend(c_organization_id);
        const currentSpend = parseFloat(spend.spend);
        
        if (currentSpend >= 0) {
          // 有实时支出数据
          const balance = totalRecharged - currentSpend;
          logger.info('使用实时支出计算余额', {
            organization_id: c_organization_id,
            total_recharged: totalRecharged,
            current_spend: currentSpend,
            balance
          });
          return balance;
        }
      } catch (error: any) {
        logger.warn('获取实时支出失败，使用充值总额', {
          organization_id: c_organization_id,
          error: error.message
        });
      }

      // 3. 如果没有实时数据，返回充值总额
      return totalRecharged;
    } catch (error: any) {
      logger.error('计算余额失败', {
        organization_id: c_organization_id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * 同步所有组织
   */
  async syncAllOrganizations(): Promise<void> {
    logger.info('开始同步所有组织');
    
    try {
      const organizations = await this.prisma.organizationBalanceConfig.findMany();
      
      logger.info('找到组织数量', { count: organizations.length });
      
      for (const org of organizations) {
        try {
          await this.syncOrganizationToKMS(org.c_organization_id);
        } catch (error: any) {
          logger.error('单个组织同步失败，继续下一个', {
            organization_id: org.c_organization_id,
            error: error.message
          });
        }
      }
      
      logger.info('所有组织同步完成');
    } catch (error: any) {
      logger.error('同步所有组织失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 创建组织配置并同步到KMS
   */
  async createOrganizationConfig(data: {
    c_organization_id: string;
    stripe_customer_id?: string;
    minimum_balance?: number;
    target_balance?: number;
    auto_recharge_enabled?: boolean;
    default_payment_method_id?: string;
    minimum_recharge_amount?: number;
  }): Promise<void> {
    logger.info('创建组织配置', { organization_id: data.c_organization_id });
    
    try {
      // 1. 创建数据库记录
      const orgConfig = await this.prisma.organizationBalanceConfig.create({
        data: {
          c_organization_id: data.c_organization_id,
          stripe_customer_id: data.stripe_customer_id,
          minimum_balance: data.minimum_balance || 100,
          target_balance: data.target_balance || 1000,
          auto_recharge_enabled: data.auto_recharge_enabled ?? true,
          default_payment_method_id: data.default_payment_method_id,
          minimum_recharge_amount: data.minimum_recharge_amount || 100
        }
      });

      logger.info('数据库组织配置创建成功', { 
        organization_id: orgConfig.c_organization_id
      });

      // 2. 同步到KMS
      await this.syncOrganizationToKMS(data.c_organization_id);

      logger.info('组织配置创建并同步完成', { 
        organization_id: data.c_organization_id
      });
    } catch (error: any) {
      logger.error('创建组织配置失败', { 
        organization_id: data.c_organization_id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * 获取组织的完整信息（包括KMS数据）
   */
  async getOrganizationInfo(c_organization_id: string): Promise<{
    config: any;
    kms: any;
    spend: any;
    balance: number;
  }> {
    logger.info('获取组织完整信息', { organization_id: c_organization_id });
    
    try {
      // 1. 获取数据库配置
      const config = await this.prisma.organizationBalanceConfig.findUnique({
        where: { c_organization_id },
        include: {
          rechargeRecords: {
            where: { status: 'COMPLETED' },
            orderBy: { createdAt: 'desc' },
            take: 10
          }
        }
      });

      if (!config) {
        throw new Error(`Organization ${c_organization_id} not found`);
      }

      // 2. 获取KMS数据
      const kms = await this.kmsClient.getOrganization(c_organization_id);

      // 3. 获取支出数据
      const spend = await this.kmsClient.getOrganizationSpend(c_organization_id);

      // 4. 计算余额
      const balance = await this.calculateCurrentBalance(c_organization_id);

      return {
        config,
        kms,
        spend,
        balance
      };
    } catch (error: any) {
      logger.error('获取组织信息失败', { 
        organization_id: c_organization_id,
        error: error.message
      });
      throw error;
    }
  }
}

// 单例实例
export const organizationSyncService = new OrganizationSyncService(
  new PrismaClient(),
  kmsClient
);