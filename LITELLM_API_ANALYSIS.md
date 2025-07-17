# LiteLLM Key Management System API 分析文档

## 🔗 服务地址
- **Base URL**: `http://172.171.97.248:3090`
- **API 文档**: `http://172.171.97.248:3090/docs`
- **OpenAPI JSON**: `http://172.171.97.248:3090/openapi.json`

## 📋 现有API接口

### 1. 组织管理 (Organizations)

#### 1.1 创建组织
```http
POST /organizations/
Content-Type: application/json

{
  "c_organization_id": "string",
  "quota": "number | string"
}
```

**响应**:
```json
{
  "id": 1,
  "c_organization_id": "string",
  "l_team_id": "string",
  "quota": "string",
  "created_at": "2025-07-17T10:00:00Z",
  "updated_at": "2025-07-17T10:00:00Z"
}
```

#### 1.2 列出所有组织
```http
GET /organizations/
```

**响应**: 组织数组

### 2. 团队管理 (Teams)

#### 2.1 创建团队
```http
POST /teams/
Content-Type: application/json

{
  "c_organization_id": "string",
  "c_team_id": "string", 
  "quota": "number | string"
}
```

**响应**:
```json
{
  "id": 1,
  "c_organization_id": "string",
  "c_team_id": "string",
  "l_team_id": "string",
  "l_user_id": "string",
  "quota": "string",
  "created_at": "2025-07-17T10:00:00Z",
  "updated_at": "2025-07-17T10:00:00Z"
}
```

#### 2.2 列出团队
```http
GET /teams/
GET /teams/?c_organization_id=string
```

**响应**: 团队数组

### 3. API密钥管理 (Keys)

#### 3.1 创建API密钥
```http
POST /keys/
Content-Type: application/json

{
  "c_organization_id": "string",
  "key_type": "ORG|TEAM_ALL|TEAM_USER|USER",
  "c_team_id": "string?",
  "c_user_id": "string?",
  "quota": "number | string"
}
```

**响应**:
```json
{
  "id": 1,
  "key_id": "string",
  "c_organization_id": "string",
  "c_team_id": "string?",
  "c_user_id": "string?",
  "key_type": "ORG|TEAM_ALL|TEAM_USER|USER",
  "quota": "string",
  "litellm_key": "string",
  "created_at": "2025-07-17T10:00:00Z",
  "updated_at": "2025-07-17T10:00:00Z"
}
```

#### 3.2 列出API密钥
```http
GET /keys/
GET /keys/?c_organization_id=string
GET /keys/?c_team_id=string
```

**响应**: 密钥数组

#### 3.3 更新API密钥
```http
PUT /keys/{key_id}
Content-Type: application/json

{
  "quota": "number | string"
}
```

**响应**: 更新后的密钥信息

### 4. 支出查询 (Spend)

#### 4.1 获取组织支出
```http
GET /spend/org/{c_organization_id}
```

**响应**:
```json
{
  "spend": "125.50",
  "quota": "1000.00", 
  "remaining": "874.50"
}
```
*注意: 如果实时数据不可用，spend返回"-1.0"*

#### 4.2 获取团队支出
```http
GET /spend/team/{c_team_id}?c_organization_id=string
```

**响应**: 同组织支出格式

#### 4.3 获取团队用户支出
```http
GET /spend/team-user/{c_team_id}/{c_user_id}?c_organization_id=string
```

**响应**: 同组织支出格式

#### 4.4 获取用户支出
```http
GET /spend/user/{c_user_id}?c_organization_id=string
```

**响应**: 同组织支出格式

---

## ❌ 缺失的关键接口

### 1. 组织管理缺失接口

#### 1.1 获取单个组织信息
```http
GET /organizations/{c_organization_id}
```
**用途**: 查询特定组织的详细信息  
**优先级**: 高

#### 1.2 更新组织配额
```http
PUT /organizations/{c_organization_id}/quota
Content-Type: application/json

{
  "new_quota": "number | string"
}
```
**用途**: 动态调整组织配额（充值后同步）  
**优先级**: 高

#### 1.3 删除组织
```http
DELETE /organizations/{c_organization_id}
```
**用途**: 清理测试数据，组织下线  
**优先级**: 中

### 2. 团队管理缺失接口

#### 2.1 获取单个团队信息
```http
GET /teams/{c_team_id}
```
**用途**: 查询特定团队的详细信息  
**优先级**: 中

#### 2.2 更新团队配额
```http
PUT /teams/{c_team_id}/quota
Content-Type: application/json

{
  "new_quota": "number | string"
}
```
**用途**: 动态调整团队配额  
**优先级**: 中

#### 2.3 删除团队
```http
DELETE /teams/{c_team_id}
```
**用途**: 清理测试数据  
**优先级**: 低

### 3. Webhook通知接口

#### 3.1 配置Webhook端点
```http
POST /webhooks/configure
Content-Type: application/json

{
  "url": "string",
  "events": ["limit_exceeded", "quota_warning"],
  "secret": "string"
}
```
**用途**: 配置Bill-Service的webhook接收地址  
**优先级**: 高

#### 3.2 测试Webhook
```http
POST /webhooks/test
Content-Type: application/json

{
  "event_type": "limit_exceeded",
  "organization_id": "string"
}
```
**用途**: 测试webhook通知是否正常  
**优先级**: 中

### 4. 健康检查接口

#### 4.1 健康检查
```http
GET /health
```
**用途**: 监控服务状态  
**优先级**: 高

---

## 🔧 集成方案

### 1. 现有接口的使用

#### 组织级自动充值流程：
1. 使用 `GET /spend/org/{c_organization_id}` 获取实时支出
2. 当支出超过配额时，Bill-Service执行充值
3. 充值成功后，需要更新组织配额（**缺失接口**）

#### 数据同步流程：
1. 使用 `POST /organizations/` 创建组织
2. 使用 `GET /organizations/` 列出所有组织
3. 需要通过 `GET /organizations/{id}` 获取单个组织信息（**缺失接口**）

### 2. 临时解决方案

#### 2.1 配额更新临时方案
```typescript
// 临时方案：删除后重新创建来更新配额
async updateOrganizationQuota(c_organization_id: string, quota: number) {
  try {
    // 1. 获取组织信息（通过列表查找）
    const orgs = await this.listOrganizations();
    const org = orgs.find(o => o.c_organization_id === c_organization_id);
    
    if (!org) {
      throw new Error('Organization not found');
    }
    
    // 2. 删除组织
    await this.deleteOrganization(c_organization_id);
    
    // 3. 重新创建组织
    return await this.createOrganization({
      c_organization_id,
      quota
    });
  } catch (error) {
    logger.error('更新组织配额失败', { organization_id: c_organization_id, error });
    throw error;
  }
}
```

#### 2.2 组织信息查询临时方案
```typescript
// 临时方案：通过列表查找单个组织
async getOrganization(c_organization_id: string) {
  const orgs = await this.listOrganizations();
  const org = orgs.find(o => o.c_organization_id === c_organization_id);
  
  if (!org) {
    throw new Error('Organization not found');
  }
  
  return org;
}
```

### 3. Webhook通知的替代方案

#### 3.1 轮询方案
```typescript
// 定期轮询组织支出状态
async function pollOrganizationSpend() {
  const organizations = await kmsClient.listOrganizations();
  
  for (const org of organizations) {
    const spend = await kmsClient.getOrganizationSpend(org.c_organization_id);
    
    if (parseFloat(spend.remaining) < 0) {
      // 触发自动充值
      await handleLimitExceeded(org.c_organization_id, spend);
    }
  }
}

// 每5分钟检查一次
setInterval(pollOrganizationSpend, 5 * 60 * 1000);
```

---

## 📊 优先级总结

### 高优先级（必须实现）
1. `GET /organizations/{c_organization_id}` - 查询单个组织
2. `PUT /organizations/{c_organization_id}/quota` - 更新组织配额
3. `GET /health` - 健康检查
4. `POST /webhooks/configure` - 配置webhook通知

### 中优先级（建议实现）
1. `GET /teams/{c_team_id}` - 查询单个团队
2. `PUT /teams/{c_team_id}/quota` - 更新团队配额
3. `POST /webhooks/test` - 测试webhook

### 低优先级（可选实现）
1. `DELETE /organizations/{c_organization_id}` - 删除组织
2. `DELETE /teams/{c_team_id}` - 删除团队

---

## 🚀 实施建议

1. **立即实施临时方案**：使用现有接口组合实现缺失功能
2. **与LiteLLM团队沟通**：请求添加高优先级接口
3. **监控和日志**：详细记录所有API调用，便于调试
4. **错误处理**：对网络错误、超时等情况有完善处理
5. **缓存策略**：对组织信息等相对静态的数据进行缓存

---

*文档最后更新时间：2025-07-17*