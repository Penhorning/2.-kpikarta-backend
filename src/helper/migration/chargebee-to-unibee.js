'use strict';

/**
 * ChargeBee to UniBee Data Migration Script
 * 
 * This script migrates existing subscription data from ChargeBee to UniBee.
 * It should be run once during the migration process.
 * 
 * Usage:
 *   node src/helper/migration/chargebee-to-unibee.js [--dry-run] [--customer-id <id>]
 * 
 * Options:
 *   --dry-run        Run without making actual changes to UniBee
 *   --customer-id    Migrate only a specific customer (for testing)
 *   --verbose        Enable verbose logging
 */

require('dotenv').config();

const axios = require('axios');
const chargebee = require('chargebee');
const fs = require('fs');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');

// MongoDB configuration
const MONGODB_HOST = process.env.MONGODB_HOST || '127.0.0.1';
const MONGODB_PORT = process.env.MONGODB_PORT || 27018;
const MONGODB_DB = process.env.DB || 'kpikarta';
const MONGODB_URL = process.env.MONGODB_URL || `mongodb://${MONGODB_HOST}:${MONGODB_PORT}/${MONGODB_DB}`;

// MongoDB connection
let mongoClient = null;
let db = null;

// Configure ChargeBee
chargebee.configure({
    site: process.env.CHARGEBEE_SITE_NAME || 'kpikarta',
    api_key: process.env.CHARGEBEE_API_KEY
});

// UniBee configuration
const UNIBEE_API_URL = process.env.UNIBEE_API_URL || 'https://api.unibee.dev';
const UNIBEE_API_KEY = process.env.UNIBEE_API_KEY;

// Migration configuration
const BATCH_SIZE = 10;
const DELAY_BETWEEN_BATCHES = 1000; // ms

// Plan mapping from ChargeBee to UniBee
// Based on ChargeBee item_price IDs from API query
// 
// ChargeBee ACTIVE PLANS (item_type=plan):
//   - cb-creator-plan-Monthly       ($9/month)   → UniBee Creator Monthly (425)
//   - cb-creator-plan-Yearly        ($99/year)   → UniBee Creator Yearly (424)
//   - Creator-Test-Free-USD-Monthly ($0/month)   → UniBee Spectator Free (419)
//   - Creator-Test-Free-USD-Yearly  ($0/year)    → UniBee Spectator Free (419)
//   - KPI-Karta-Creator---AppSumo-USD-Yearly   ($0/year, LTD) → UniBee AppSumo Plan (452)
//   - KPI-Karta-Creator---DealMirror-USD-Yearly ($0/year, LTD) → UniBee DealMirror Plan (453)
//
// ChargeBee ACTIVE ADDONS (item_type=addon):
//   - cb-creator-addon-plan-Monthly  ($9/month)  → UniBee Creator Addon Monthly (428)
//   - cb-creator-addon-plan-Yearly   ($99/year)  → UniBee Creator Addon Yearly (431)
//   - cb-champion-addon-plan-Monthly ($6/month)  → UniBee Champion Addon Monthly (432)
//   - cb-champion-addon-plan-Yearly  ($59/year)  → UniBee Champion Addon Yearly (430)
//
const PLAN_MAPPING = {
    // ========================
    // MAIN PLANS (Type 1)
    // ========================
    
    // Creator Plans - Active paid plans ($9/mo, $99/yr)
    'cb-creator-plan-Monthly': process.env.UNIBEE_CREATOR_MONTHLY_PLAN_ID,        // 425
    'cb-creator-plan-Yearly': process.env.UNIBEE_CREATOR_YEARLY_PLAN_ID,          // 424
    
    // Free Plans - All map to Spectator Free (419)
    'Creator-Test-Free-USD-Monthly': process.env.UNIBEE_SPECTATOR_PLAN_ID,        // 419
    'Creator-Test-Free-USD-Yearly': process.env.UNIBEE_SPECTATOR_PLAN_ID,         // 419
    
    // AppSumo & DealMirror Lifetime Deals - Dedicated $0 plans (same as ChargeBee)
    'KPI-Karta-Creator---AppSumo-USD-Yearly': process.env.UNIBEE_APPSUMO_PLAN_ID || '452',      // 452 (AppSumo $0/year)
    'KPI-Karta-Creator---DealMirror-USD-Yearly': process.env.UNIBEE_DEALMIRROR_PLAN_ID || '453', // 453 (DealMirror $0/year)
    
    // ========================
    // ADDONS (Type 2)
    // ========================
    
    // Creator Addon ($9/mo, $99/yr) - for additional users
    'cb-creator-addon-plan-Monthly': process.env.UNIBEE_CREATOR_MONTHLY_ADDON_PLAN_ID,  // 428
    'cb-creator-addon-plan-Yearly': process.env.UNIBEE_CREATOR_YEARLY_ADDON_PLAN_ID,    // 431
    
    // Champion Addon ($6/mo, $59/yr) - for champion users
    'cb-champion-addon-plan-Monthly': process.env.UNIBEE_CHAMPION_MONTHLY_ADDON_PLAN_ID, // 432
    'cb-champion-addon-plan-Yearly': process.env.UNIBEE_CHAMPION_YEARLY_ADDON_PLAN_ID,   // 430
    
    // ========================
    // ENV VAR DYNAMIC MAPPINGS (fallbacks from .env)
    // ========================
    [process.env.CREATOR_MONTHLY_PLAN_ID]: process.env.UNIBEE_CREATOR_MONTHLY_PLAN_ID,
    [process.env.CREATOR_YEARLY_PLAN_ID]: process.env.UNIBEE_CREATOR_YEARLY_PLAN_ID,
    [process.env.CREATOR_FREE_PLAN_ID]: process.env.UNIBEE_SPECTATOR_PLAN_ID,
    [process.env.CREATOR_MONTHLY_ADDON_PLAN_ID]: process.env.UNIBEE_CREATOR_MONTHLY_ADDON_PLAN_ID,
    [process.env.CREATOR_YEARLY_ADDON_PLAN_ID]: process.env.UNIBEE_CREATOR_YEARLY_ADDON_PLAN_ID,
    [process.env.CHAMPION_MONTHLY_ADDON_PLAN_ID]: process.env.UNIBEE_CHAMPION_MONTHLY_ADDON_PLAN_ID,
    [process.env.CHAMPION_YEARLY_ADDON_PLAN_ID]: process.env.UNIBEE_CHAMPION_YEARLY_ADDON_PLAN_ID,
    
    // ========================
    // ARCHIVED PLANS (for historical data migration)
    // ========================
    
    // Archived test plans - map to Spectator
    'Creator-Test-USD-Monthly': process.env.UNIBEE_SPECTATOR_PLAN_ID,
    'Creator-Test-USD-Yearly': process.env.UNIBEE_SPECTATOR_PLAN_ID,
    
    // Archived test addons - map to respective current addons
    'Creator-Addon-Test-USD-Monthly': process.env.UNIBEE_CREATOR_MONTHLY_ADDON_PLAN_ID,
    'Creator-Addon-Test-USD-Yearly': process.env.UNIBEE_CREATOR_YEARLY_ADDON_PLAN_ID,
    'Champion-Addon-Test-USD-Monthly': process.env.UNIBEE_CHAMPION_MONTHLY_ADDON_PLAN_ID,
    'Champion-Addon-Test-USD-Yearly': process.env.UNIBEE_CHAMPION_YEARLY_ADDON_PLAN_ID,
};

// Status mapping from ChargeBee to UniBee
const STATUS_MAPPING = {
    'active': 2,           // UniBee: Active
    'in_trial': 1,         // UniBee: Pending
    'non_renewing': 4,     // UniBee: Cancelled
    'paused': 5,           // UniBee: Suspended
    'cancelled': 4,        // UniBee: Cancelled
    'future': 1,           // UniBee: Pending
};

// Migration statistics
let stats = {
    customers: { total: 0, migrated: 0, failed: 0, skipped: 0 },
    subscriptions: { total: 0, migrated: 0, failed: 0, skipped: 0, withStripePayment: 0, withoutStripePayment: 0 },
    addons: { total: 0, migrated: 0, failed: 0 },  // Track addon migrations
    invoices: { total: 0, migrated: 0, failed: 0, skipped: 0 },
    database: { usersUpdated: 0, subscriptionsUpdated: 0, failed: 0 },  // Track database updates
    errors: []
};

// CLI arguments parsing
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isVerbose = args.includes('--verbose');

// Support both --customer-id and --single-customer (with email)
let specificCustomerId = null;
let specificCustomerEmail = null;

// Parse --customer-id <id>
if (args.includes('--customer-id')) {
    specificCustomerId = args[args.indexOf('--customer-id') + 1];
}

// Parse --single-customer=<email>
const singleCustomerArg = args.find(arg => arg.startsWith('--single-customer='));
if (singleCustomerArg) {
    specificCustomerEmail = singleCustomerArg.split('=')[1];
}

// Logger helper
const log = {
    info: (msg) => console.log(`[INFO] ${msg}`),
    success: (msg) => console.log(`[SUCCESS] ✅ ${msg}`),
    error: (msg) => console.error(`[ERROR] ❌ ${msg}`),
    warn: (msg) => console.warn(`[WARN] ⚠️ ${msg}`),
    verbose: (msg) => isVerbose && console.log(`[VERBOSE] ${msg}`),
    divider: () => console.log('─'.repeat(60))
};

/**
 * Create UniBee API client
 */
const unibeeApi = axios.create({
    baseURL: UNIBEE_API_URL,
    headers: {
        'Authorization': `Bearer ${UNIBEE_API_KEY}`,
        'Content-Type': 'application/json'
    },
    timeout: 30000 // 30 second timeout
});

/**
 * Sleep helper for rate limiting
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Connect to MongoDB
 */
async function connectToMongoDB() {
    if (isDryRun) {
        log.info('[DRY RUN] Skipping MongoDB connection');
        return null;
    }
    
    try {
        log.info(`Connecting to MongoDB at ${MONGODB_URL}...`);
        mongoClient = new MongoClient(MONGODB_URL);
        await mongoClient.connect();
        db = mongoClient.db(MONGODB_DB);
        log.success('Connected to MongoDB');
        return db;
    } catch (err) {
        log.error(`Failed to connect to MongoDB: ${err.message}`);
        throw err;
    }
}

/**
 * Disconnect from MongoDB
 */
async function disconnectFromMongoDB() {
    if (mongoClient) {
        await mongoClient.close();
        log.info('Disconnected from MongoDB');
    }
}

/**
 * Find user in local database by email
 */
async function findLocalUserByEmail(email) {
    if (!db || isDryRun) return null;
    
    try {
        const user = await db.collection('user').findOne({ email: email.toLowerCase() });
        return user;
    } catch (err) {
        log.error(`Failed to find user by email ${email}: ${err.message}`);
        return null;
    }
}

/**
 * Update local database with UniBee subscription details
 * This updates both the subscription record and the user record
 */
async function updateLocalDatabase(customerEmail, unibeeUserId, unibeeSubscription, unibeePlanId) {
    if (isDryRun) {
        log.verbose(`[DRY RUN] Would update local database for ${customerEmail}`);
        return { success: true, dryRun: true };
    }
    
    if (!db) {
        log.warn('MongoDB not connected, skipping local database update');
        return { success: false, error: 'MongoDB not connected' };
    }
    
    try {
        // Find the user by email
        const localUser = await findLocalUserByEmail(customerEmail);
        if (!localUser) {
            log.warn(`User not found in local database: ${customerEmail}`);
            stats.database.failed++;
            return { success: false, error: 'User not found' };
        }
        
        const userId = localUser._id;
        const subscriptionId = unibeeSubscription.subscriptionId || unibeeSubscription.id;
        
        log.verbose(`Updating local database for user ${customerEmail} (ID: ${userId})`);
        
        // Update or create subscription record
        const subscriptionUpdate = {
            $set: {
                customerId: String(unibeeUserId),
                subscriptionId: String(subscriptionId),
                planId: String(unibeePlanId),
                status: unibeeSubscription.status === 2 ? 'active' : 
                       (unibeeSubscription.status === 1 ? 'pending' : 
                       (unibeeSubscription.status === 3 ? 'incomplete' : 
                       (unibeeSubscription.status === 4 ? 'cancelled' : 
                       (unibeeSubscription.status === 5 ? 'suspended' : 'unknown')))),
                billingProvider: 'unibee',
                subscriptionDetails: unibeeSubscription,
                updatedAt: new Date(),
                migratedFromChargebee: true,
                migratedAt: new Date()
            }
        };
        
        // Find existing subscription for this user
        const existingSubscription = await db.collection('subscription').findOne({ 
            userId: userId 
        });
        
        if (existingSubscription) {
            // Update existing subscription
            await db.collection('subscription').updateOne(
                { _id: existingSubscription._id },
                subscriptionUpdate
            );
            log.verbose(`Updated existing subscription record for ${customerEmail}`);
        } else {
            // Create new subscription record
            const newSubscription = {
                userId: userId,
                companyId: localUser.companyId,
                customerId: String(unibeeUserId),
                subscriptionId: String(subscriptionId),
                planId: String(unibeePlanId),
                status: unibeeSubscription.status === 2 ? 'active' : 'pending',
                frequency: unibeeSubscription.planId ? 'yearly' : 'monthly', // Default, will be overwritten
                nextSubscriptionDate: unibeeSubscription.currentPeriodEnd ? 
                    new Date(unibeeSubscription.currentPeriodEnd * 1000) : new Date(),
                amount: unibeeSubscription.amount || 0,
                billingProvider: 'unibee',
                subscriptionDetails: unibeeSubscription,
                migratedFromChargebee: true,
                migratedAt: new Date(),
                createdAt: new Date(),
                updatedAt: new Date()
            };
            
            const insertResult = await db.collection('subscription').insertOne(newSubscription);
            
            // Update user with new subscription ID
            await db.collection('user').updateOne(
                { _id: userId },
                { 
                    $set: { 
                        subscriptionId: insertResult.insertedId,
                        subscriptionStatus: newSubscription.status
                    }
                }
            );
            log.verbose(`Created new subscription record for ${customerEmail}`);
        }
        
        stats.database.subscriptionsUpdated++;
        stats.database.usersUpdated++;
        
        return { success: true };
    } catch (err) {
        log.error(`Failed to update local database for ${customerEmail}: ${err.message}`);
        stats.database.failed++;
        stats.errors.push({
            type: 'database',
            email: customerEmail,
            error: err.message
        });
        return { success: false, error: err.message };
    }
}

/**
 * Activate all plans in UniBee
 * Plans must be activated before subscriptions can be imported
 */
async function activateUniBePlans() {
    log.info('Activating UniBee plans...');
    
    const planIds = Object.values(PLAN_MAPPING).filter(id => id && id !== 'undefined');
    const uniquePlanIds = [...new Set(planIds)];
    
    for (const planId of uniquePlanIds) {
        try {
            await unibeeApi.post('/merchant/plan/activate', { planId: parseInt(planId) });
            log.verbose(`Activated plan ${planId}`);
        } catch (err) {
            // Plan might already be active, that's okay
            log.verbose(`Plan ${planId}: ${err.response?.data?.message || 'already active'}`);
        }
    }
    
    log.success(`Activated ${uniquePlanIds.length} plans`);
}

/**
 * Fetch all customers from ChargeBee
 */
async function fetchChargeBeeCustomers() {
    log.info('Fetching customers from ChargeBee...');
    
    const customers = [];
    let offset = null;
    
    do {
        const params = { limit: 100 };
        if (offset) params.offset = offset;
        if (specificCustomerId) params['id[is]'] = specificCustomerId;
        if (specificCustomerEmail) params['email[is]'] = specificCustomerEmail;
        
        const result = await new Promise((resolve, reject) => {
            chargebee.customer.list(params).request((err, result) => {
                if (err) reject(err);
                else resolve(result);
            });
        });
        
        for (let item of result.list) {
            customers.push(item.customer);
        }
        
        offset = result.next_offset;
    } while (offset);
    
    log.info(`Found ${customers.length} customers in ChargeBee`);
    return customers;
}

/**
 * Fetch subscriptions for a customer from ChargeBee
 */
async function fetchChargeBeeSubscriptions(customerId) {
    return new Promise((resolve, reject) => {
        chargebee.subscription.list({
            'customer_id[is]': customerId,
            limit: 100
        }).request((err, result) => {
            if (err) reject(err);
            else resolve(result.list.map(item => item.subscription));
        });
    });
}

/**
 * Fetch invoices for a customer from ChargeBee
 */
async function fetchChargeBeeInvoices(customerId) {
    return new Promise((resolve, reject) => {
        chargebee.invoice.list({
            'customer_id[is]': customerId,
            limit: 100
        }).request((err, result) => {
            if (err) reject(err);
            else resolve(result.list.map(item => item.invoice));
        });
    });
}

/**
 * Fetch Stripe payment info from ChargeBee for a customer
 * Returns { stripeUserId, stripePaymentMethod } or null
 */
async function fetchStripePaymentInfo(customerId) {
    try {
        // Get payment sources for this customer
        const result = await new Promise((resolve, reject) => {
            chargebee.payment_source.list({
                'customer_id[is]': customerId,
                limit: 10
            }).request((err, result) => {
                if (err) reject(err);
                else resolve(result);
            });
        });
        
        // Find a valid Stripe payment source
        for (const item of result.list) {
            const ps = item.payment_source;
            
            // We only care about Stripe gateway sources
            if (ps.gateway !== 'stripe' || ps.status !== 'valid') {
                continue;
            }
            
            // The reference_id contains: "{stripeCustomerId}/{stripeCardId}"
            // Example: "cus_TNW2X8IyCXeYNH/card_1SQl0dE58NAj8qWbIgE9f0jQ"
            if (ps.reference_id && ps.reference_id.includes('/')) {
                const parts = ps.reference_id.split('/');
                const stripeUserId = parts[0];        // cus_xxx
                const stripePaymentMethod = parts[1]; // card_xxx or pm_xxx
                
                log.verbose(`Found Stripe payment for ${customerId}: ${stripeUserId} / ${stripePaymentMethod}`);
                
                return {
                    stripeUserId: stripeUserId,
                    stripePaymentMethod: stripePaymentMethod
                };
            }
        }
        
        // Also check transactions for Stripe info if no payment source found
        const txResult = await new Promise((resolve, reject) => {
            chargebee.transaction.list({
                'customer_id[is]': customerId,
                'gateway[is]': 'stripe',
                'status[is]': 'success',
                limit: 1
            }).request((err, result) => {
                if (err) reject(err);
                else resolve(result);
            });
        });
        
        if (txResult.list.length > 0) {
            const tx = txResult.list[0].transaction;
            // id_at_gateway is the Stripe charge ID (ch_xxx)
            // We need to get the customer from the payment source
            if (tx.payment_source_id) {
                const psResult = await new Promise((resolve, reject) => {
                    chargebee.payment_source.retrieve(tx.payment_source_id).request((err, result) => {
                        if (err) reject(err);
                        else resolve(result);
                    });
                });
                
                const ps = psResult.payment_source;
                if (ps.reference_id && ps.reference_id.includes('/')) {
                    const parts = ps.reference_id.split('/');
                    return {
                        stripeUserId: parts[0],
                        stripePaymentMethod: parts[1]
                    };
                }
            }
        }
        
        log.verbose(`No Stripe payment info found for customer ${customerId}`);
        return null;
        
    } catch (err) {
        log.verbose(`Error fetching Stripe info for ${customerId}: ${err.message}`);
        return null;
    }
}

/**
 * Create or update user in UniBee
 */
async function createUniBeeUser(customer) {
    log.verbose(`Creating UniBee user for: ${customer.email}`);
    
    const userData = {
        email: customer.email,
        externalUserId: customer.id,
        firstName: customer.first_name || '',
        lastName: customer.last_name || '',
        phone: customer.phone || '',
        address: customer.billing_address ? {
            line1: customer.billing_address.line1,
            line2: customer.billing_address.line2,
            city: customer.billing_address.city,
            state: customer.billing_address.state,
            country: customer.billing_address.country,
            zip: customer.billing_address.zip
        } : null,
        metadata: {
            chargebeeCustomerId: customer.id,
            migratedAt: new Date().toISOString()
        }
    };
    
    if (isDryRun) {
        log.verbose(`[DRY RUN] Would create user: ${customer.email}`);
        return { id: `dry-run-${customer.id}`, ...userData };
    }
    
    try {
        // Try to find existing user first
        const searchResponse = await unibeeApi.get('/merchant/user/search', {
            params: { email: customer.email }
        });
        
        // Check if user exists in the userAccounts array
        if (searchResponse.data?.data?.userAccounts && searchResponse.data.data.userAccounts.length > 0) {
            const existingUser = searchResponse.data.data.userAccounts[0];
            log.verbose(`User already exists: ${customer.email} (status: ${existingUser.status})`);
            
            // If user is suspended (status 2), try to update gatewayId to ensure it's set
            if (existingUser.status === 2) {
                log.warn(`User ${customer.email} is suspended - updating gateway...`);
                try {
                    await unibeeApi.post('/merchant/user/update', {
                        userId: existingUser.id,
                        gatewayId: 82  // Stripe gateway
                    });
                } catch (updateErr) {
                    log.verbose(`Could not update suspended user: ${updateErr.message}`);
                }
            }
            
            return existingUser;
        }
    } catch (err) {
        // User doesn't exist, continue to create new one
        log.verbose(`Search failed for ${customer.email}: ${err.message}`);
    }
    
    // Use the correct endpoint: /merchant/user/new with gatewayId
    userData.gatewayId = 82; // Stripe gateway
    const response = await unibeeApi.post('/merchant/user/new', userData);
    return response.data?.data?.user || response.data?.user;
}

/**
 * Get plan ID from ChargeBee subscription
 * ChargeBee v2 uses subscription_items instead of plan_id
 */
function getChargeBePlanId(subscription) {
    // First check subscription_items (ChargeBee v2)
    if (subscription.subscription_items && subscription.subscription_items.length > 0) {
        // Find the primary plan (item_type: 'plan')
        const planItem = subscription.subscription_items.find(item => item.item_type === 'plan');
        if (planItem) {
            console.log('Found plan item:', planItem);
            return planItem.item_price_id;
        }
        // If no plan type found, use the first item
        return subscription.subscription_items[0].item_price_id;
    }
    // Fallback to old plan_id field (ChargeBee v1)
    return subscription.plan_id;
}

/**
 * Get addon items from ChargeBee subscription
 * Returns array of { planId, quantity } for tracking purposes
 * NOTE: UniBee's active_subscription_import API does NOT support importing addons directly.
 * Addons must be added separately after import via /merchant/subscription/addon/update
 */
function getChargeBeeAddons(subscription) {
    const addons = [];
    
    if (subscription.subscription_items && subscription.subscription_items.length > 0) {
        // Find all addon items (item_type: 'addon')
        const addonItems = subscription.subscription_items.filter(item => item.item_type === 'addon');
        
        for (const addon of addonItems) {
            const unibeeAddonPlanId = PLAN_MAPPING[addon.item_price_id];
            if (unibeeAddonPlanId) {
                addons.push({
                    planId: parseInt(unibeeAddonPlanId),
                    quantity: addon.quantity || 1,
                    _chargebeeAddonId: addon.item_price_id
                });
                log.verbose(`Found addon: ${addon.item_price_id} -> UniBee planId ${unibeeAddonPlanId} (qty: ${addon.quantity})`);
            } else {
                log.warn(`No UniBee mapping for ChargeBee addon: ${addon.item_price_id}`);
            }
        }
    }
    
    return addons;
}

/**
 * Import subscription to UniBee
 * Uses the active_subscription_import endpoint per UniBee documentation
 * @param {Object} subscription - ChargeBee subscription object
 * @param {string} unibeeUserId - UniBee user ID
 * @param {Object} customer - ChargeBee customer object
 * @param {Object} stripePaymentInfo - Optional Stripe payment info { stripeUserId, stripePaymentMethod }
 */
async function importSubscriptionToUniBee(subscription, unibeeUserId, customer, stripePaymentInfo = null) {
    log.verbose(`Importing subscription ${subscription.id} for user ${unibeeUserId}`);
    
    const chargebeePlanId = getChargeBePlanId(subscription);
    log.verbose(`ChargeBee plan ID: ${chargebeePlanId}`);
    
    const unibeePlanId = PLAN_MAPPING[chargebeePlanId];
    if (!unibeePlanId) {
        log.warn(`No UniBee plan mapping for ChargeBee plan: ${chargebeePlanId}`);
        return null;
    }
    
    // Check if subscription is active (current_term_end must be in the future)
    const now = Math.floor(Date.now() / 1000);
    if (subscription.current_term_end && subscription.current_term_end < now) {
        log.warn(`Skipping expired subscription ${subscription.id} (ended ${new Date(subscription.current_term_end * 1000).toISOString()})`);
        stats.subscriptions.skipped++;
        return null;
    }
    
    // Skip cancelled/paused/non_renewing subscriptions for active import
    // IMPORTANT: non_renewing means user cancelled but subscription is still valid until end date
    // We should NOT import these to UniBee as they will be charged on the next billing cycle!
    if (['cancelled', 'paused', 'non_renewing'].includes(subscription.status)) {
        log.warn(`Skipping ${subscription.status} subscription ${subscription.id}`);
        stats.subscriptions.skipped++;
        return null;
    }
    
    // Format dates as "YYYY-MM-DD HH:mm:ss" for UniBee
    const formatDate = (timestamp) => {
        if (!timestamp) return null;
        const date = new Date(timestamp * 1000);
        return date.toISOString().replace('T', ' ').substring(0, 19);
    };
    
    // Handle trial subscriptions - use trial dates if current_term dates are not available
    const isInTrial = subscription.status === 'in_trial';
    const periodStart = subscription.current_term_start || subscription.trial_start || subscription.started_at || subscription.created_at;
    const periodEnd = subscription.current_term_end || subscription.trial_end || subscription.next_billing_at;
    
    log.verbose(`Subscription status: ${subscription.status}, periodStart: ${periodStart}, periodEnd: ${periodEnd}`);
    
    // Extract addons from ChargeBee subscription
    const addons = getChargeBeeAddons(subscription);
    if (addons.length > 0) {
        log.info(`Found ${addons.length} addon(s) for subscription ${subscription.id}`);
    }
    
    // Build subscription data per UniBee's active_subscription_import API
    // 
    // API Expected Parameters (from docs):
    // - StripePaymentMethod, StripeUserId (PascalCase!)
    // - billingCycleAnchor, countryCode, createTime, currentPeriodEnd, currentPeriodStart
    // - email, expectedTotalAmount, externalPlanId, externalSubscriptionId, externalUserId
    // - features, firstPaidTime, gateway, gatewayPaymentType, metadata
    // - planId, quantity, taxPercentage, vatNumber, addonData
    //
    
    // Build addonData - if addons exist format them, otherwise send empty array "[]"
    // This fixes the portal error "UnmarshalFromJsonString err:target is nil" caused by addonData: ""
    let addonDataString = "[]";
    if (addons.length > 0) {
        const addonDataArray = addons.map(a => ({
            addonPlanId: a.planId,
            quantity: a.quantity || 1
        }));
        addonDataString = JSON.stringify(addonDataArray);
        log.verbose(`Including ${addons.length} addon(s) in addonData: ${addonDataString}`);
    }
    
    const subscriptionData = {
        // Required fields
        externalSubscriptionId: subscription.id,  // ChargeBee subscription ID
        externalUserId: customer.id,              // ChargeBee customer ID as external reference
        planId: parseInt(unibeePlanId),
        email: customer.email,
        gateway: 'stripe',                        // Payment gateway name
        
        // Period information (required) - use trial dates for in_trial subscriptions
        currentPeriodStart: formatDate(periodStart),
        currentPeriodEnd: formatDate(periodEnd),
        billingCycleAnchor: formatDate(periodStart),
        createTime: formatDate(subscription.created_at),
        firstPaidTime: isInTrial ? null : formatDate(subscription.activated_at || subscription.created_at),
        
        // Optional but recommended
        quantity: subscription.plan_quantity || 1,
        
        // Addon data - must be stringified JSON array (empty or with addons)
        // This fixes portal error when addonData is empty string ""
        addonData: addonDataString,
        
        // Metadata for tracking
        metadata: {
            chargebeeSubscriptionId: subscription.id,
            chargebeeCustomerId: customer.id,
            originalStatus: subscription.status,
            migratedAt: new Date().toISOString(),
            chargebeeAddons: addons.map(a => a._chargebeeAddonId)
        },
        
        // Features as JSON string
        features: JSON.stringify({
            chargebeeSubscriptionId: subscription.id,
            originalStatus: subscription.status
        })
    };
    
    if (addons.length > 0) {
        log.info(`Subscription ${subscription.id} includes ${addons.length} addon(s)`);
    }
    
    // Add Stripe payment info if available (CRITICAL for auto-charge and portal access)
    // NOTE: API uses PascalCase for Stripe fields: StripeUserId, StripePaymentMethod
    if (stripePaymentInfo && stripePaymentInfo.stripeUserId) {
        subscriptionData.StripeUserId = stripePaymentInfo.stripeUserId;           // PascalCase per API docs
        subscriptionData.StripePaymentMethod = stripePaymentInfo.stripePaymentMethod || '';  // PascalCase per API docs
        log.verbose(`Including Stripe payment: ${stripePaymentInfo.stripeUserId} / ${stripePaymentInfo.stripePaymentMethod}`);
        stats.subscriptions.withStripePayment++;
    } else {
        log.warn(`No Stripe payment info for subscription ${subscription.id} - portal may show errors`);
        stats.subscriptions.withoutStripePayment++;
    }
    
    if (isDryRun) {
        log.verbose(`[DRY RUN] Would import subscription: ${subscription.id}`);
        return { 
            subscription: { id: `dry-run-${subscription.id}`, ...subscriptionData },
            addons: addons,  // Return addons for separate processing
            unibeePlanId: unibeePlanId  // Return plan ID for database update
        };
    }
    
    try {
        // Use the correct UniBee endpoint for active subscription import
        const response = await unibeeApi.post('/merchant/subscription/active_subscription_import', subscriptionData);
        const importedSubscription = response.data?.data?.subscription || response.data?.subscription || response.data;
        
        // Return both subscription and addons for further processing
        return {
            subscription: importedSubscription,
            addons: addons,  // Pass addons to be added in a separate step
            unibeePlanId: unibeePlanId  // Return plan ID for database update
        };
    } catch (err) {
        log.error(`Failed to import subscription ${subscription.id}: ${err.message}`);
        if (err.response?.data) {
            log.verbose(`Error details: ${JSON.stringify(err.response.data)}`);
        }
        stats.errors.push({
            type: 'subscription',
            id: subscription.id,
            error: err.message
        });
        return null;
    }
}

/**
 * Add addons to a UniBee subscription after import
 * UniBee's active_subscription_import doesn't support addons directly,
 * so we need to add them in a separate step via /merchant/subscription/addon/update
 * 
 * @param {string} subscriptionId - UniBee subscription ID
 * @param {Array} addons - Array of { planId, quantity } objects
 * @returns {Object|null} - Updated subscription or null on failure
 */
async function addAddonsToSubscription(subscriptionId, addons) {
    if (!addons || addons.length === 0) {
        log.verbose(`No addons to add for subscription ${subscriptionId}`);
        return null;
    }
    
    // Track total addons
    stats.addons.total += addons.length;
    
    log.info(`Adding ${addons.length} addon(s) to subscription ${subscriptionId}`);
    
    // Format addons for UniBee API
    // The API expects: addonData as JSON string with array of { addonPlanId, quantity }
    const addonDataArray = addons.map(addon => ({
        addonPlanId: addon.planId,
        quantity: addon.quantity || 1
    }));
    
    const requestData = {
        subscriptionId: subscriptionId,
        addonData: JSON.stringify(addonDataArray),
        // Don't prorate to avoid charging the customer during migration
        prorationDate: 0
    };
    
    log.verbose(`Addon request data: ${JSON.stringify(requestData)}`);
    
    if (isDryRun) {
        log.verbose(`[DRY RUN] Would add addons: ${JSON.stringify(addonDataArray)}`);
        stats.addons.migrated += addons.length;
        return { addons: addonDataArray };
    }
    
    try {
        const response = await unibeeApi.post('/merchant/subscription/addon/update', requestData);
        log.info(`Successfully added addons to subscription ${subscriptionId}`);
        stats.addons.migrated += addons.length;
        return response.data?.data?.subscription || response.data;
    } catch (err) {
        log.error(`Failed to add addons to subscription ${subscriptionId}: ${err.message}`);
        if (err.response?.data) {
            log.verbose(`Error details: ${JSON.stringify(err.response.data)}`);
        }
        stats.addons.failed += addons.length;
        stats.errors.push({
            type: 'addon',
            subscriptionId: subscriptionId,
            addons: addonDataArray,
            error: err.message
        });
        return null;
    }
}

/**
 * Import invoice/payment history to UniBee
 */
async function importInvoiceToUniBee(invoice, unibeeUserId, unibeeSubscriptionId) {
    log.verbose(`Importing invoice ${invoice.id}`);
    
    const invoiceData = {
        userId: unibeeUserId,
        subscriptionId: unibeeSubscriptionId,
        amountDue: invoice.amount_due,
        amountPaid: invoice.amount_paid,
        currency: invoice.currency_code || 'USD',
        status: invoice.status,
        invoiceDate: invoice.date,
        dueDate: invoice.due_date,
        paidAt: invoice.paid_at,
        metadata: {
            chargebeeInvoiceId: invoice.id,
            migratedAt: new Date().toISOString()
        }
    };
    
    if (isDryRun) {
        log.verbose(`[DRY RUN] Would import invoice: ${invoice.id}`);
        return { id: `dry-run-${invoice.id}`, ...invoiceData };
    }
    
    try {
        const response = await unibeeApi.post('/merchant/payment/import', invoiceData);
        return response.data.payment;
    } catch (err) {
        log.error(`Failed to import invoice ${invoice.id}: ${err.message}`);
        stats.errors.push({
            type: 'invoice',
            id: invoice.id,
            error: err.message
        });
        return null;
    }
}

/**
 * Migrate a single customer with all their data
 */
async function migrateCustomer(customer) {
    log.info(`Migrating customer: ${customer.email} (${customer.id})`);
    
    try {
        // Step 1: Create user in UniBee
        const unibeeUser = await createUniBeeUser(customer);
        if (!unibeeUser) {
            stats.customers.failed++;
            return null;
        }
        stats.customers.migrated++;
        
        // Step 2: Fetch Stripe payment info for this customer
        const stripePaymentInfo = await fetchStripePaymentInfo(customer.id);

        if (stripePaymentInfo) {
            log.verbose(`Stripe info for ${customer.email}: ${stripePaymentInfo.stripeUserId}`);
        }
        
        // Step 3: Fetch and migrate subscriptions
        const subscriptions = await fetchChargeBeeSubscriptions(customer.id);
        stats.subscriptions.total += subscriptions.length;
        
        for (const subscription of subscriptions) {
            const importResult = await importSubscriptionToUniBee(
                subscription, 
                unibeeUser.id, 
                customer,
                stripePaymentInfo  
            );
            
            if (importResult && importResult.subscription) {
                const unibeeSubscription = importResult.subscription;
                const addons = importResult.addons || [];
                const unibeePlanId = importResult.unibeePlanId;
                
                stats.subscriptions.migrated++;
                
                // Step 3.5: Add addons to the subscription (if any)
                // UniBee's active_subscription_import doesn't support addons directly
                // We need to add them separately via /merchant/subscription/addon/update
                if (addons.length > 0) {
                    const subscriptionId = unibeeSubscription.subscriptionId || unibeeSubscription.id;
                    log.info(`Adding ${addons.length} addon(s) to subscription ${subscriptionId}`);
                    
                    const addonResult = await addAddonsToSubscription(subscriptionId, addons);
                    if (addonResult) {
                        log.info(`Successfully added addons to ${subscriptionId}`);
                    } else {
                        log.warn(`Failed to add addons to ${subscriptionId} - subscription imported but addons missing`);
                    }
                }
                
                // Step 3.6: Update local MongoDB database with new UniBee IDs
                // This is critical for the app to recognize the migrated subscriptions
                const dbUpdateResult = await updateLocalDatabase(
                    customer.email,
                    unibeeUser.id,
                    unibeeSubscription,
                    unibeePlanId
                );
                if (dbUpdateResult.success) {
                    log.verbose(`Updated local database for ${customer.email}`);
                } else if (!dbUpdateResult.dryRun) {
                    log.warn(`Failed to update local database for ${customer.email}: ${dbUpdateResult.error}`);
                }
                
                // Step 4: Fetch and migrate invoices for this subscription
                const invoices = await fetchChargeBeeInvoices(customer.id);
                stats.invoices.total += invoices.length;
                
                for (const invoice of invoices) {
                    if (invoice.subscription_id === subscription.id) {
                        const subscriptionId = unibeeSubscription.subscriptionId || unibeeSubscription.id;
                        const unibeeInvoice = await importInvoiceToUniBee(
                            invoice,
                            unibeeUser.id,
                            subscriptionId
                        );
                        if (unibeeInvoice) {
                            stats.invoices.migrated++;
                        } else {
                            stats.invoices.failed++;
                        }
                    }
                }
            } else {
                stats.subscriptions.failed++;
            }
        }
        
        return unibeeUser;
    } catch (err) {
        log.error(`Failed to migrate customer ${customer.id}: ${err.message}`);
        stats.customers.failed++;
        stats.errors.push({
            type: 'customer',
            id: customer.id,
            email: customer.email,
            error: err.message
        });
        return null;
    }
}

/**
 * Generate migration report
 */
function generateReport() {
    const reportPath = path.join(__dirname, `migration-report-${Date.now()}.json`);
    const report = {
        timestamp: new Date().toISOString(),
        mode: isDryRun ? 'DRY RUN' : 'LIVE',
        statistics: stats,
        planMapping: PLAN_MAPPING,
        configuration: {
            chargebeeSite: process.env.CHARGEBEE_SITE_NAME,
            unibeeApiUrl: UNIBEE_API_URL
        }
    };
    
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    return reportPath;
}

/**
 * Main migration function
 */
async function runMigration() {
    log.divider();
    log.info('ChargeBee to UniBee Migration');
    log.info(`Mode: ${isDryRun ? 'DRY RUN' : 'LIVE MIGRATION'}`);
    log.divider();
    
    // Validate configuration
    if (!UNIBEE_API_KEY) {
        log.error('UNIBEE_API_KEY is not configured');
        process.exit(1);
    }
    
    if (!process.env.CHARGEBEE_API_KEY) {
        log.error('CHARGEBEE_API_KEY is not configured');
        process.exit(1);
    }
   
    // Validate plan mapping
    const unmappedPlans = Object.entries(PLAN_MAPPING)
        .filter(([cb, ub]) => !ub)
        .map(([cb]) => cb);
    
    if (unmappedPlans.length > 0) {
        log.warn(`Unmapped plans: ${unmappedPlans.join(', ')}`);
        log.warn('Subscriptions with unmapped plans will be skipped');
    }
    
    try {
        // Connect to MongoDB for local database updates (skip in dry run)
        if (!isDryRun) {
            await connectToMongoDB();
        } else {
            log.info('[DRY RUN] Skipping MongoDB connection and database updates');
        }
        
        // Activate all UniBee plans first (required for subscription import)
        if (!isDryRun) {
            await activateUniBePlans();
        }
        
        // Fetch all customers
        const customers = await fetchChargeBeeCustomers();
        stats.customers.total = customers.length;
        
        // Process customers in batches
        for (let i = 0; i < customers.length; i += BATCH_SIZE) {
            const batch = customers.slice(i, i + BATCH_SIZE);
            log.info(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(customers.length / BATCH_SIZE)}`);
            
            for (const customer of batch) {
                await migrateCustomer(customer);
            }
            
            // Rate limiting
            if (i + BATCH_SIZE < customers.length) {
                await sleep(DELAY_BETWEEN_BATCHES);
            }
        }
        
        // Disconnect from MongoDB
        await disconnectFromMongoDB();
        
        // Generate report
        const reportPath = generateReport();
        
        log.divider();
        log.success('Migration completed!');
        log.info('Statistics:');
        log.info(`  Customers: ${stats.customers.migrated}/${stats.customers.total} migrated, ${stats.customers.failed} failed`);
        log.info(`  Subscriptions: ${stats.subscriptions.migrated}/${stats.subscriptions.total} migrated, ${stats.subscriptions.failed} failed, ${stats.subscriptions.skipped} skipped`);
        log.info(`  Addons: ${stats.addons.migrated}/${stats.addons.total} migrated, ${stats.addons.failed} failed`);
        log.info(`  Stripe Payment Info: ${stats.subscriptions.withStripePayment} with payment, ${stats.subscriptions.withoutStripePayment} without`);
        log.info(`  Invoices: ${stats.invoices.migrated}/${stats.invoices.total} migrated, ${stats.invoices.failed} failed`);
        log.info(`  Database: ${stats.database.subscriptionsUpdated} subscriptions updated, ${stats.database.usersUpdated} users updated, ${stats.database.failed} failed`);
        log.info(`  Errors: ${stats.errors.length}`);
        log.info(`Report saved to: ${reportPath}`);
        log.divider();
        
        if (stats.errors.length > 0) {
            log.warn('Errors encountered:');
            stats.errors.slice(0, 10).forEach(err => {
                log.error(`  ${err.type} ${err.id}: ${err.error}`);
            });
            if (stats.errors.length > 10) {
                log.warn(`  ... and ${stats.errors.length - 10} more errors (see report)`);
            }
        }
        
    } catch (err) {
        log.error(`Migration failed: ${err.message}`);
        console.error(err);
        // Ensure MongoDB is disconnected on error
        await disconnectFromMongoDB();
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    runMigration().catch(err => {
        log.error(`Unhandled error: ${err.message}`);
        process.exit(1);
    });
}

module.exports = {
    runMigration,
    migrateCustomer,
    fetchChargeBeeCustomers,
    fetchChargeBeeSubscriptions,
    fetchChargeBeeInvoices,
    createUniBeeUser,
    importSubscriptionToUniBee,
    importInvoiceToUniBee
};
