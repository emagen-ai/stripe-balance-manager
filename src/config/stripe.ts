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
}