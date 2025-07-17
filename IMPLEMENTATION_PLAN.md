# LiteLLM Key Management System + Stripe Balance Management 集成实施计划

## 🎯 项目概述

本项目旨在将现有的Stripe自动余额管理系统与LiteLLM Key Management System进行集成，实现基于事件驱动的自动充值机制。当LiteLLM检测到组织使用量超过限制时，会通过webhook通知Bill-Service进行自动充值。

### 系统架构

```
LiteLLM Service (localhost:8089)
        ↓ webhook (limit_exceeded)
Bill-Service (Railway)
        ↓ auto recharge
Stripe API
        ↓ quota update
Key Management System
        ↓ sync limit
LiteLLM Service
```

### 核心概念映射

```
Bill-Service层级    →    LiteLLM层级
Organization       →    Team (l_team_id)
Team              →    User (l_user_id) 
User              →    Key
```

## 📋 实施步骤

---

## 第一阶段：数据层扩展

### 步骤 1.1：扩展数据库模型

**任务**：为现有系统添加组织级配置支持

**实施内容**：
```sql
-- 扩展现有用户表，支持组织关联
ALTER TABLE users ADD COLUMN c_organization_id VARCHAR;
ALTER TABLE users ADD COLUMN litellm_team_id VARCHAR;

-- 创建组织级余额配置表
CREATE TABLE organization_balance_config (
    id SERIAL PRIMARY KEY,
    c_organization_id VARCHAR UNIQUE NOT NULL,
    stripe_customer_id VARCHAR UNIQUE,
    litellm_team_id VARCHAR UNIQUE,
    minimum_balance DECIMAL(10,2) DEFAULT 100.00,
    target_balance DECIMAL(10,2) DEFAULT 1000.00,
    auto_recharge_enabled BOOLEAN DEFAULT true,
    default_payment_method_id VARCHAR,
    max_daily_recharges INT DEFAULT 5,
    minimum_recharge_amount DECIMAL(10,2) DEFAULT 100.00,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 扩展充值记录表，支持组织级记录
ALTER TABLE recharge_records ADD COLUMN c_organization_id VARCHAR;
ALTER TABLE recharge_records ADD COLUMN triggered_by_webhook BOOLEAN DEFAULT false;
ALTER TABLE recharge_records ADD COLUMN webhook_event_id VARCHAR;
```

**测试方式**：
```bash
# 1. 运行数据库迁移
npx prisma migrate dev --name add-organization-support

# 2. 验证表结构
npx prisma studio

# 3. 测试数据插入
curl -X POST http://localhost:3000/test/db-insert \
  -H "Content-Type: application/json" \
  -d '{
    "c_organization_id": "test_org_001",
    "minimum_balance": 200,
    "target_balance": 1000
  }'

# 4. 验证数据查询
curl http://localhost:3000/test/db-query/test_org_001
```

**完成标准**：
- [ ] 数据库迁移成功执行
- [ ] Prisma Studio显示新表结构
- [ ] 测试数据能正常插入和查询
- [ ] 无数据库连接错误

---

### 步骤 1.2：更新Prisma模型

**任务**：更新ORM模型以支持新的数据结构

**实施内容**：
```typescript
// prisma/schema.prisma 更新
model User {
  id                    String          @id @default(cuid())
  email                 String          @unique
  stripeCustomerId      String?         @unique
  c_organization_id     String?         // 新增
  litellm_team_id       String?         // 新增
  createdAt             DateTime        @default(now())
  updatedAt             DateTime        @updatedAt
  balanceConfig         BalanceConfig?
  rechargeRecords       RechargeRecord[]
  organization          OrganizationBalanceConfig? @relation(fields: [c_organization_id], references: [c_organization_id])
}

// 新增模型
model OrganizationBalanceConfig {
  id                      String   @id @default(cuid())
  c_organization_id       String   @unique
  stripe_customer_id      String?  @unique
  litellm_team_id         String?  @unique
  minimum_balance         Decimal  @default(100) @db.Decimal(10, 2)
  target_balance          Decimal  @default(1000) @db.Decimal(10, 2)
  auto_recharge_enabled   Boolean  @default(true)
  default_payment_method_id String?
  max_daily_recharges     Int      @default(5)
  minimum_recharge_amount Decimal  @default(100) @db.Decimal(10, 2)
  created_at              DateTime @default(now())
  updated_at              DateTime @updatedAt
  users                   User[]
  rechargeRecords         RechargeRecord[]
}

model RechargeRecord {
  id                    String   @id @default(cuid())
  userId                String?  // 改为可选
  c_organization_id     String?  // 新增
  amount                Decimal  @db.Decimal(10, 2)
  fee                   Decimal  @db.Decimal(10, 2)
  totalCharge           Decimal  @db.Decimal(10, 2)
  paymentIntentId       String
  status                String
  triggeredBy           String   @default("manual")
  triggered_by_webhook  Boolean  @default(false)  // 新增
  webhook_event_id      String?  // 新增
  createdAt             DateTime @default(now())
  user                  User?    @relation(fields: [userId], references: [id], onDelete: Cascade)
  organization          OrganizationBalanceConfig? @relation(fields: [c_organization_id], references: [c_organization_id])
}
```

**测试方式**：
```bash
# 1. 生成新的Prisma客户端
npx prisma generate

# 2. 验证TypeScript类型
npm run build

# 3. 测试新模型的CRUD操作
curl -X POST http://localhost:3000/test/organization-config \
  -H "Content-Type: application/json" \
  -d '{
    "c_organization_id": "test_org_002",
    "stripe_customer_id": "cus_test123",
    "litellm_team_id": "team_test123"
  }'

# 4. 验证关联查询
curl http://localhost:3000/test/organization-with-users/test_org_002
```

**完成标准**：
- [ ] Prisma客户端生成成功
- [ ] TypeScript编译无错误
- [ ] 新模型CRUD操作正常
- [ ] 关联查询返回正确数据

---

## 第二阶段：Key Management System集成

### 步骤 2.1：创建KMS API客户端

**任务**：实现与localhost:8089的API通信

**实施内容**：
```typescript
// src/services/keyManagementClient.ts
export class KeyManagementClient {
  private baseUrl = 'http://localhost:8089';
  
  async createOrganization(data: {
    c_organization_id: string;
    quota: number;
  }) {
    const response = await fetch(`${this.baseUrl}/organizations/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return response.json();
  }

  async updateOrganizationQuota(c_organization_id: string, quota: number) {
    const response = await fetch(`${this.baseUrl}/organizations/${c_organization_id}/quota`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_quota: quota })
    });
    return response.json();
  }

  async getOrganization(c_organization_id: string) {
    const response = await fetch(`${this.baseUrl}/organizations/${c_organization_id}`);
    return response.json();
  }
}
```

**测试方式**：
```bash
# 1. 确保KMS服务运行
curl http://localhost:8089/health

# 2. 测试创建组织
curl -X POST http://localhost:3000/test/kms/create-org \
  -H "Content-Type: application/json" \
  -d '{
    "c_organization_id": "test_kms_001",
    "quota": 500
  }'

# 3. 测试获取组织信息
curl http://localhost:3000/test/kms/get-org/test_kms_001

# 4. 测试更新配额
curl -X PUT http://localhost:3000/test/kms/update-quota \
  -H "Content-Type: application/json" \
  -d '{
    "c_organization_id": "test_kms_001",
    "quota": 1000
  }'

# 5. 验证错误处理
curl http://localhost:3000/test/kms/get-org/nonexistent_org
```

**完成标准**：
- [ ] KMS服务连接成功
- [ ] 组织CRUD操作正常
- [ ] 配额更新同步成功
- [ ] 错误情况处理正确
- [ ] 网络超时和重试机制有效

---

### 步骤 2.2：实现组织数据同步

**任务**：确保Bill-Service和KMS的组织数据一致性

**实施内容**：
```typescript
// src/services/organizationSync.ts
export class OrganizationSyncService {
  constructor(
    private kmsClient: KeyManagementClient,
    private prisma: PrismaClient
  ) {}

  async syncOrganizationToKMS(c_organization_id: string) {
    // 1. 从数据库获取组织配置
    const orgConfig = await this.prisma.organizationBalanceConfig.findUnique({
      where: { c_organization_id }
    });

    if (!orgConfig) {
      throw new Error(`Organization ${c_organization_id} not found`);
    }

    // 2. 计算当前可用配额
    const currentBalance = await this.calculateCurrentBalance(c_organization_id);
    const quota = Math.max(0, Number(currentBalance));

    // 3. 同步到KMS
    try {
      await this.kmsClient.getOrganization(c_organization_id);
      await this.kmsClient.updateOrganizationQuota(c_organization_id, quota);
    } catch (error) {
      if (error.status === 404) {
        const result = await this.kmsClient.createOrganization({
          c_organization_id,
          quota
        });
        
        // 4. 更新litellm_team_id
        await this.prisma.organizationBalanceConfig.update({
          where: { c_organization_id },
          data: { litellm_team_id: result.l_team_id }
        });
      } else {
        throw error;
      }
    }
  }

  private async calculateCurrentBalance(c_organization_id: string): Promise<number> {
    const rechargeRecords = await this.prisma.rechargeRecord.findMany({
      where: { 
        c_organization_id,
        status: 'succeeded'
      }
    });

    const totalRecharged = rechargeRecords.reduce((sum, record) => 
      sum + Number(record.amount), 0);
    
    return totalRecharged;
  }
}
```

**测试方式**：
```bash
# 1. 创建测试组织配置
curl -X POST http://localhost:3000/api/organizations \
  -H "Content-Type: application/json" \
  -d '{
    "c_organization_id": "sync_test_001",
    "minimum_balance": 100,
    "target_balance": 500
  }'

# 2. 触发同步
curl -X POST http://localhost:3000/api/organizations/sync_test_001/sync

# 3. 验证KMS中的组织
curl http://localhost:8089/organizations/sync_test_001

# 4. 验证数据库中的litellm_team_id
curl http://localhost:3000/api/organizations/sync_test_001/config

# 5. 测试配额更新同步
curl -X POST http://localhost:3000/api/organizations/sync_test_001/recharge \
  -H "Content-Type: application/json" \
  -d '{"amount": 200}'

# 6. 验证KMS配额已更新
curl http://localhost:8089/organizations/sync_test_001
```

**完成标准**：
- [ ] 组织配置同步到KMS成功
- [ ] litellm_team_id正确保存
- [ ] 配额计算准确
- [ ] 同步错误情况处理正确
- [ ] 重复同步不会造成数据不一致

---

## 第三阶段：Webhook机制实现

### 步骤 3.1：创建Webhook接收端点

**任务**：实现接收LiteLLM超限通知的webhook

**实施内容**：
```typescript
// src/routes/webhooks.ts
export const webhookRoutes = express.Router();

interface LiteLLMWebhookPayload {
  event_type: 'limit_exceeded';
  team_id: string;
  current_usage: number;
  current_limit: number;
  exceeded_by: number;
  timestamp: string;
  organization_id?: string;
}

webhookRoutes.post('/litellm/limit-exceeded', async (req, res) => {
  try {
    // 1. 验证webhook签名
    const signature = req.headers['x-webhook-signature'] as string;
    if (!verifyWebhookSignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const payload: LiteLLMWebhookPayload = req.body;
    
    // 2. 查找对应的组织配置
    const orgConfig = await prisma.organizationBalanceConfig.findUnique({
      where: { litellm_team_id: payload.team_id }
    });

    if (!orgConfig) {
      return res.status(404).json({ 
        error: 'Organization not found for team_id',
        team_id: payload.team_id 
      });
    }

    // 3. 检查是否启用自动充值
    if (!orgConfig.auto_recharge_enabled) {
      return res.status(200).json({ 
        message: 'Auto recharge disabled',
        action: 'none'
      });
    }

    // 4. 触发自动充值
    const rechargeResult = await handleAutoRecharge(orgConfig, payload);
    
    // 5. 记录webhook事件
    await recordWebhookEvent(payload, rechargeResult);

    res.status(200).json({
      success: true,
      action: 'auto_recharged',
      ...rechargeResult
    });

  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

**测试方式**：
```bash
# 1. 设置测试数据
curl -X POST http://localhost:3000/test/setup-webhook-test \
  -H "Content-Type: application/json" \
  -d '{
    "c_organization_id": "webhook_test_001",
    "litellm_team_id": "team_webhook_001",
    "stripe_customer_id": "cus_test_webhook",
    "auto_recharge_enabled": true,
    "minimum_recharge_amount": 100,
    "target_balance": 500
  }'

# 2. 模拟LiteLLM webhook调用
curl -X POST http://localhost:3000/webhooks/litellm/limit-exceeded \
  -H "Content-Type: application/json" \
  -H "x-webhook-signature: test_signature" \
  -d '{
    "event_type": "limit_exceeded",
    "team_id": "team_webhook_001",
    "current_usage": 520,
    "current_limit": 500,
    "exceeded_by": 20,
    "timestamp": "2025-07-17T10:00:00Z"
  }'

# 3. 验证响应格式
# 应返回: {"success": true, "action": "auto_recharged", "recharged_amount": 100, ...}

# 4. 验证数据库记录
curl http://localhost:3000/api/organizations/webhook_test_001/recharge-history

# 5. 验证KMS配额更新
curl http://localhost:8089/organizations/webhook_test_001

# 6. 测试无效签名
curl -X POST http://localhost:3000/webhooks/litellm/limit-exceeded \
  -H "Content-Type: application/json" \
  -H "x-webhook-signature: invalid_signature" \
  -d '{"event_type": "limit_exceeded"}'
```

**完成标准**：
- [ ] Webhook端点正确接收POST请求
- [ ] 签名验证机制有效
- [ ] 组织查找逻辑正确
- [ ] 自动充值触发成功
- [ ] KMS配额同步成功
- [ ] 充值记录正确保存
- [ ] 错误情况处理完整

---

### 步骤 3.2：实现Webhook签名验证

**任务**：确保webhook请求的安全性和真实性

**实施内容**：
```typescript
// src/utils/webhookSecurity.ts
import crypto from 'crypto';

export function verifyWebhookSignature(
  payload: any, 
  signature: string, 
  secret: string = process.env.LITELLM_WEBHOOK_SECRET || 'test_secret'
): boolean {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
  
  const providedSignature = signature.replace('sha256=', '');
  
  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature, 'hex'),
    Buffer.from(providedSignature, 'hex')
  );
}
```

**测试方式**：
```bash
# 1. 测试正确签名
PAYLOAD='{"event_type":"test","data":"test"}'
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "test_secret" | cut -d' ' -f2)

curl -X POST http://localhost:3000/test/webhook/verify \
  -H "Content-Type: application/json" \
  -H "x-webhook-signature: sha256=$SIGNATURE" \
  -d "$PAYLOAD"

# 2. 测试错误签名
curl -X POST http://localhost:3000/test/webhook/verify \
  -H "Content-Type: application/json" \
  -H "x-webhook-signature: sha256=invalid_signature" \
  -d "$PAYLOAD"
```

**完成标准**：
- [ ] 正确签名验证通过
- [ ] 错误签名被拒绝
- [ ] 时序攻击防护有效
- [ ] 环境变量配置正确

---

## 第四阶段：完整流程集成测试

### 步骤 4.1：端到端测试场景

**任务**：测试完整的自动充值流程

**测试脚本**：
```bash
#!/bin/bash
# e2e-test.sh - 端到端测试脚本

echo "=== 端到端测试开始 ==="

# 步骤1: 创建测试组织
ORG_ID="e2e_test_$(date +%s)"
curl -X POST http://localhost:3000/api/organizations \
  -H "Content-Type: application/json" \
  -d "{
    \"c_organization_id\": \"$ORG_ID\",
    \"minimum_balance\": 100,
    \"target_balance\": 500,
    \"auto_recharge_enabled\": true,
    \"minimum_recharge_amount\": 200
  }"

# 步骤2: 设置Stripe支付方式
curl -X POST http://localhost:3000/api/organizations/$ORG_ID/payment-method \
  -H "Content-Type: application/json" \
  -d '{
    "payment_method_id": "pm_card_visa",
    "set_as_default": true
  }'

# 步骤3: 同步到KMS
curl -X POST http://localhost:3000/api/organizations/$ORG_ID/sync

# 步骤4: 验证KMS中的组织
KMS_ORG=$(curl -s http://localhost:8089/organizations/$ORG_ID)
TEAM_ID=$(echo $KMS_ORG | jq -r '.l_team_id')

# 步骤5: 模拟超限webhook
WEBHOOK_PAYLOAD="{
  \"event_type\": \"limit_exceeded\",
  \"team_id\": \"$TEAM_ID\",
  \"current_usage\": 520,
  \"current_limit\": 500,
  \"exceeded_by\": 20,
  \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
}"

SIGNATURE=$(echo -n "$WEBHOOK_PAYLOAD" | openssl dgst -sha256 -hmac "test_secret" | cut -d' ' -f2)

curl -X POST http://localhost:3000/webhooks/litellm/limit-exceeded \
  -H "Content-Type: application/json" \
  -H "x-webhook-signature: sha256=$SIGNATURE" \
  -d "$WEBHOOK_PAYLOAD"

# 步骤6: 验证充值记录
sleep 2
curl http://localhost:3000/api/organizations/$ORG_ID/recharge-history

# 步骤7: 验证KMS配额更新
curl http://localhost:8089/organizations/$ORG_ID

echo "=== 端到端测试完成 ==="
```

**完成标准**：
- [ ] 组织创建和配置成功
- [ ] 支付方式设置成功
- [ ] KMS同步成功，获得team_id
- [ ] 第一次webhook触发自动充值
- [ ] 充值记录正确保存
- [ ] KMS配额正确更新
- [ ] 数据一致性检查通过

---

### 步骤 4.2：错误场景测试

**任务**：测试各种异常情况的处理

**测试内容**：
- 支付失败场景
- KMS服务不可用
- 无效的team_id
- 达到日充值次数限制
- 数据库连接失败

**完成标准**：
- [ ] 支付失败时不更新配额
- [ ] KMS不可用时有重试机制
- [ ] 无效team_id返回正确错误
- [ ] 日充值限制生效
- [ ] 数据库错误有降级处理
- [ ] 所有错误都有日志记录

---

## 第五阶段：管理界面扩展

### 步骤 5.1：组织级管理页面

**任务**：为组织管理员提供管理界面

**功能包括**：
- 当前余额显示
- 本月使用量统计
- KMS配额状态
- 自动充值开关
- 手动充值功能
- 充值历史记录
- Webhook事件日志

**完成标准**：
- [ ] 页面加载无错误
- [ ] 所有指标数据正确显示
- [ ] 手动充值功能正常
- [ ] KMS同步按钮有效
- [ ] 数据自动刷新正常
- [ ] 响应式设计适配移动端

---

## 第六阶段：生产就绪

### 步骤 6.1：错误处理和回滚策略

**任务**：确保系统的可靠性和可恢复性

**实施内容**：
- 事务管理器实现
- 自动回滚机制
- 支付失败处理
- 数据一致性保证

**完成标准**：
- [ ] 支付失败时无数据变更
- [ ] 数据库失败时支付自动退款
- [ ] KMS失败时数据完全回滚
- [ ] 回滚操作失败有日志记录

---

### 步骤 6.2：监控和告警系统

**任务**：实现完整的系统监控

**功能包括**：
- 性能指标收集
- 健康检查端点
- Prometheus指标格式
- 告警机制
- 错误日志记录

**完成标准**：
- [ ] 健康检查返回正确状态
- [ ] 指标端点格式正确
- [ ] 告警在错误时正确触发
- [ ] 性能监控准确反映系统状态

---

### 步骤 6.3：最终部署验证

**任务**：在生产环境中验证系统完整性

**验证内容**：
- 环境变量配置
- 数据库连接
- 外部服务连接
- 端到端流程测试
- 监控系统验证

**完成标准**：
- [ ] 所有环境变量配置正确
- [ ] 数据库迁移成功执行
- [ ] 外部服务连接正常
- [ ] 测试组织创建和同步成功
- [ ] 系统性能指标正常

---

## 📊 依赖关系图

```
步骤1.1 (数据库扩展) 
    ↓
步骤1.2 (Prisma模型更新)
    ↓
步骤2.1 (KMS客户端) → 步骤2.2 (组织同步)
    ↓                      ↓
步骤3.1 (Webhook端点) → 步骤3.2 (签名验证)
    ↓
步骤4.1 (端到端测试) → 步骤4.2 (错误场景测试)
    ↓
步骤5.1 (管理界面)
    ↓
步骤6.1 (错误处理) → 步骤6.2 (监控系统) → 步骤6.3 (部署验证)
```

## 🔧 技术栈

- **后端**: Node.js + TypeScript + Express
- **数据库**: PostgreSQL + Prisma ORM
- **支付**: Stripe API
- **部署**: Railway Platform
- **监控**: Prometheus + 自定义健康检查
- **安全**: HMAC签名验证 + 环境变量管理

## 🎯 关键验证点

1. **数据一致性** - 每个步骤都要验证数据在所有系统中的一致性
2. **错误处理** - 每个功能都要测试正常和异常情况
3. **性能要求** - webhook响应时间 < 5秒，成功率 > 95%
4. **安全性** - 所有API都要验证签名和权限
5. **可观测性** - 所有关键操作都要有日志和指标

## 🔄 回滚计划

- 每个步骤都有独立的回滚脚本
- 数据库迁移有对应的rollback迁移
- KMS配置变更有restore接口
- 支付操作有自动退款机制

---

*本文档将在实施过程中持续更新，确保每个步骤的完整性和可验证性。*