'use strict';

/**
 * UniBee Gateway Configuration Script
 * 
 * This script helps you configure payment gateways in UniBee.
 * 
 * Usage:
 *   node src/helper/migration/unibee-gateway-setup.js list        - List available gateways
 *   node src/helper/migration/unibee-gateway-setup.js setup       - Setup Stripe gateway
 *   node src/helper/migration/unibee-gateway-setup.js status      - Check current gateway status
 * 
 * Before running setup, make sure you have these in your .env:
 *   STRIPE_PUBLISHABLE_KEY=pk_test_xxx or pk_live_xxx
 *   STRIPE_SECRET_KEY=sk_test_xxx or sk_live_xxx
 */

require('dotenv').config();
const axios = require('axios');

const UNIBEE_API_URL = process.env.UNIBEE_API_URL || 'https://api.unibee.dev';
const UNIBEE_API_KEY = process.env.UNIBEE_API_KEY;

const api = axios.create({
    baseURL: UNIBEE_API_URL,
    headers: {
        'Authorization': `Bearer ${UNIBEE_API_KEY}`,
        'Content-Type': 'application/json'
    }
});

const log = {
    info: (msg) => console.log(`[INFO] ${msg}`),
    success: (msg) => console.log(`[SUCCESS] ✅ ${msg}`),
    error: (msg) => console.error(`[ERROR] ❌ ${msg}`),
    warn: (msg) => console.warn(`[WARN] ⚠️ ${msg}`),
};

/**
 * List all available gateways and their setup status
 */
async function listGateways() {
    console.log('\n========== Available Payment Gateways ==========\n');
    
    try {
        const res = await api.get('/merchant/gateway/setup_list');
        const gateways = res.data.data?.gateways || [];
        
        console.log('Supported Gateways:');
        console.log('─'.repeat(60));
        
        gateways.forEach(g => {
            const status = g.IsSetupFinished ? '✅ Configured' : '⭕ Not configured';
            console.log(`\n${g.name} (${g.gatewayName})`);
            console.log(`  Status: ${status}`);
            console.log(`  Type: ${g.gatewayType}`);
            console.log(`  Auto-charge: ${g.autoChargeEnabled ? 'Yes' : 'No'}`);
            if (g.gatewayId) console.log(`  Gateway ID: ${g.gatewayId}`);
            console.log(`  Keys needed: ${g.publicKeyName}, ${g.privateSecretName}`);
        });
        
        console.log('\n' + '─'.repeat(60));
    } catch(e) {
        log.error(`Failed to list gateways: ${e.response?.data?.message || e.message}`);
    }
}

/**
 * Check current gateway configuration status
 */
async function checkStatus() {
    console.log('\n========== Current Gateway Status ==========\n');
    
    try {
        // Get merchant info
        const merchant = await api.get('/merchant/get');
        console.log('Merchant:', merchant.data.data?.merchant?.companyName || 'N/A');
        
        // List configured gateways
        const gateways = await api.get('/merchant/gateway/list');
        const configuredGateways = gateways.data.data?.gateways || [];
        
        if (configuredGateways.length === 0) {
            log.warn('No payment gateways are configured!');
            console.log('\nTo configure Stripe, add these to your .env:');
            console.log('  STRIPE_PUBLISHABLE_KEY=pk_test_xxx');
            console.log('  STRIPE_SECRET_KEY=sk_test_xxx');
            console.log('\nThen run: node src/helper/migration/unibee-gateway-setup.js setup');
        } else {
            console.log(`\nConfigured Gateways: ${configuredGateways.length}`);
            configuredGateways.forEach(g => {
                console.log(`\n  ${g.displayName || g.gatewayName}`);
                console.log(`    Gateway ID: ${g.gatewayId}`);
                console.log(`    Status: ${g.IsSetupFinished ? '✅ Active' : '⚠️ Incomplete'}`);
                console.log(`    Is Default: ${g.isDefault ? 'Yes' : 'No'}`);
            });
        }
    } catch(e) {
        log.error(`Failed to check status: ${e.response?.data?.message || e.message}`);
    }
    
    console.log('\n' + '='.repeat(45) + '\n');
}

/**
 * Setup Stripe gateway
 */
async function setupStripe() {
    console.log('\n========== Setting Up Stripe Gateway ==========\n');
    
    const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
    const secretKey = process.env.STRIPE_SECRET_KEY;
    
    if (!publishableKey || !secretKey) {
        log.error('Stripe keys not found in environment!');
        console.log('\nPlease add these to your .env file:');
        console.log('  STRIPE_PUBLISHABLE_KEY=pk_test_xxx  (or pk_live_xxx for production)');
        console.log('  STRIPE_SECRET_KEY=sk_test_xxx       (or sk_live_xxx for production)');
        console.log('\nYou can get these from: https://dashboard.stripe.com/apikeys');
        return;
    }
    
    const isTestMode = publishableKey.startsWith('pk_test_');
    log.info(`Using ${isTestMode ? 'TEST' : 'LIVE'} Stripe keys`);
    
    try {
        // Setup Stripe gateway
        const setupData = {
            gatewayName: 'stripe',
            gatewayKey: publishableKey,      // Public key
            gatewaySecret: secretKey,         // Secret key
            currency: 'USD',                  // Default currency
            displayName: 'Credit/Debit Card',
        };
        
        log.info('Configuring Stripe gateway...');
        
        const response = await api.post('/merchant/gateway/setup', setupData);
        
        if (response.data.code === 0) {
            log.success('Stripe gateway configured successfully!');
            console.log('\nGateway Details:');
            console.log(JSON.stringify(response.data.data, null, 2));
            
            // Set as default gateway
            if (response.data.data?.gateway?.gatewayId) {
                log.info('Setting Stripe as default gateway...');
                try {
                    await api.post('/merchant/gateway/edit', {
                        gatewayId: response.data.data.gateway.gatewayId,
                        isDefault: true
                    });
                    log.success('Stripe is now the default gateway!');
                } catch(e) {
                    log.warn('Could not set as default: ' + (e.response?.data?.message || e.message));
                }
            }
        } else {
            log.error(`Failed to setup Stripe: ${response.data.message}`);
        }
    } catch(e) {
        log.error(`Error setting up Stripe: ${e.response?.data?.message || e.message}`);
        if (e.response?.data) {
            console.log('Response:', JSON.stringify(e.response.data, null, 2));
        }
    }
    
    console.log('\n' + '='.repeat(45) + '\n');
}

/**
 * Setup webhook endpoint for Stripe
 */
async function setupWebhook() {
    console.log('\n========== Setting Up Webhook ==========\n');
    
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || process.env.UNIBEE_WEBHOOK_SECRET;
    
    try {
        const gateways = await api.get('/merchant/gateway/list');
        const stripeGateway = gateways.data.data?.gateways?.find(g => g.gatewayName === 'stripe');
        
        if (!stripeGateway) {
            log.error('Stripe gateway not found. Please run setup first.');
            return;
        }
        
        // Get webhook endpoint URL
        console.log('Your UniBee webhook endpoint for Stripe:');
        console.log(`  ${UNIBEE_API_URL}/payment/gateway/webhook/stripe/${stripeGateway.gatewayId}`);
        
        console.log('\nSteps to configure in Stripe Dashboard:');
        console.log('1. Go to https://dashboard.stripe.com/webhooks');
        console.log('2. Click "Add endpoint"');
        console.log('3. Enter the webhook URL above');
        console.log('4. Select events to listen for:');
        console.log('   - checkout.session.completed');
        console.log('   - customer.subscription.created');
        console.log('   - customer.subscription.updated');
        console.log('   - customer.subscription.deleted');
        console.log('   - invoice.paid');
        console.log('   - invoice.payment_failed');
        console.log('5. Get the webhook signing secret and add to .env:');
        console.log('   STRIPE_WEBHOOK_SECRET=whsec_xxx');
        
        if (webhookSecret) {
            log.info('Updating gateway with webhook secret...');
            await api.post('/merchant/gateway/edit', {
                gatewayId: stripeGateway.gatewayId,
                webhookSecret: webhookSecret
            });
            log.success('Webhook secret updated!');
        }
    } catch(e) {
        log.error(`Error: ${e.response?.data?.message || e.message}`);
    }
}

// Main CLI handler
const command = process.argv[2] || 'status';

switch (command) {
    case 'list':
        listGateways();
        break;
    case 'setup':
        setupStripe();
        break;
    case 'webhook':
        setupWebhook();
        break;
    case 'status':
    default:
        checkStatus();
        break;
}
