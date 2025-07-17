import express from 'express';
import { kmsClient } from '../services/keyManagementClient';
import { logger } from '../config/logger';

const router = express.Router();

/**
 * 代理KMS API请求，解决浏览器Mixed Content问题
 */

// 获取组织列表
router.get('/organizations', async (req, res) => {
  try {
    const organizations = await kmsClient.listOrganizations();
    res.json(organizations);
  } catch (error: any) {
    logger.error('KMS代理：获取组织列表失败', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch organizations from KMS' });
  }
});

// 获取单个组织
router.get('/organizations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const organization = await kmsClient.getOrganization(id);
    res.json(organization);
  } catch (error: any) {
    logger.error('KMS代理：获取组织失败', { error: error.message, organizationId: req.params.id });
    res.status(500).json({ error: 'Failed to fetch organization from KMS' });
  }
});

// 健康检查
router.get('/health', async (req, res) => {
  try {
    // 通过尝试获取组织列表来检查KMS健康状态
    const organizations = await kmsClient.listOrganizations();
    res.json({ healthy: true, organizations_count: organizations.length });
  } catch (error: any) {
    logger.error('KMS代理：健康检查失败', { error: error.message });
    res.status(500).json({ healthy: false, error: error.message });
  }
});

export default router;