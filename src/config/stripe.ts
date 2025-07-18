import Stripe from 'stripe';
import { logger } from './logger';

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is required');
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
  typescript: true,
});

export class StripeService {
  static async getCustomerBalance(customerId: string): Promise<number> {
    try {
      const customer = await stripe.customers.retrieve(customerId);
      
      if (!customer || customer.deleted) {
        throw new Error('Customer not found');
      }
      
      return customer.balance || 0;
    } catch (error) {
      logger.error('Failed to get customer balance', { customerId, error });
      throw error;
    }
  }

  static async updateCustomerBalance(customerId: string, amount: number, description?: string): Promise<void> {
    try {
      await stripe.customers.createBalanceTransaction(customerId, {
        amount: Math.round(amount * 100), // Convert to cents
        currency: 'cny',
        description: description || 'Balance adjustment',
      });
      
      logger.info('Customer balance updated', { customerId, amount, description });
    } catch (error) {
      logger.error('Failed to update customer balance', { customerId, amount, error });
      throw error;
    }
  }

  static async createPaymentIntent(
    customerId: string,
    amount: number,
    paymentMethodId: string,
    description?: string
  ): Promise<Stripe.PaymentIntent> {
    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency: 'cny',
        customer: customerId,
        payment_method: paymentMethodId,
        confirmation_method: 'manual',
        confirm: true,
        description: description || 'Automatic balance recharge',
        metadata: {
          type: 'auto_recharge',
        },
      });

      logger.info('Payment intent created', { 
        paymentIntentId: paymentIntent.id,
        customerId,
        amount 
      });

      return paymentIntent;
    } catch (error) {
      logger.error('Failed to create payment intent', { customerId, amount, error });
      throw error;
    }
  }

  static async getPaymentMethod(paymentMethodId: string): Promise<Stripe.PaymentMethod> {
    try {
      return await stripe.paymentMethods.retrieve(paymentMethodId);
    } catch (error) {
      logger.error('Failed to get payment method', { paymentMethodId, error });
      throw error;
    }
  }

  static calculateFee(amount: number): number {
    const feePercentage = parseFloat(process.env.DEFAULT_RECHARGE_FEE_PERCENTAGE || '0.029');
    return Math.round(amount * feePercentage * 100) / 100;
  }

  // Payment method management
  static async getCustomerPaymentMethods(customerId: string): Promise<Stripe.PaymentMethod[]> {
    try {
      const paymentMethods = await stripe.paymentMethods.list({
        customer: customerId,
        type: 'card',
      });
      
      return paymentMethods.data;
    } catch (error) {
      logger.error('Failed to get customer payment methods', { customerId, error });
      throw error;
    }
  }

  static async attachPaymentMethodToCustomer(paymentMethodId: string, customerId: string): Promise<void> {
    try {
      await stripe.paymentMethods.attach(paymentMethodId, {
        customer: customerId,
      });
      
      logger.info('Payment method attached to customer', { paymentMethodId, customerId });
    } catch (error) {
      logger.error('Failed to attach payment method', { paymentMethodId, customerId, error });
      throw error;
    }
  }

  static async detachPaymentMethod(paymentMethodId: string): Promise<void> {
    try {
      await stripe.paymentMethods.detach(paymentMethodId);
      
      logger.info('Payment method detached', { paymentMethodId });
    } catch (error) {
      logger.error('Failed to detach payment method', { paymentMethodId, error });
      throw error;
    }
  }

  static async createCustomer(params: {
    email?: string;
    name?: string;
    metadata?: Record<string, string>;
  }): Promise<Stripe.Customer> {
    try {
      const customer = await stripe.customers.create({
        email: params.email || `org-${Date.now()}@example.com`, // 提供默认邮箱
        name: params.name || 'Organization Customer',
        metadata: params.metadata
      });
      
      logger.info('Customer created', { customerId: customer.id, email: customer.email });
      return customer;
    } catch (error) {
      logger.error('Failed to create customer', { params, error });
      throw error;
    }
  }

  static async createSetupIntent(params: {
    customer: string;
    metadata?: Record<string, string>;
  }): Promise<Stripe.SetupIntent> {
    try {
      const setupIntent = await stripe.setupIntents.create({
        customer: params.customer,
        metadata: params.metadata,
        payment_method_types: ['card'],
        usage: 'off_session',
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: 'never'
        }
      });
      
      logger.info('Setup intent created', { setupIntentId: setupIntent.id, customerId: params.customer });
      return setupIntent;
    } catch (error) {
      logger.error('Failed to create setup intent', { params, error });
      throw error;
    }
  }

  static async listPaymentMethods(customerId: string): Promise<Stripe.PaymentMethod[]> {
    try {
      const paymentMethods = await stripe.paymentMethods.list({
        customer: customerId,
        type: 'card'
      });
      
      return paymentMethods.data;
    } catch (error) {
      logger.error('Failed to list payment methods', { customerId, error });
      throw error;
    }
  }

  static async setDefaultPaymentMethod(customerId: string, paymentMethodId: string): Promise<void> {
    try {
      await stripe.customers.update(customerId, {
        invoice_settings: {
          default_payment_method: paymentMethodId,
        },
      });
      
      logger.info('Default payment method set', { customerId, paymentMethodId });
    } catch (error) {
      logger.error('Failed to set default payment method', { customerId, paymentMethodId, error });
      throw error;
    }
  }

  // Customer Portal for official Stripe payment management UI
  static async createCustomerPortalSession(customerId: string, returnUrl: string): Promise<string> {
    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });
      
      logger.info('Customer portal session created', { customerId, sessionId: session.id });
      return session.url;
    } catch (error) {
      logger.error('Failed to create customer portal session', { customerId, error });
      throw error;
    }
  }

  static async createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }> {
    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
        configuration: undefined, // 使用默认配置
      });
      
      logger.info('Portal session created', { customerId, sessionId: session.id, url: session.url });
      return { url: session.url };
    } catch (error) {
      logger.error('Failed to create portal session', { customerId, error });
      throw error;
    }
  }


  /**
   * 处理支付（支持组织级支付）
   */
  static async processPayment(params: {
    customerId: string;
    amount: number;
    paymentMethodId: string;
    metadata?: Record<string, any>;
    description?: string;
  }): Promise<{
    success: boolean;
    paymentIntentId?: string;
    status?: string;
    fee: number;
    totalAmount: number;
    error?: string;
  }> {
    try {
      const { customerId, amount, paymentMethodId, metadata, description } = params;
      
      // 计算手续费
      const fee = this.calculateFee(amount);
      const totalAmount = amount + fee;

      logger.info('开始处理支付', { 
        customerId,
        amount,
        fee,
        totalAmount,
        paymentMethodId,
        metadata
      });

      // 创建并确认支付意图
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(totalAmount * 100), // 转换为分
        currency: 'cny',
        customer: customerId,
        payment_method: paymentMethodId,
        confirm: true,
        description: description || 'Automatic organization recharge',
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: 'never'
        },
        metadata: {
          recharge_amount: amount.toString(),
          fee_amount: fee.toString(),
          total_amount: totalAmount.toString(),
          ...metadata
        },
      });

      logger.info('支付意图创建并确认', { 
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status,
        amount: totalAmount
      });

      return {
        success: paymentIntent.status === 'succeeded',
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status,
        fee,
        totalAmount,
      };

    } catch (error: any) {
      logger.error('支付处理失败', { 
        customerId: params.customerId,
        amount: params.amount,
        error: error.message
      });

      return {
        success: false,
        fee: this.calculateFee(params.amount),
        totalAmount: params.amount + this.calculateFee(params.amount),
        error: error.message
      };
    }
  }
}

export const stripeService = new StripeService();