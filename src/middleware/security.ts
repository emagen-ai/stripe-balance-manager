import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';

export interface AuthenticatedRequest extends Request {
  userId?: string;
}

export const authenticateUser = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const userId = req.headers['x-user-id'] as string;
  
  if (!userId) {
    return res.status(401).json({ error: 'User ID required in headers' });
  }

  req.userId = userId;
  next();
};

export const validateUserAccess = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const requestedUserId = req.params.userId;
  const authenticatedUserId = req.userId;

  if (requestedUserId !== authenticatedUserId) {
    logger.warn('Unauthorized access attempt', {
      authenticatedUserId,
      requestedUserId,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });
    
    return res.status(403).json({ error: 'Access denied' });
  }

  next();
};

export const rateLimitRecharge = (() => {
  const userRequests = new Map<string, { count: number; resetTime: number }>();
  const WINDOW_MS = 60 * 1000; // 1 minute
  const MAX_REQUESTS = 5; // Max 5 recharge requests per minute per user

  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const userId = req.userId!;
    const now = Date.now();
    
    const userRecord = userRequests.get(userId);
    
    if (!userRecord || now > userRecord.resetTime) {
      userRequests.set(userId, {
        count: 1,
        resetTime: now + WINDOW_MS
      });
      return next();
    }
    
    if (userRecord.count >= MAX_REQUESTS) {
      logger.warn('Rate limit exceeded for recharge', {
        userId,
        count: userRecord.count,
        ip: req.ip
      });
      
      return res.status(429).json({ 
        error: 'Too many recharge requests. Please try again later.',
        retryAfter: Math.ceil((userRecord.resetTime - now) / 1000)
      });
    }
    
    userRecord.count++;
    next();
  };
})();

export const validateRechargeAmount = (req: Request, res: Response, next: NextFunction) => {
  const { amount } = req.body;
  
  if (amount !== undefined) {
    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ error: 'Invalid recharge amount' });
    }
    
    if (amount > 100000) {
      return res.status(400).json({ error: 'Recharge amount too large' });
    }
    
    if (amount < 1) {
      return res.status(400).json({ error: 'Minimum recharge amount is 1 CNY' });
    }
  }
  
  next();
};

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    
    logger.info('Request completed', {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });
  });
  
  next();
};