import crypto from 'crypto';
import { logger } from '../config/logger';

/**
 * 验证webhook签名
 */
export function verifyWebhookSignature(
  payload: any, 
  signature: string, 
  secret: string = process.env.LITELLM_WEBHOOK_SECRET || 'default_webhook_secret'
): boolean {
  try {
    if (!signature || !signature.startsWith('sha256=')) {
      logger.warn('无效的签名格式', { signature });
      return false;
    }

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex');
    
    const providedSignature = signature.replace('sha256=', '');
    
    const isValid = crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(providedSignature, 'hex')
    );

    logger.info('Webhook签名验证', { 
      is_valid: isValid,
      expected_length: expectedSignature.length,
      provided_length: providedSignature.length
    });

    return isValid;
  } catch (error: any) {
    logger.error('Webhook签名验证失败', { error: error.message });
    return false;
  }
}

/**
 * 生成webhook签名（用于测试）
 */
export function generateWebhookSignature(
  payload: any, 
  secret: string = process.env.LITELLM_WEBHOOK_SECRET || 'default_webhook_secret'
): string {
  const signature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
  
  return 'sha256=' + signature;
}

/**
 * 验证webhook请求的时间戳（防止重放攻击）
 */
export function verifyWebhookTimestamp(
  timestamp: string,
  toleranceInSeconds: number = 300 // 5分钟容忍度
): boolean {
  try {
    const webhookTime = new Date(timestamp).getTime();
    const currentTime = Date.now();
    const timeDiff = Math.abs(currentTime - webhookTime) / 1000;
    
    const isValid = timeDiff <= toleranceInSeconds;
    
    logger.info('Webhook时间戳验证', {
      webhook_time: timestamp,
      current_time: new Date().toISOString(),
      time_diff_seconds: timeDiff,
      tolerance_seconds: toleranceInSeconds,
      is_valid: isValid
    });

    return isValid;
  } catch (error: any) {
    logger.error('Webhook时间戳验证失败', { error: error.message });
    return false;
  }
}