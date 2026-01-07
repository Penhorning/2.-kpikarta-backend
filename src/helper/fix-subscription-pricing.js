#!/usr/bin/env node
'use strict';

/**
 * Fix subscription pricing for existing subscriptions
 * This script updates subscriptions that have amount: 0 or missing pricing data
 * by fetching the correct pricing from UniBee and updating the database
 */

const path = require('path');
const app = require(path.resolve(__dirname, '../server/server'));
const unibee = require('./unibee');

async function fixSubscriptionPricing(email) {
    try {
        console.log(`\n=== Fixing subscription pricing for: ${email} ===\n`);
        
        // Find user
        const user = await app.models.user.findOne({ where: { email: email }});
        if (!user) {
            console.error('User not found:', email);
            return;
        }
        
        console.log('User found:', user.email, 'Company:', user.companyId);
        
        // Find subscription
        const subscription = await app.models.subscription.findOne({ 
            where: { companyId: user.companyId }
        });
        
        if (!subscription) {
            console.error('Subscription not found for company:', user.companyId);
            return;
        }
        
        console.log('Current subscription:');
        console.log('  ID:', subscription.id);
        console.log('  Plan ID:', subscription.planId);
        console.log('  Amount:', subscription.amount);
        console.log('  Status:', subscription.status);
        console.log('  Frequency:', subscription.frequency);
        console.log('  Subscription ID:', subscription.subscriptionId);
        
        // Get subscription details from UniBee
        console.log('\nFetching subscription details from UniBee...');
        const unibeeSubResponse = await unibee.get_subscription(subscription.subscriptionId);
        
        if (unibeeSubResponse.status !== 200) {
            console.error('Failed to get subscription from UniBee:', unibeeSubResponse);
            return;
        }
        
        const unibeeSub = unibeeSubResponse.data.subscription;
        console.log('\nUniBee subscription data:');
        console.log('  Amount:', unibeeSub.amount);
        console.log('  Plan ID:', unibeeSub.planId);
        console.log('  Plan Name:', unibeeSub.plan?.planName);
        console.log('  Plan Amount:', unibeeSub.plan?.amount);
        console.log('  Status:', unibeeSub.status);
        
        // Build proper subscription_items structure
        const subscription_items = [{
            item_price_id: unibeeSub.planId,
            quantity: unibeeSub.quantity || 1,
            amount: unibeeSub.amount, // Already in cents
            unit_price: unibeeSub.plan?.amount || unibeeSub.amount,
            unitAmount: unibeeSub.plan?.amount || unibeeSub.amount,
            planId: unibeeSub.planId
        }];
        
        // Update subscriptionDetails with proper structure
        const updatedDetails = {
            ...subscription.subscriptionDetails,
            subscription_items: subscription_items,
            amount: unibeeSub.amount,
            _unibee: unibeeSub
        };
        
        // Calculate amount in dollars (UniBee stores in cents)
        const amountInDollars = unibeeSub.amount / 100;
        
        console.log('\nUpdating subscription with:');
        console.log('  Amount:', amountInDollars, '(from', unibeeSub.amount, 'cents)');
        console.log('  Subscription items:', JSON.stringify(subscription_items, null, 2));
        
        // Update the subscription
        await subscription.updateAttributes({
            amount: amountInDollars,
            subscriptionDetails: updatedDetails
        });
        
        console.log('\n✓ Subscription updated successfully!');
        console.log('\nUpdated subscription:');
        console.log('  Amount:', amountInDollars);
        console.log('  Subscription items with pricing:', subscription_items[0].unit_price, 'cents');
        
        process.exit(0);
    } catch (err) {
        console.error('Error fixing subscription:', err);
        process.exit(1);
    }
}

// Get email from command line
const email = process.argv[2];
if (!email) {
    console.error('Usage: node fix-subscription-pricing.js <email>');
    console.error('Example: node fix-subscription-pricing.js addmobee@gmail.com');
    process.exit(1);
}

// Run the fix
fixSubscriptionPricing(email);
