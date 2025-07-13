import express from 'express';
import { StripeService } from '../config/stripe';
import { db } from '../config/database';
import { logger } from '../config/logger';

const router = express.Router();

// Get user's payment methods
router.get('/methods/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Get user with Stripe customer ID
    const user = await db.user.findUnique({
      where: { id: userId }
    });
    if (!user || !user.stripeCustomerId) {
      return res.status(404).json({ error: 'User not found or no Stripe customer' });
    }

    // Get payment methods from Stripe
    const methods = await StripeService.getCustomerPaymentMethods(user.stripeCustomerId);
    
    // Get user's balance config to check default payment method
    const config = await db.balanceConfig.findUnique({
      where: { userId }
    });
    const defaultPaymentMethodId = config?.defaultPaymentMethodId;

    // Format payment methods for frontend
    const formattedMethods = methods.map((method: any) => ({
      id: method.id,
      brand: method.card?.brand || 'card',
      last4: method.card?.last4 || '****',
      expMonth: method.card?.exp_month || 0,
      expYear: method.card?.exp_year || 0,
      isDefault: method.id === defaultPaymentMethodId
    }));

    res.json({
      methods: formattedMethods,
      customerId: user.stripeCustomerId
    });

  } catch (error: any) {
    logger.error('Failed to get payment methods', { error: error.message, userId: req.params.userId });
    res.status(500).json({ error: 'Failed to retrieve payment methods' });
  }
});

// Add new payment method
router.post('/methods/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { paymentMethodId, setAsDefault = false } = req.body;

    if (!paymentMethodId) {
      return res.status(400).json({ error: 'Payment method ID is required' });
    }

    // Get user with Stripe customer ID
    const user = await db.user.findUnique({
      where: { id: userId }
    });
    if (!user || !user.stripeCustomerId) {
      return res.status(404).json({ error: 'User not found or no Stripe customer' });
    }

    // Attach payment method to customer
    await StripeService.attachPaymentMethodToCustomer(paymentMethodId, user.stripeCustomerId);

    // Set as default if requested
    if (setAsDefault) {
      await db.balanceConfig.upsert({
        where: { userId },
        update: { defaultPaymentMethodId: paymentMethodId },
        create: {
          userId,
          minimumBalance: 100,
          targetBalance: 500,
          defaultPaymentMethodId: paymentMethodId
        }
      });
      
      // Set as default in Stripe as well
      await StripeService.setDefaultPaymentMethod(user.stripeCustomerId, paymentMethodId);
    }

    logger.info('Payment method added successfully', { 
      userId, 
      paymentMethodId, 
      customerId: user.stripeCustomerId,
      setAsDefault 
    });

    res.json({
      success: true,
      paymentMethodId,
      isDefault: setAsDefault
    });

  } catch (error: any) {
    logger.error('Failed to add payment method', { 
      error: error.message, 
      userId: req.params.userId,
      paymentMethodId: req.body.paymentMethodId 
    });
    res.status(500).json({ error: 'Failed to add payment method' });
  }
});

// Delete payment method
router.delete('/methods/:userId/:paymentMethodId', async (req, res) => {
  try {
    const { userId, paymentMethodId } = req.params;

    // Get user
    const user = await db.user.findUnique({
      where: { id: userId }
    });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if this is the default payment method
    const config = await db.balanceConfig.findUnique({
      where: { userId }
    });
    if (config?.defaultPaymentMethodId === paymentMethodId) {
      // Remove from config
      await db.balanceConfig.update({
        where: { userId },
        data: { defaultPaymentMethodId: null }
      });
    }

    // Detach from Stripe
    await StripeService.detachPaymentMethod(paymentMethodId);

    logger.info('Payment method deleted successfully', { 
      userId, 
      paymentMethodId 
    });

    res.json({ success: true });

  } catch (error: any) {
    logger.error('Failed to delete payment method', { 
      error: error.message, 
      userId: req.params.userId,
      paymentMethodId: req.params.paymentMethodId 
    });
    res.status(500).json({ error: 'Failed to delete payment method' });
  }
});

// Create Customer Portal session (Official Stripe UI)
router.post('/portal/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { returnUrl } = req.body;

    // Get user with Stripe customer ID
    const user = await db.user.findUnique({
      where: { id: userId }
    });
    if (!user || !user.stripeCustomerId) {
      return res.status(404).json({ error: 'User not found or no Stripe customer' });
    }

    // Create customer portal session
    const portalUrl = await StripeService.createCustomerPortalSession(
      user.stripeCustomerId,
      returnUrl || `${req.protocol}://${req.get('host')}/payment-success`
    );

    logger.info('Customer portal session created', { 
      userId, 
      customerId: user.stripeCustomerId 
    });

    res.json({
      success: true,
      portalUrl
    });

  } catch (error: any) {
    logger.error('Failed to create customer portal session', { 
      error: error.message, 
      userId: req.params.userId 
    });
    res.status(500).json({ error: 'Failed to create customer portal session' });
  }
});

// Create Setup Intent for Payment Element
router.post('/setup-intent/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    // Get user with Stripe customer ID
    const user = await db.user.findUnique({
      where: { id: userId }
    });
    if (!user || !user.stripeCustomerId) {
      return res.status(404).json({ error: 'User not found or no Stripe customer' });
    }

    // Create setup intent
    const setupIntent = await StripeService.createSetupIntent(user.stripeCustomerId);

    logger.info('Setup intent created', { 
      userId, 
      customerId: user.stripeCustomerId,
      setupIntentId: setupIntent.id 
    });

    res.json({
      success: true,
      clientSecret: setupIntent.client_secret,
      setupIntentId: setupIntent.id
    });

  } catch (error: any) {
    logger.error('Failed to create setup intent', { 
      error: error.message, 
      userId: req.params.userId 
    });
    res.status(500).json({ error: 'Failed to create setup intent' });
  }
});

// Set default payment method
router.post('/methods/:userId/:paymentMethodId/default', async (req, res) => {
  try {
    const { userId, paymentMethodId } = req.params;

    // Get user
    const user = await db.user.findUnique({
      where: { id: userId }
    });
    if (!user || !user.stripeCustomerId) {
      return res.status(404).json({ error: 'User not found or no Stripe customer' });
    }

    // Update database
    await db.balanceConfig.upsert({
      where: { userId },
      update: { defaultPaymentMethodId: paymentMethodId },
      create: {
        userId,
        minimumBalance: 100,
        targetBalance: 500,
        defaultPaymentMethodId: paymentMethodId
      }
    });

    // Update Stripe
    await StripeService.setDefaultPaymentMethod(user.stripeCustomerId, paymentMethodId);

    logger.info('Default payment method updated', { 
      userId, 
      paymentMethodId 
    });

    res.json({ success: true });

  } catch (error: any) {
    logger.error('Failed to set default payment method', { 
      error: error.message, 
      userId: req.params.userId,
      paymentMethodId: req.params.paymentMethodId 
    });
    res.status(500).json({ error: 'Failed to set default payment method' });
  }
});

export default router;