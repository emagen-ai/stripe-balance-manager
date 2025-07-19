# WorkOS Webhook 集成文档

## 概述

本文档描述了如何将 WorkOS 组织 webhook 与 Stripe Balance Manager 系统集成，以实现组织的自动同步和余额管理配置。

## Webhook 端点信息

### 端点 URL
```
https://balance-api-production-eafc.up.railway.app/webhooks/workos/wos_sync_endpoint_secure_2024
```

### 安全特性
- 使用混淆路径 `/wos_sync_endpoint_secure_2024` 提高安全性
- HMAC SHA256 签名验证
- 请求体原始数据保护

### 支持的事件类型
- `organization.created` - 组织创建事件
- `organization.updated` - 组织更新事件  
- `organization.deleted` - 组织删除事件

## 配置要求

### 1. WorkOS 端配置
在 WorkOS Dashboard 中配置 webhook：
1. 导航到 Webhooks 设置
2. 添加新的 webhook 端点
3. 设置端点 URL（见上方）
4. 选择需要的事件类型
5. 配置签名密钥

### 2. 服务端配置
确保以下环境变量已设置：
```bash
WORKOS_WEBHOOK_SECRET=Y8QkpVN9O5b9CKQdgpnIDKenf
```

## 技术实现要点

### 关键中间件顺序
⚠️ **重要**: Webhook 路由必须在 `express.json()` 中间件之前注册：

```javascript
// ✅ 正确顺序
app.use(requestLogger);
app.use('/webhooks', workosWebhookRoutes); // webhook 路由在前
app.use(express.json()); // JSON 解析在后
app.use('/api/balance', balanceRoutes);

// ❌ 错误顺序（会导致签名验证失败）
app.use(express.json()); // 这会破坏原始请求体
app.use('/webhooks', workosWebhookRoutes);
```

### 签名验证实现
WorkOS 使用特殊的签名格式：`t=timestamp, v1=signature`

```javascript
// 解析 WorkOS 签名格式
const signatureParts = signature.split(', ');
let timestamp = '';
let receivedSignature = '';

for (const part of signatureParts) {
  const [key, value] = part.split('=');
  if (key === 't') timestamp = value;
  else if (key === 'v1') receivedSignature = value;
}

// 构建签名字符串
const signaturePayload = timestamp + '.' + payload;

// 验证签名
const expectedSignature = crypto
  .createHmac('sha256', secret)
  .update(signaturePayload, 'utf8')
  .digest('hex');
```

## 组织操作行为

### 1. 组织创建 (`organization.created`)
当接收到组织创建事件时，系统会：

✅ **自动创建 Stripe Customer**:
```javascript
{
  name: orgData.name || `Organization ${workos_org_id}`,
  email: `org-${workos_org_id}@workos-auto.generated`,
  metadata: {
    workos_organization_id: workos_org_id,
    source: 'workos_webhook',
    created_by: 'auto_sync'
  }
}
```

✅ **自动创建余额配置**（包含 Stripe Customer ID 映射）:
```javascript
{
  c_organization_id: workos_org_id,
  stripe_customer_id: stripeCustomer.id,  // 🔗 映射关系
  minimum_balance: 100,        // 默认最低余额 $100
  target_balance: 1000,        // 默认充值目标 $1000  
  auto_recharge_enabled: true, // 默认启用自动充值
  current_balance: 0,          // 初始余额为 $0
  least_balance: 100,          // 最低余额阈值
  add_balance_up_to: 1000,     // 充值到此金额
  org_limit: 10000,           // 默认组织限额 $10,000
  max_daily_recharges: 5,     // 默认每日最大充值次数
  minimum_recharge_amount: 100 // 默认最小充值金额 $100
}
```

✅ **重复创建保护**: 如果组织已存在，跳过创建并记录日志
✅ **错误处理**: 如果 Stripe Customer 创建失败，整个操作回滚

### 2. 组织更新 (`organization.updated`)
当接收到组织更新事件时，系统会：

✅ **检查组织存在性**: 如果组织不存在，自动创建
✅ **记录更新事件**: 当前只记录日志，不修改余额配置
⚠️ **可扩展性**: 预留了更新组织信息的接口

### 3. 组织删除 (`organization.deleted`)
当接收到组织删除事件时，系统会：

✅ **安全删除策略**: 默认不删除 Stripe Customer 和余额数据，只记录删除事件
✅ **审计日志**: 记录删除前的余额状态和 Stripe Customer ID
⚠️ **数据保留**: 保留支付历史和审计记录
⚠️ **可配置删除**: 代码中预留了真实删除的选项（当前注释掉）

```javascript
// 可选：完全删除组织和 Stripe Customer（当前已注释，出于安全考虑）
// if (existingOrg.stripe_customer_id) {
//   await stripe.customers.del(existingOrg.stripe_customer_id);
// }
// await prisma.organizationBalanceConfig.delete({
//   where: { c_organization_id: workos_org_id }
// });
```

**删除策略说明**:
- 🔒 **默认保留**: 保留所有数据用于审计和历史记录
- 💳 **Stripe 保留**: 保留 Stripe Customer 及其支付历史
- 📊 **余额保留**: 保留余额历史和配置记录

## 监控和日志

### 请求追踪
每个 webhook 请求都有唯一的 `requestId` 用于追踪：

```javascript
const requestId = Math.random().toString(36).substring(2, 15);
```

### 关键日志事件
- 🔔 Webhook 请求接收
- 🔐 签名验证过程
- 🔍 请求体调试信息
- 🏢 组织事件处理
- ✅ 成功处理确认
- ❌ 错误和失败信息

### 日志示例
```
info: 🔔 WorkOS Webhook Request Received {"requestId":"abc123","contentLength":"331","hasSignature":true}
info: 🔐 Verifying webhook signature {"requestId":"abc123","signaturePrefix":"t=1752937645336, v1=..."}
info: ✅ Webhook signature verified successfully {"requestId":"abc123"}
info: 🏢 Processing organization.created event {"requestId":"abc123","orgId":"org_01ABC123"}
info: ✅ Organization balance config created successfully {"workos_org_id":"org_01ABC123","database_id":42}
```

## 健康检查

### 端点
```
GET https://balance-api-production-eafc.up.railway.app/webhooks/workos/health
```

### 响应
```json
{
  "status": "healthy",
  "service": "workos-webhook", 
  "timestamp": "2025-07-19T15:01:09.602Z"
}
```

## 测试端点

### 模拟创建组织事件
```
POST https://balance-api-production-eafc.up.railway.app/webhooks/workos/test
```

这将创建一个测试组织来验证系统功能。

## 故障排除

### 常见问题

1. **签名验证失败**
   - 检查环境变量 `WORKOS_WEBHOOK_SECRET`
   - 确认 webhook 路由在 `express.json()` 之前
   - 验证 WorkOS 签名格式解析

2. **请求体解析错误**  
   - 确保使用 `express.raw({ type: 'application/json' })`
   - 检查中间件注册顺序

3. **组织重复创建**
   - 系统有保护机制，会跳过重复创建
   - 检查日志中的 "Organization already exists" 信息

### 调试步骤
1. 检查 Railway 部署日志
2. 搜索特定的 `requestId`  
3. 查看签名验证详细信息
4. 确认数据库操作结果

## 安全注意事项

1. **签名验证**: 始终验证 WorkOS 签名
2. **密钥保护**: 妥善保管 webhook 密钥
3. **端点混淆**: 使用非标准路径增加安全性
4. **HTTPS**: 确保使用 HTTPS 传输
5. **日志脱敏**: 避免在日志中暴露敏感信息

## API 集成示例

### 根据 WorkOS 组织 ID 获取 Stripe Customer ID
```javascript
// 辅助函数已集成到 webhook 处理中
const stripeCustomerId = await getStripeCustomerIdByOrgId('org_01ABC123');
```

### 使用映射关系进行支付
```javascript
// 1. 根据 WorkOS 组织 ID 获取 Stripe Customer ID
const orgId = 'org_01ABC123';
const stripeCustomerId = await getStripeCustomerIdByOrgId(orgId);

// 2. 使用 Stripe Customer ID 进行支付操作
if (stripeCustomerId) {
  const paymentResult = await StripeService.processPayment({
    customerId: stripeCustomerId,
    amount: 1000,
    paymentMethodId: 'pm_1234567890',
    metadata: { workos_org_id: orgId }
  });
}
```

## 总结

WorkOS Webhook 集成成功实现了：
- ✅ 自动组织同步
- ✅ **自动 Stripe Customer 创建**
- ✅ **WorkOS 组织 ID ↔ Stripe Customer ID 映射存储**
- ✅ 默认余额配置创建  
- ✅ 安全的签名验证
- ✅ 完整的错误处理和日志记录
- ✅ 重复创建保护
- ✅ 审计友好的删除策略
- ✅ 可扩展的事件处理架构

### 核心价值
1. **无缝集成**: WorkOS 组织创建时自动创建对应的 Stripe Customer
2. **ID 映射**: 自动维护 WorkOS 组织 ID 与 Stripe Customer ID 的映射关系
3. **即用型**: 新组织立即可用于支付和余额管理，无需手动配置
4. **数据一致性**: 确保每个 WorkOS 组织都有对应的支付能力

系统现在可以自动响应 WorkOS 组织变更，确保每个新组织都有对应的 Stripe Customer 和余额管理配置，实现了完全自动化的组织-支付集成。