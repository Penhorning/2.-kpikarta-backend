'use strict';

/**
 * Retry Failed Subscriptions
 * 
 * This script retries migration for specific failed subscriptions
 * from the migration report.
 * 
 * Usage:
 *   node src/helper/migration/retry-failed-subscriptions.js [--verbose]
 */

require('dotenv').config();

const axios = require('axios');
const chargebee = require('chargebee');
const { MongoClient } = require('mongodb');

// Failed subscription IDs from migration report
const FAILED_SUBSCRIPTIONS = {
    // Timeout errors (should work on retry)
    timeouts: [
        'AzZtQGV7Sj8Yl37my',
        'Azz68xV78JSc11GUb',
        '16CPv8V4mnACy19FD',
        'AzZZYnV4eve2L8unE',
        '169yCaUzyGUeb8KV7'
    ],
    // 400 errors (users didn't exist - now fixed)
    badRequest: [
        '16BStnV7SKu9R2ncz',
        'AzypGoV7SIyTr2lUv',
        'Azq7GAV6UwBN2qfv',
        'AzZZ93V6TcCjl447',
        '16CGkcV4FvHSd46RI',
        'AzZcZCUgaKXJR5Osw',
        '169kDwTiUh7LS3aal'
    ],
    // Failed addon additions
    addonFailures: [
        'sub20260106GAstli3HUii5H6I',
        'sub20260105GcMHXpYdlHevmxK'
    ]
};

// MongoDB configuration
const MONGODB_HOST = process.env.MONGODB_HOST || '127.0.0.1';
const MONGODB_PORT = process.env.MONGODB_PORT || 27018;
const MONGODB_DB = process.env.DB || 'kpikarta';
const MONGODB_URL = process.env.MONGODB_URL || `mongodb://${MONGODB_HOST}:${MONGODB_PORT}/${MONGODB_DB}`;

// Configure ChargeBee
chargebee.configure({
    site: process.env.CHARGEBEE_SITE_NAME || 'kpikarta',
    api_key: process.env.CHARGEBEE_API_KEY
});

// UniBee configuration
const UNIBEE_API_URL = process.env.UNIBEE_API_URL || 'https://api.unibee.dev';
const UNIBEE_API_KEY = process.env.UNIBEE_API_KEY;

const unibeeApi = axios.create({
    baseURL: UNIBEE_API_URL,
    headers: {
        'Authorization': `Bearer ${UNIBEE_API_KEY}`,
        'Content-Type': 'application/json'
    },
    timeout: 120000 // 2 minute timeout for retries
});

// Plan mapping
const PLAN_MAPPING = {
    'cb-creator-plan-Monthly': process.env.UNIBEE_CREATOR_MONTHLY_PLAN_ID || '425',
    'cb-creator-plan-Yearly': process.env.UNIBEE_CREATOR_YEARLY_PLAN_ID || '424',
    'Creator-Test-Free-USD-Monthly': process.env.UNIBEE_SPECTATOR_PLAN_ID || '419',
    'Creator-Test-Free-USD-Yearly': process.env.UNIBEE_SPECTATOR_PLAN_ID || '419',
    'KPI-Karta-Creator---AppSumo-USD-Yearly': '452',
    'KPI-Karta-Creator---DealMirror-USD-Yearly': '453',
    'cb-creator-addon-plan-Monthly': '428',
    'cb-creator-addon-plan-Yearly': '431',
    'cb-champion-addon-plan-Monthly': '432',
    'cb-champion-addon-plan-Yearly': '430',
};

// CLI arguments
const args = process.argv.slice(2);
const isVerbose = args.includes('--verbose');

// Logger
const log = {
    info: (msg) => console.log(`[INFO] ${msg}`),
    success: (msg) => console.log(`[SUCCESS] ✅ ${msg}`),
    error: (msg) => console.error(`[ERROR] ❌ ${msg}`),
    warn: (msg) => console.warn(`[WARN] ⚠️ ${msg}`),
    verbose: (msg) => isVerbose && console.log(`[VERBOSE] ${msg}`),
    divider: () => console.log('─'.repeat(60))
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// MongoDB connection
let mongoClient = null;
let db = null;

async function connectToMongoDB() {
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

async function disconnectFromMongoDB() {
    if (mongoClient) {
        await mongoClient.close();
        log.info('Disconnected from MongoDB');
    }
}

/**
 * Find exact user by email in UniBee
 */
async function findUniBeeUser(email) {
    try {
        // Use searchKey parameter - 'email' param doesn't filter properly
        const res = await unibeeApi.get('/merchant/user/search', { 
            params: { searchKey: email } 
        });
        const users = res.data?.data?.userAccounts || [];
        return users.find(u => u.email && u.email.toLowerCase() === email.toLowerCase()) || null;
    } catch (err) {
        log.verbose(`Search failed for ${email}: ${err.message}`);
        return null;
    }
}

/**
 * Create UniBee user
 */
async function createUniBeeUser(customer) {
    const userData = {
        email: customer.email,
        externalUserId: customer.id,
        firstName: customer.first_name || '',
        lastName: customer.last_name || '',
        gatewayId: 82
    };
    
    const response = await unibeeApi.post('/merchant/user/new', userData);
    return response.data?.data?.user || response.data?.user;
}

/**
 * Format date for UniBee
 */
function formatDate(timestamp) {
    if (!timestamp) return null;
    const date = new Date(timestamp * 1000);
    return date.toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * Get ChargeBee plan ID
 */
function getChargeBePlanId(subscription) {
    if (subscription.subscription_items && subscription.subscription_items.length > 0) {
        const planItem = subscription.subscription_items.find(item => item.item_type === 'plan');
        if (planItem) return planItem.item_price_id;
        return subscription.subscription_items[0].item_price_id;
    }
    return subscription.plan_id;
}

/**
 * Import subscription to UniBee
 */
async function importSubscription(subscription, unibeeUserId, customer) {
    const chargebeePlanId = getChargeBePlanId(subscription);
    const unibeePlanId = PLAN_MAPPING[chargebeePlanId];
    
    if (!unibeePlanId) {
        log.error(`No plan mapping for: ${chargebeePlanId}`);
        return null;
    }
    
    const isInTrial = subscription.status === 'in_trial';
    const periodStart = subscription.current_term_start || subscription.trial_start || subscription.started_at;
    const periodEnd = subscription.current_term_end || subscription.trial_end;
    
    const subscriptionData = {
        externalSubscriptionId: subscription.id,
        externalUserId: customer.id,
        planId: parseInt(unibeePlanId),
        email: customer.email,
        gateway: 'stripe',
        currentPeriodStart: formatDate(periodStart),
        currentPeriodEnd: formatDate(periodEnd),
        billingCycleAnchor: formatDate(periodStart),
        createTime: formatDate(subscription.created_at),
        firstPaidTime: isInTrial ? null : formatDate(subscription.activated_at || subscription.created_at),
        quantity: subscription.plan_quantity || 1,
        addonData: '[]',
        metadata: {
            chargebeeSubscriptionId: subscription.id,
            chargebeeCustomerId: customer.id,
            originalStatus: subscription.status,
            migratedAt: new Date().toISOString(),
            retryMigration: true
        },
        features: JSON.stringify({
            chargebeeSubscriptionId: subscription.id,
            originalStatus: subscription.status
        })
    };
    
    const response = await unibeeApi.post('/merchant/subscription/active_subscription_import', subscriptionData);
    
    const responseData = response.data?.data || response.data;
    const outerSubscription = responseData?.subscription || responseData;
    const innerSubscription = outerSubscription?.subscription || outerSubscription;
    
    const subId = innerSubscription?.subscriptionId || 
                  outerSubscription?.subscriptionId ||
                  responseData?.subscriptionId;
    
    if (subId && innerSubscription && !innerSubscription.subscriptionId) {
        innerSubscription.subscriptionId = subId;
    }
    
    return { subscription: innerSubscription, unibeePlanId };
}

/**
 * Update local database
 */
async function updateLocalDatabase(email, unibeeUserId, unibeeSubscription, unibeePlanId) {
    if (!db) return { success: false, error: 'No database connection' };
    
    try {
        const user = await db.collection('user').findOne({ email: email.toLowerCase() });
        if (!user) {
            return { success: false, error: 'User not found in local DB' };
        }
        
        // Update user
        await db.collection('user').updateOne(
            { _id: user._id },
            { 
                $set: { 
                    unibeeUserId: unibeeUserId,
                    billingProvider: 'unibee',
                    updatedAt: new Date()
                }
            }
        );
        
        // Update subscription
        const subscriptionId = unibeeSubscription.subscriptionId || unibeeSubscription.id;
        await db.collection('subscription').updateOne(
            { userId: user._id },
            {
                $set: {
                    unibeeSubscriptionId: subscriptionId,
                    unibeePlanId: parseInt(unibeePlanId),
                    billingProvider: 'unibee',
                    updatedAt: new Date()
                }
            }
        );
        
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * Retry a single subscription
 */
async function retrySubscription(subscriptionId) {
    log.info(`🔄 Retrying subscription: ${subscriptionId}`);
    
    try {
        // 1. Get subscription from ChargeBee
        const result = await chargebee.subscription.retrieve(subscriptionId).request();
        const subscription = result.subscription;
        const customer = result.customer;
        
        log.verbose(`  Customer: ${customer.email}, Status: ${subscription.status}`);
        
        // Skip cancelled/paused
        if (['cancelled', 'paused', 'non_renewing'].includes(subscription.status)) {
            log.warn(`  Skipping ${subscription.status} subscription`);
            return { status: 'skipped', reason: subscription.status };
        }
        
        // 2. Check if user exists in UniBee
        let unibeeUser = await findUniBeeUser(customer.email);
        
        if (unibeeUser) {
            log.info(`  👤 User exists: ${customer.email} (ID: ${unibeeUser.id})`);
        } else {
            // Create user
            unibeeUser = await createUniBeeUser(customer);
            log.info(`  ✨ Created user: ${customer.email} (ID: ${unibeeUser.id})`);
        }
        
        // 3. Check if subscription already exists
        const subsRes = await unibeeApi.get('/merchant/subscription/list', { 
            params: { userId: unibeeUser.id } 
        });
        const existingSubs = subsRes.data?.data?.subscriptions || [];
        
        for (const existingSub of existingSubs) {
            if (existingSub.externalSubscriptionId === subscriptionId) {
                log.info(`  📋 Subscription already exists: ${existingSub.subscriptionId}`);
                
                // Still update local DB
                await updateLocalDatabase(customer.email, unibeeUser.id, existingSub, 
                    PLAN_MAPPING[getChargeBePlanId(subscription)]);
                
                return { status: 'exists', unibeeSubId: existingSub.subscriptionId };
            }
        }
        
        // 4. Import subscription
        const importResult = await importSubscription(subscription, unibeeUser.id, customer);
        
        if (importResult && importResult.subscription) {
            const subId = importResult.subscription.subscriptionId;
            log.success(`  📦 Imported: ${subscriptionId} → UniBee #${subId}`);
            
            // 5. Update local database
            const dbResult = await updateLocalDatabase(
                customer.email,
                unibeeUser.id,
                importResult.subscription,
                importResult.unibeePlanId
            );
            
            if (dbResult.success) {
                log.verbose(`  ✅ Database updated`);
            } else {
                log.warn(`  ⚠️ DB update failed: ${dbResult.error}`);
            }
            
            return { status: 'success', unibeeSubId: subId };
        } else {
            return { status: 'failed', error: 'Import returned no subscription' };
        }
        
    } catch (err) {
        log.error(`  Failed: ${err.message}`);
        if (err.response?.data) {
            log.verbose(`  Error details: ${JSON.stringify(err.response.data)}`);
        }
        return { status: 'failed', error: err.message };
    }
}

/**
 * Main retry function
 */
async function main() {
    log.divider();
    log.info('🔄 Retry Failed Subscriptions Script');
    log.divider();
    
    // Connect to MongoDB
    await connectToMongoDB();
    
    const allFailed = [
        ...FAILED_SUBSCRIPTIONS.timeouts,
        ...FAILED_SUBSCRIPTIONS.badRequest
    ];
    
    log.info(`Total subscriptions to retry: ${allFailed.length}`);
    log.divider();
    
    const results = {
        success: 0,
        exists: 0,
        skipped: 0,
        failed: 0,
        errors: []
    };
    
    for (const subId of allFailed) {
        const result = await retrySubscription(subId);
        
        switch (result.status) {
            case 'success':
                results.success++;
                break;
            case 'exists':
                results.exists++;
                break;
            case 'skipped':
                results.skipped++;
                break;
            case 'failed':
                results.failed++;
                results.errors.push({ id: subId, error: result.error });
                break;
        }
        
        // Small delay between retries
        await sleep(500);
    }
    
    log.divider();
    log.info('📊 Retry Results:');
    log.info(`  ✅ Success: ${results.success}`);
    log.info(`  📋 Already exists: ${results.exists}`);
    log.info(`  ⏭️ Skipped: ${results.skipped}`);
    log.info(`  ❌ Failed: ${results.failed}`);
    
    if (results.errors.length > 0) {
        log.divider();
        log.warn('Failed subscriptions:');
        for (const err of results.errors) {
            log.error(`  ${err.id}: ${err.error}`);
        }
    }
    
    log.divider();
    
    // Disconnect from MongoDB
    await disconnectFromMongoDB();
}

// Run
main().catch(err => {
    log.error(`Script failed: ${err.message}`);
    process.exit(1);
});
