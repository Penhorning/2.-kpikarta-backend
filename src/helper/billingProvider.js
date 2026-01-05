'use strict';

/**
 * Billing Provider Abstraction Layer
 * 
 * This module provides a unified interface for billing operations,
 * allowing seamless switching between ChargeBee and UniBee.
 * 
 * Set BILLING_PROVIDER environment variable to 'unibee' or 'chargebee'
 */

const BILLING_PROVIDER = process.env.BILLING_PROVIDER || 'chargebee';

// Import the appropriate billing provider
let billingProvider;

if (BILLING_PROVIDER === 'unibee') {
    billingProvider = require('./unibee');
    console.log('🚀 Using UniBee as billing provider');
} else {
    billingProvider = require('./chargebee');
    console.log('💳 Using ChargeBee as billing provider');
}

/**
 * Get the plan IDs based on billing provider
 */
const getPlanIds = () => {
    if (BILLING_PROVIDER === 'unibee') {
        return {
            CREATOR_MONTHLY_PLAN_ID: process.env.UNIBEE_CREATOR_MONTHLY_PLAN_ID,
            CREATOR_YEARLY_PLAN_ID: process.env.UNIBEE_CREATOR_YEARLY_PLAN_ID,
            CREATOR_FREE_PLAN_ID: process.env.UNIBEE_CREATOR_FREE_PLAN_ID,
            APPSUMO_PLAN_ID: process.env.UNIBEE_APPSUMO_PLAN_ID,
            DEALMIRROR_PLAN_ID: process.env.UNIBEE_DEALMIRROR_PLAN_ID,
            CREATOR_MONTHLY_ADDON_PLAN_ID: process.env.UNIBEE_CREATOR_MONTHLY_ADDON_PLAN_ID,
            CREATOR_YEARLY_ADDON_PLAN_ID: process.env.UNIBEE_CREATOR_YEARLY_ADDON_PLAN_ID,
            CHAMPION_MONTHLY_ADDON_PLAN_ID: process.env.UNIBEE_CHAMPION_MONTHLY_ADDON_PLAN_ID,
            CHAMPION_YEARLY_ADDON_PLAN_ID: process.env.UNIBEE_CHAMPION_YEARLY_ADDON_PLAN_ID
        };
    }
    // ChargeBee uses original env vars
    return {
        CREATOR_MONTHLY_PLAN_ID: process.env.CREATOR_MONTHLY_PLAN_ID,
        CREATOR_YEARLY_PLAN_ID: process.env.CREATOR_YEARLY_PLAN_ID,
        CREATOR_FREE_PLAN_ID: process.env.CREATOR_FREE_PLAN_ID,
        APPSUMO_PLAN_ID: 'KPI-Karta-Creator---AppSumo-USD-Yearly',
        DEALMIRROR_PLAN_ID: 'KPI-Karta-Creator---DealMirror-USD-Yearly',
        CREATOR_MONTHLY_ADDON_PLAN_ID: process.env.CREATOR_MONTHLY_ADDON_PLAN_ID,
        CREATOR_YEARLY_ADDON_PLAN_ID: process.env.CREATOR_YEARLY_ADDON_PLAN_ID,
        CHAMPION_MONTHLY_ADDON_PLAN_ID: process.env.CHAMPION_MONTHLY_ADDON_PLAN_ID,
        CHAMPION_YEARLY_ADDON_PLAN_ID: process.env.CHAMPION_YEARLY_ADDON_PLAN_ID
    };
};

// Export all billing provider functions
module.exports = {
    // Provider info
    BILLING_PROVIDER,
    isUniBee: BILLING_PROVIDER === 'unibee',
    isChargeBee: BILLING_PROVIDER === 'chargebee',
    getPlanIds,
    
    // Plan Management
    get_plans: billingProvider.get_plans,
    get_plan: billingProvider.get_plan || billingProvider.get_creator_plan,
    get_champion_plan: billingProvider.get_champion_plan,
    get_creator_plan: billingProvider.get_creator_plan || billingProvider.get_plan,
    get_plans_free: billingProvider.get_plans_free,
    
    // Customer Management
    create_customer: billingProvider.create_customer,
    get_user_by_email: billingProvider.get_user_by_email,
    
    // Subscription Management
    create_subscription: billingProvider.create_subscription,
    get_subscription: billingProvider.get_subscription,
    get_user_subscription: billingProvider.get_user_subscription,
    update_subscription: billingProvider.update_subscription,
    cancel_subscription: billingProvider.cancel_subscription,
    pause_subscription: billingProvider.pause_subscription,
    resume_subscription: billingProvider.resume_subscription,
    delete_subscription: billingProvider.delete_subscription,
    
    // Portal Session
    create_portal_session: billingProvider.create_portal_session,
    
    // Transactions/Invoices
    get_transactions: billingProvider.get_transactions,
    get_invoice: billingProvider.get_invoice,
    
    // Coupon/Discount
    verify_coupon: billingProvider.verify_coupon,
    apply_discount: billingProvider.apply_discount,
    
    // Webhook
    verifyWebhookSignature: billingProvider.verifyWebhookSignature,
    
    // Migration helpers (UniBee only)
    import_active_subscription: billingProvider.import_active_subscription,
    import_subscription_history: billingProvider.import_subscription_history,
    
    // Status mapping utilities
    mapUniBeeStatus: billingProvider.mapUniBeeStatus,
    mapToUniBeeStatus: billingProvider.mapToUniBeeStatus
};
