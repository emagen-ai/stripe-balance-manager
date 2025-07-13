import { Decimal } from '@prisma/client/runtime/library';

export interface BalanceConfigInput {
  minimumBalance: number;
  targetBalance: number;
  autoRechargeEnabled: boolean;
  defaultPaymentMethodId?: string;
  maxDailyRecharges?: number;
  maxRechargeAmount?: number;
}

export interface RechargeCalculation {
  rechargeAmount: number;
  fee: number;
  totalCharge: number;
  newBalance: number;
}

export interface BalanceCheckResult {
  needsRecharge: boolean;
  currentBalance: number;
  minimumBalance: number;
  targetBalance: number;
  calculation?: RechargeCalculation;
}

export interface RechargeRequest {
  userId: string;
  amount: number;
  paymentMethodId: string;
  balanceBefore: number;
  isAutomatic: boolean;
}

export interface AutoRechargeResult {
  success: boolean;
  rechargeRecordId?: string;
  error?: string;
  amount?: number;
  fee?: number;
}

export enum RechargeStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING', 
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED'
}

export interface StripeCustomerBalance {
  balance: number;
  currency: string;
}