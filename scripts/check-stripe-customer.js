const Stripe = require('stripe');
require('dotenv').config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function checkStripeCustomer() {
  const customerId = 'cus_Si2mJ88SftKEse';
  
  try {
    console.log(`\n=== Checking Stripe Customer: ${customerId} ===\n`);
    
    // 1. Get customer details
    const customer = await stripe.customers.retrieve(customerId);
    console.log('Customer Details:');
    console.log('- ID:', customer.id);
    console.log('- Email:', customer.email);
    console.log('- Name:', customer.name);
    console.log('- Created:', new Date(customer.created * 1000).toISOString());
    console.log('- Default Source:', customer.default_source);
    console.log('- Invoice Settings Default PM:', customer.invoice_settings?.default_payment_method);
    
    // 2. List payment methods
    console.log('\n=== Payment Methods ===');
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customerId,
      limit: 100
    });
    
    console.log('Total Payment Methods:', paymentMethods.data.length);
    
    if (paymentMethods.data.length > 0) {
      paymentMethods.data.forEach(pm => {
        console.log(`\n- Payment Method: ${pm.id}`);
        console.log('  Type:', pm.type);
        console.log('  Created:', new Date(pm.created * 1000).toISOString());
        
        if (pm.type === 'card') {
          console.log('  Card Brand:', pm.card.brand);
          console.log('  Last 4:', pm.card.last4);
          console.log('  Exp:', `${pm.card.exp_month}/${pm.card.exp_year}`);
        }
      });
    } else {
      console.log('No payment methods found for this customer.');
    }
    
    // 3. Check for setup intents
    console.log('\n=== Recent Setup Intents ===');
    const setupIntents = await stripe.setupIntents.list({
      customer: customerId,
      limit: 10
    });
    
    console.log('Total Setup Intents:', setupIntents.data.length);
    
    setupIntents.data.forEach(si => {
      console.log(`\n- Setup Intent: ${si.id}`);
      console.log('  Status:', si.status);
      console.log('  Created:', new Date(si.created * 1000).toISOString());
      console.log('  Payment Method:', si.payment_method);
      console.log('  Usage:', si.usage);
      if (si.payment_method_types) {
        console.log('  Payment Method Types:', si.payment_method_types.join(', '));
      }
    });
    
    // 4. Check for payment intents
    console.log('\n=== Recent Payment Intents ===');
    const paymentIntents = await stripe.paymentIntents.list({
      customer: customerId,
      limit: 5
    });
    
    console.log('Total Payment Intents:', paymentIntents.data.length);
    
    paymentIntents.data.forEach(pi => {
      console.log(`\n- Payment Intent: ${pi.id}`);
      console.log('  Status:', pi.status);
      console.log('  Amount:', `$${(pi.amount / 100).toFixed(2)}`);
      console.log('  Created:', new Date(pi.created * 1000).toISOString());
      console.log('  Payment Method:', pi.payment_method);
    });
    
  } catch (error) {
    console.error('Error checking Stripe customer:', error.message);
    if (error.type === 'StripeInvalidRequestError') {
      console.error('Details:', error.raw);
    }
  }
}

checkStripeCustomer();