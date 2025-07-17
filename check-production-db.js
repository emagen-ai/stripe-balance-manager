#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');

async function checkProductionDB() {
  console.log('🔍 检查生产数据库状态');
  
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: 'postgresql://postgres:railway_balance_secure_2024@postgres-db.railway.internal:5432/balance_manager'
      }
    }
  });

  try {
    // 检查表是否存在
    console.log('\n📋 检查数据库表:');
    
    try {
      const userCount = await prisma.user.count();
      console.log(`✅ User表存在 (${userCount} 记录)`);
    } catch (e) {
      console.log('❌ User表不存在');
    }

    try {
      const rechargeCount = await prisma.rechargeRecord.count();
      console.log(`✅ RechargeRecord表存在 (${rechargeCount} 记录)`);
    } catch (e) {
      console.log('❌ RechargeRecord表不存在');
    }

    try {
      const orgConfigCount = await prisma.organizationBalanceConfig.count();
      console.log(`✅ OrganizationBalanceConfig表存在 (${orgConfigCount} 记录)`);
    } catch (e) {
      console.log('❌ OrganizationBalanceConfig表不存在 - 需要运行迁移!');
    }

    try {
      const webhookEventCount = await prisma.webhookEvent.count();
      console.log(`✅ WebhookEvent表存在 (${webhookEventCount} 记录)`);
    } catch (e) {
      console.log('❌ WebhookEvent表不存在 - 需要运行迁移!');
    }

  } catch (error) {
    console.error('❌ 数据库连接失败:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkProductionDB().catch(console.error);