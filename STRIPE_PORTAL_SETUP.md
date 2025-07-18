# Stripe Customer Portal 配置指南

## 🎯 目的
启用Stripe Customer Portal功能，让组织可以通过官方Stripe界面管理支付方式、查看账单历史等。

## 📋 配置步骤

### 1. 访问Stripe Dashboard
- 登录到你的Stripe账户
- 访问：[https://dashboard.stripe.com/test/settings/billing/portal](https://dashboard.stripe.com/test/settings/billing/portal)

### 2. 配置Customer Portal设置

#### 基础设置
- **客户信息**：允许客户更新email地址和账单地址
- **支付方式**：允许客户添加、删除、更新支付方式
- **发票历史**：允许客户查看和下载发票

#### 推荐配置
```
✅ 允许客户更新支付方式
✅ 允许客户查看发票历史
✅ 允许客户下载发票
✅ 允许客户更新账单信息
⚠️  可选：允许客户取消订阅（根据业务需求）
```

#### 重要：认证设置
确保在Portal配置中：
- **Login方式**：建议选择"Magic link"（魔法链接）
- **Customer authentication**：确保启用无密码访问
- 这样可以避免用户需要手动登录

### 3. 保存配置
- 点击"Save"按钮保存设置
- Stripe会自动创建默认的Portal配置

### 4. 测试功能
- 返回组织管理页面
- 选择有效的组织（需要有Stripe客户ID）
- 点击"🏛️ 打开Stripe Portal"按钮
- 应该会在新窗口中打开Stripe Portal

## 🔧 故障排除

### 错误：No configuration provided
- **原因**：未在Stripe Dashboard中配置Customer Portal
- **解决**：按照上述步骤配置Portal设置

### 错误：No such customer
- **原因**：组织的Stripe客户ID无效或不存在
- **解决**：重新创建组织的Stripe客户

### Portal功能不完整
- **原因**：Portal配置中某些功能被禁用
- **解决**：返回Stripe Dashboard调整Portal设置

## 🌟 Portal功能特性

启用后，用户可以在Portal中：

1. **管理支付方式**
   - 添加新的信用卡/借记卡
   - 删除过期的支付方式
   - 设置默认支付方式

2. **查看账单历史**
   - 下载发票PDF
   - 查看付款历史
   - 查看即将到期的账单

3. **更新账单信息**
   - 修改账单地址
   - 更新联系邮箱
   - 修改公司信息

4. **订阅管理**（如启用）
   - 查看当前订阅状态
   - 取消或暂停订阅

## 📝 注意事项

- Customer Portal是Stripe官方提供的安全管理界面
- 所有操作都直接与Stripe服务器交互，确保数据安全
- Portal支持多语言和移动端访问
- 配置是全局的，影响所有使用Portal的客户

## 🔗 相关链接

- [Stripe Customer Portal文档](https://stripe.com/docs/billing/subscriptions/customer-portal)
- [Portal配置选项](https://stripe.com/docs/api/customer_portal/configurations)
- [测试环境设置](https://dashboard.stripe.com/test/settings/billing/portal)
- [生产环境设置](https://dashboard.stripe.com/settings/billing/portal)