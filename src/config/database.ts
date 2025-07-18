import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

class DatabaseManager {
  private static instance: PrismaClient;

  public static getInstance(): PrismaClient {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new PrismaClient({
        log: [
          { level: 'error', emit: 'stdout' },
          { level: 'warn', emit: 'stdout' },
        ],
      });
    }

    return DatabaseManager.instance;
  }

  public static async disconnect(): Promise<void> {
    if (DatabaseManager.instance) {
      await DatabaseManager.instance.$disconnect();
      logger.info('Database connection closed');
    }
  }

  public static async connect(): Promise<void> {
    try {
      const db = DatabaseManager.getInstance();
      await db.$connect();
      logger.info('Database connected successfully');
    } catch (error) {
      logger.error('Failed to connect to database', error);
      throw error;
    }
  }
}

export const db = DatabaseManager.getInstance();
export { DatabaseManager };