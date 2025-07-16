# Stripe Balance Manager

一个基于 Stripe API 的自动余额管理系统，支持用户设置余额阈值并自动充值到目标金额。

## 📋 项目概述

这个系统允许用户：
- 设置最小余额阈值和目标余额
- 当余额低于阈值时自动触发充值
- 用户承担交易手续费（2.9%）
- 通过官方 Stripe 界面安全管理支付方式

## ✨ 核心功能

### 🏦 余额管理
- **实时余额监控** - 每5分钟检查一次用户余额
- **自动充值触发** - 余额低于最小阈值时自动执行
- **手续费计算** - 自动计算并包含 Stripe 交易费用
- **历史记录** - 完整的充值记录和交易日志

### 💳 支付方式管理
- **Stripe Customer Portal** - 完整的官方支付管理界面
- **Payment Element** - 嵌入式支付方式设置组件
- **安全存储** - 支付信息安全存储在 Stripe 服务器
- **多种支付方式** - 支持信用卡、借记卡等多种支付方式

### 🔄 自动化系统
- **定时任务** - 基于 node-cron 的定时检查机制
- **智能充值** - 精确计算充值金额避免过度充值
- **错误处理** - 完善的错误捕获和重试机制
- **日志记录** - 详细的操作日志和调试信息

## 🏗️ 技术架构

### 后端技术栈
- **Node.js + TypeScript** - 现代化的服务器端开发
- **Express.js** - 轻量级 Web 框架
- **Prisma ORM** - 类型安全的数据库访问
- **PostgreSQL** - 可靠的关系型数据库
- **Stripe API** - 专业的支付处理服务

### 前端技术栈
- **Vanilla JavaScript** - 原生 JavaScript 实现
- **Stripe Elements** - 官方支付组件库
- **现代化 CSS** - 响应式暗色主题设计
- **渐进式 Web 应用** - 支持移动端访问

### 部署环境
- **Railway Platform** - 现代化云部署平台
- **Docker 容器化** - 一致的运行环境
- **环境变量管理** - 安全的配置管理
- **自动 HTTPS** - SSL 证书自动配置

## 📊 数据库设计

### 用户表 (User)
```prisma
model User {
  id               String          @id @default(cuid())
  email            String          @unique
  stripeCustomerId String?         @unique
  createdAt        DateTime        @default(now())
  updatedAt        DateTime        @updatedAt
  balanceConfig    BalanceConfig?
  rechargeRecords  RechargeRecord[]
}
```

### 余额配置表 (BalanceConfig)
```prisma
model BalanceConfig {
  id                     String   @id @default(cuid())
  userId                 String   @unique
  minimumBalance         Decimal  @db.Decimal(10, 2)
  targetBalance          Decimal  @db.Decimal(10, 2)
  autoRechargeEnabled    Boolean  @default(true)
  defaultPaymentMethodId String?
  maxDailyRecharges      Int      @default(5)
  maxRechargeAmount      Decimal  @default(10000) @db.Decimal(10, 2)
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt
  user                   User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

### 充值记录表 (RechargeRecord)
```prisma
model RechargeRecord {
  id              String   @id @default(cuid())
  userId          String
  amount          Decimal  @db.Decimal(10, 2)
  fee             Decimal  @db.Decimal(10, 2)
  totalCharge     Decimal  @db.Decimal(10, 2)
  paymentIntentId String
  status          String
  triggeredBy     String   @default("auto")
  createdAt       DateTime @default(now())
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

## 🚀 部署说明

### 环境变量配置
```bash
# 数据库连接
DATABASE_URL="postgresql://username:password@host:port/database"

# Stripe API 密钥
STRIPE_SECRET_KEY="sk_test_..."

# 服务器配置
PORT=3000
NODE_ENV=production

# 费用配置
DEFAULT_RECHARGE_FEE_PERCENTAGE=0.029
```

### Railway 部署步骤

1. **创建项目**
   ```bash
   # 连接 GitHub 仓库
   railway login
   railway link
   ```

2. **配置数据库**
   ```bash
   # 添加 PostgreSQL 服务
   railway add postgresql
   ```

3. **设置环境变量**
   ```bash
   railway variables set STRIPE_SECRET_KEY=sk_test_...
   ```

4. **部署应用**
   ```bash
   railway up
   ```

### Docker 本地运行
```bash
# 构建镜像
docker build -t stripe-balance-manager .

# 运行容器
docker run -p 3000:3000 \
  -e DATABASE_URL="..." \
  -e STRIPE_SECRET_KEY="..." \
  stripe-balance-manager
```

## 📚 API 文档

### 余额管理 API

#### 获取余额状态
```http
GET /api/balance/status/:userId
Headers: x-user-id: {userId}

Response:
{
  "needsRecharge": true,
  "currentBalance": -50,
  "minimumBalance": 150,
  "targetBalance": 600,
  "calculation": {
    "rechargeAmount": 650,
    "fee": 18.85,
    "totalCharge": 668.85,
    "newBalance": 600
  },
  "canRecharge": true
}
```

#### 获取余额配置
```http
GET /api/balance/config/:userId
Headers: x-user-id: {userId}

Response:
{
  "id": "...",
  "userId": "...",
  "minimumBalance": 150,
  "targetBalance": 600,
  "autoRechargeEnabled": true,
  "defaultPaymentMethodId": "pm_...",
  "maxDailyRecharges": 5,
  "maxRechargeAmount": 10000
}
```

#### 更新余额配置
```http
PUT /api/balance/config/:userId
Headers: x-user-id: {userId}
Content-Type: application/json

Body:
{
  "minimumBalance": 200,
  "targetBalance": 800,
  "autoRechargeEnabled": true,
  "maxDailyRecharges": 3
}
```

#### 手动触发充值
```http
POST /api/balance/recharge/:userId
Headers: x-user-id: {userId}

Response:
{
  "success": true,
  "amount": 650,
  "fee": 18.85,
  "totalCharge": 668.85,
  "paymentIntentId": "pi_...",
  "newBalance": 600
}
```

#### 获取充值历史
```http
GET /api/balance/history/:userId?page=1&limit=20
Headers: x-user-id: {userId}

Response:
{
  "records": [
    {
      "id": "...",
      "amount": 650,
      "fee": 18.85,
      "totalCharge": 668.85,
      "status": "succeeded",
      "triggeredBy": "auto",
      "createdAt": "2025-07-16T12:00:00Z"
    }
  ],
  "pagination": {
    "total": 10,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

### 支付管理 API

#### 获取支付方式列表
```http
GET /api/payment/methods/:userId
Headers: x-user-id: {userId}

Response:
{
  "methods": [
    {
      "id": "pm_...",
      "brand": "visa",
      "last4": "4242",
      "expMonth": 12,
      "expYear": 2025,
      "isDefault": true
    }
  ],
  "customerId": "cus_..."
}
```

#### 创建 Setup Intent
```http
POST /api/payment/setup-intent/:userId
Headers: x-user-id: {userId}

Response:
{
  "success": true,
  "clientSecret": "seti_..._secret_...",
  "setupIntentId": "seti_..."
}
```

#### 创建 Customer Portal 会话
```http
POST /api/payment/portal/:userId
Headers: x-user-id: {userId}
Content-Type: application/json

Body:
{
  "returnUrl": "https://example.com/return"
}

Response:
{
  "success": true,
  "portalUrl": "https://billing.stripe.com/session/..."
}
```

## 🎨 用户界面

### 支付方式设置页面
- **URL**: `/stripe-payment.html?userId={userId}`
- **功能**: 选择 Customer Portal 或 Payment Element
- **特点**: 暗色主题，响应式设计，广告拦截器检测

### 测试调试页面
- **URL**: `/stripe-elements-test.html`
- **功能**: 详细的 Stripe Elements 调试信息
- **特点**: 实时状态显示，错误诊断，步骤跟踪

### 成功页面
- **URL**: `/payment-success.html?userId={userId}`
- **功能**: 支付设置成功确认和余额状态显示
- **特点**: 手动充值测试，支付方式管理链接

## 🔧 本地开发

### 安装依赖
```bash
npm install
```

### 数据库设置
```bash
# 生成 Prisma 客户端
npx prisma generate

# 运行数据库迁移
npx prisma migrate dev

# 查看数据库
npx prisma studio
```

### 开发模式运行
```bash
npm run dev
```

### 构建生产版本
```bash
npm run build
npm start
```

## 🧪 测试

### 测试用户信息
- **用户ID**: `cmd19la3k0000d3bvxl8nch31`
- **Stripe客户ID**: `cus_SfeEld6hguFBKn`
- **当前余额**: -50（低于阈值，触发自动充值）

### 测试卡号
- **成功**: `4242424242424242`
- **拒绝**: `4000000000000002`
- **Mastercard**: `5555555555554444`
- **过期时间**: 任意未来日期
- **CVC**: 任意3位数字

### API 测试
```bash
# 健康检查
curl https://balance-api-production-eafc.up.railway.app/health

# 余额状态检查
curl -H "x-user-id: cmd19la3k0000d3bvxl8nch31" \
  https://balance-api-production-eafc.up.railway.app/api/balance/status/cmd19la3k0000d3bvxl8nch31

# 创建 Setup Intent
curl -X POST \
  -H "Content-Type: application/json" \
  -H "x-user-id: cmd19la3k0000d3bvxl8nch31" \
  https://balance-api-production-eafc.up.railway.app/api/payment/setup-intent/cmd19la3k0000d3bvxl8nch31
```

## 🛡️ 安全考虑

### 数据安全
- **敏感信息加密** - 所有支付信息存储在 Stripe 服务器
- **API 密钥管理** - 使用环境变量安全存储
- **请求验证** - 用户身份验证中间件
- **HTTPS 强制** - 所有通信使用 SSL 加密

### 错误处理
- **广告拦截器检测** - 自动检测并提供解决方案
- **网络错误处理** - 重试机制和优雅降级
- **支付失败处理** - 详细错误信息和用户指导
- **日志记录** - 完整的错误日志和调试信息

## 📈 监控和日志

### 应用监控
- **健康检查端点** - `/health`
- **服务状态** - 数据库连接、调度器状态
- **实时日志** - 结构化日志输出

### 业务指标
- **充值成功率** - 自动充值成功/失败统计
- **用户余额分布** - 余额状态分析
- **支付方式使用** - 支付方式偏好统计

## 🔮 未来规划

### 功能扩展
- [ ] 多币种支持
- [ ] 更多支付方式（银行转账、数字钱包）
- [ ] 余额预警通知系统
- [ ] 充值计划和预算管理
- [ ] 详细的财务报表

### 技术优化
- [ ] GraphQL API 支持
- [ ] Redis 缓存层
- [ ] 微服务架构重构
- [ ] 性能监控和 APM
- [ ] 自动化测试覆盖

## 📞 支持和联系

### 问题报告
- **GitHub Issues**: [项目 Issues 页面]
- **邮件支持**: [支持邮箱]

### 开发团队
- **主要开发**: Claude AI Assistant
- **技术栈**: Node.js, TypeScript, Stripe API, Railway

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

---

**⚡ Powered by Stripe API & Railway Platform**

> 这是一个使用现代技术栈构建的完整支付管理系统，专注于用户体验和系统可靠性。