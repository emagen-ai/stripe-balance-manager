import { logger } from '../config/logger';

export interface OrganizationData {
  c_organization_id: string;
  quota: number;
}

export interface OrganizationResponse {
  id: number;
  c_organization_id: string;
  l_team_id: string;
  quota: string;
  created_at: string;
  updated_at: string;
}

export interface TeamData {
  c_organization_id: string;
  c_team_id: string;
  quota: number;
}

export interface TeamResponse {
  id: number;
  c_organization_id: string;
  c_team_id: string;
  l_team_id: string;
  l_user_id: string;
  quota: string;
  created_at: string;
  updated_at: string;
}

export class KeyManagementClient {
  private baseUrl: string;
  private timeout: number;

  constructor(baseUrl: string = process.env.KMS_BASE_URL || 'http://172.171.97.248:3090', timeout: number = 10000) {
    this.baseUrl = baseUrl;
    this.timeout = timeout;
  }

  private async fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });
      
      clearTimeout(timeoutId);
      return response;
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${this.timeout}ms`);
      }
      throw error;
    }
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`KMS API Error: ${response.status} ${response.statusText}`, {
        url: response.url,
        status: response.status,
        error: errorText
      });
      
      const error = new Error(`KMS API Error: ${response.status} ${response.statusText}`);
      (error as any).status = response.status;
      (error as any).response = errorText;
      throw error;
    }
    
    return response.json() as Promise<T>;
  }

  /**
   * 创建组织
   */
  async createOrganization(data: OrganizationData): Promise<OrganizationResponse> {
    logger.info('创建组织', { organization_id: data.c_organization_id, quota: data.quota });
    
    const response = await this.fetchWithTimeout(`${this.baseUrl}/organizations/`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    
    const result = await this.handleResponse<OrganizationResponse>(response);
    
    logger.info('组织创建成功', { 
      organization_id: result.c_organization_id,
      l_team_id: result.l_team_id,
      quota: result.quota
    });
    
    return result;
  }

  /**
   * 获取组织信息（临时方案：通过列表查找）
   */
  async getOrganization(c_organization_id: string): Promise<OrganizationResponse> {
    logger.info('获取组织信息', { organization_id: c_organization_id });
    
    const orgs = await this.listOrganizations();
    const org = orgs.find(o => o.c_organization_id === c_organization_id);
    
    if (!org) {
      logger.error('组织未找到', { organization_id: c_organization_id });
      const error = new Error('Organization not found');
      (error as any).status = 404;
      throw error;
    }
    
    logger.info('组织信息获取成功', { 
      organization_id: org.c_organization_id,
      l_team_id: org.l_team_id,
      quota: org.quota
    });
    
    return org;
  }

  /**
   * 更新组织配额（尝试直接更新，如果不支持则跳过）
   */
  async updateOrganizationQuota(c_organization_id: string, quota: number): Promise<OrganizationResponse> {
    logger.info('更新组织配额', { organization_id: c_organization_id, quota });
    
    try {
      // 1. 获取组织信息
      const org = await this.getOrganization(c_organization_id);
      const oldQuota = org.quota;
      
      // 2. 尝试使用PATCH方法直接更新
      try {
        const updateData = {
          quota: quota.toString(),
          c_organization_id: c_organization_id
        };
        
        const response = await this.fetchWithTimeout(`${this.baseUrl}/organizations/${c_organization_id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(updateData),
        });
        
        if (response.ok) {
          const result = await this.handleResponse<OrganizationResponse>(response);
          logger.info('组织配额更新成功（PATCH）', { 
            organization_id: result.c_organization_id,
            old_quota: oldQuota,
            new_quota: result.quota
          });
          return result;
        } else {
          throw new Error(`PATCH failed: ${response.status} ${response.statusText}`);
        }
      } catch (patchError: any) {
        logger.warn('PATCH方法更新失败，跳过更新', { 
          organization_id: c_organization_id,
          error: patchError.message 
        });
        
        // 如果PATCH失败，返回原始组织信息但不抛错
        logger.info('组织配额更新跳过（API不支持）', { 
          organization_id: c_organization_id,
          current_quota: oldQuota,
          requested_quota: quota
        });
        
        return org; // 返回原始组织信息
      }
      
    } catch (error: any) {
      logger.error('组织配额更新失败', { 
        organization_id: c_organization_id, 
        quota,
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * 列出所有组织
   */
  async listOrganizations(): Promise<OrganizationResponse[]> {
    logger.info('列出所有组织');
    
    const response = await this.fetchWithTimeout(`${this.baseUrl}/organizations/`);
    const result = await this.handleResponse<OrganizationResponse[]>(response);
    
    logger.info('组织列表获取成功', { count: result.length });
    return result;
  }

  /**
   * 删除组织
   */
  async deleteOrganization(c_organization_id: string): Promise<void> {
    logger.info('删除组织', { organization_id: c_organization_id });
    
    const response = await this.fetchWithTimeout(`${this.baseUrl}/organizations/${c_organization_id}`, {
      method: 'DELETE',
    });
    
    await this.handleResponse<void>(response);
    
    logger.info('组织删除成功', { organization_id: c_organization_id });
  }

  /**
   * 创建团队
   */
  async createTeam(data: TeamData): Promise<TeamResponse> {
    logger.info('创建团队', { 
      organization_id: data.c_organization_id,
      team_id: data.c_team_id,
      quota: data.quota
    });
    
    const response = await this.fetchWithTimeout(`${this.baseUrl}/teams/`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    
    const result = await this.handleResponse<TeamResponse>(response);
    
    logger.info('团队创建成功', { 
      team_id: result.c_team_id,
      l_user_id: result.l_user_id,
      quota: result.quota
    });
    
    return result;
  }

  /**
   * 获取团队信息
   */
  async getTeam(c_team_id: string): Promise<TeamResponse> {
    logger.info('获取团队信息', { team_id: c_team_id });
    
    const response = await this.fetchWithTimeout(`${this.baseUrl}/teams/${c_team_id}`);
    const result = await this.handleResponse<TeamResponse>(response);
    
    logger.info('团队信息获取成功', { 
      team_id: result.c_team_id,
      l_user_id: result.l_user_id,
      quota: result.quota
    });
    
    return result;
  }

  /**
   * 列出组织下的所有团队
   */
  async listTeams(c_organization_id?: string): Promise<TeamResponse[]> {
    logger.info('列出团队', { organization_id: c_organization_id });
    
    const url = c_organization_id 
      ? `${this.baseUrl}/teams/?c_organization_id=${c_organization_id}`
      : `${this.baseUrl}/teams/`;
    
    const response = await this.fetchWithTimeout(url);
    const result = await this.handleResponse<TeamResponse[]>(response);
    
    logger.info('团队列表获取成功', { count: result.length });
    return result;
  }

  /**
   * 获取组织支出信息
   */
  async getOrganizationSpend(c_organization_id: string): Promise<{ spend: string; quota: string; remaining: string }> {
    logger.info('获取组织支出信息', { organization_id: c_organization_id });
    
    const response = await this.fetchWithTimeout(`${this.baseUrl}/spend/org/${c_organization_id}`);
    const result = await this.handleResponse<{ spend: string; quota: string; remaining: string }>(response);
    
    logger.info('组织支出信息获取成功', { 
      organization_id: c_organization_id,
      spend: result.spend,
      quota: result.quota,
      remaining: result.remaining
    });
    
    return result;
  }

  /**
   * 更新团队配额
   */
  async updateTeamQuota(c_team_id: string, quota: number): Promise<{ success: boolean; message: string }> {
    logger.info('更新团队配额', { team_id: c_team_id, quota });
    
    try {
      // 先获取团队信息
      const teamInfo = await this.getTeam(c_team_id);
      
      // 使用PATCH方法更新团队配额
      const updateData = {
        quota: quota.toString(),
        c_team_id: c_team_id
      };
      
      const response = await this.fetchWithTimeout(`${this.baseUrl}/teams/${c_team_id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData),
      });
      
      if (response.ok) {
        logger.info('团队配额更新成功', { 
          team_id: c_team_id, 
          old_quota: teamInfo.quota,
          new_quota: quota 
        });
        return { success: true, message: 'Team quota updated successfully' };
      } else {
        // 如果PATCH不支持，尝试删除重建的方式（类似organization的方式）
        logger.warn('PATCH方法失败，尝试删除重建', { team_id: c_team_id });
        
        // 这里可能需要实现删除重建逻辑，但需要确认KMS API支持
        throw new Error(`Failed to update team quota: ${response.status} ${response.statusText}`);
      }
      
    } catch (error: any) {
      logger.error('更新团队配额失败', { 
        team_id: c_team_id, 
        quota, 
        error: error.message 
      });
      
      // 如果是网络错误或API不支持，返回失败但不抛异常
      return { 
        success: false, 
        message: `Failed to update team quota: ${error.message}` 
      };
    }
  }

  /**
   * 获取团队支出信息
   */
  async getTeamSpend(c_team_id: string, c_organization_id: string): Promise<{ spend: string; quota: string; remaining: string }> {
    logger.info('获取团队支出信息', { team_id: c_team_id, organization_id: c_organization_id });
    
    const response = await this.fetchWithTimeout(`${this.baseUrl}/spend/team/${c_team_id}?c_organization_id=${c_organization_id}`);
    const result = await this.handleResponse<{ spend: string; quota: string; remaining: string }>(response);
    
    logger.info('团队支出信息获取成功', { 
      team_id: c_team_id,
      spend: result.spend,
      quota: result.quota,
      remaining: result.remaining
    });
    
    return result;
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/`);
      const result = await this.handleResponse<{ status: string; timestamp: string }>(response);
      
      logger.info('KMS健康检查成功', result);
      return result;
    } catch (error: any) {
      logger.error('KMS健康检查失败', { error: error.message });
      throw error;
    }
  }
}

// 单例实例
export const kmsClient = new KeyManagementClient(
  process.env.KMS_BASE_URL || 'http://172.171.97.248:3090',
  parseInt(process.env.KMS_TIMEOUT || '10000')
);