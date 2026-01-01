'use strict';

const axios = require('axios');

// UniBee API Configuration
const UNIBEE_API_URL = process.env.UNIBEE_API_URL || 'https://api.unibee.dev';
const REQUEST_HEADER = {
    "Content-Type": "application/json",
    "Authorization": process.env.UNIBEE_API_KEY  // UniBee uses API key directly, not Bearer token
};

/**
 * Map external plan ID (string) to UniBee numeric plan ID
 * This handles both numeric IDs and external string IDs (like "creator-monthly-v3")
 */
const mapPlanIdToUniBee = (planId) => {
    // If already a number, return as-is
    if (!isNaN(planId)) {
        return parseInt(planId);
    }
    
    // Map external plan IDs to UniBee numeric IDs
    const planMapping = {
        // Main plans
        'creator-monthly-v3': parseInt(process.env.UNIBEE_CREATOR_MONTHLY_PLAN_ID) || 425,
        'cb-creator-plan-Monthly': parseInt(process.env.UNIBEE_CREATOR_MONTHLY_PLAN_ID) || 425,
        'creator-yearly-v2': parseInt(process.env.UNIBEE_CREATOR_YEARLY_PLAN_ID) || 424,
        'cb-creator-plan-Yearly': parseInt(process.env.UNIBEE_CREATOR_YEARLY_PLAN_ID) || 424,
        // Free plan
        'Creator-Test-Free-USD-Monthly': parseInt(process.env.UNIBEE_CREATOR_FREE_PLAN_ID) || 419,
        // Addon plans
        'creator-monthly-addon': parseInt(process.env.UNIBEE_CREATOR_MONTHLY_ADDON_PLAN_ID) || 428,
        'creator-yearly-addon': parseInt(process.env.UNIBEE_CREATOR_YEARLY_ADDON_PLAN_ID) || 431,
        'champion-monthly-addon': parseInt(process.env.UNIBEE_CHAMPION_MONTHLY_ADDON_PLAN_ID) || 432,
        'champion-yearly-addon': parseInt(process.env.UNIBEE_CHAMPION_YEARLY_ADDON_PLAN_ID) || 430
    };
    
    const mappedId = planMapping[planId];
    if (mappedId) {
        return mappedId;
    }
    
    return parseInt(planId) || 0;
};

/**
 * Helper function for API requests with error handling and retry logic
 */
const apiRequest = async (method, endpoint, data = null, retries = 2) => {
    const makeRequest = async (attemptNumber) => {
        try {
            const config = {
                method,
                url: `${UNIBEE_API_URL}${endpoint}`,
                headers: REQUEST_HEADER,
                timeout: 60000
            };
            
            if (data) {
                if (method.toUpperCase() === 'GET') {
                    config.params = data;
                } else {
                    config.data = data;
                }
            }
            
            const response = await axios(config);
            
            return {
                status: response.status,
                data: response.data.data || response.data,
                code: response.data.code,
                success: response.data.code === 0
            };
        } catch (err) {
            // Retry on timeout or network errors
            const isRetryable = err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || 
                               err.code === 'ECONNRESET' || err.message.includes('timeout');
            
            if (isRetryable && attemptNumber < retries + 1) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                return makeRequest(attemptNumber + 1);
            }
            
            console.error(`[UniBee API ERROR] ${method} ${endpoint}:`, err.message);
            return {
                status: err.response?.status || 500,
                data: err.response?.data || { message: err.message },
                code: err.response?.data?.code,
                success: false,
                error: err
            };
        }
    };
    
    return makeRequest(1);
};

// ==================== PLAN MANAGEMENT ====================

/**
 * Get main subscription plans (Creator Monthly and Creator Yearly)
 * Maps to ChargeBee's get_plans() - which only returns these 2 plans
 */
exports.get_plans = async () => {
    try {
        // Get specific plan IDs - matching ChargeBee behavior which only returns 2 main plans
        const planIds = [
            process.env.UNIBEE_CREATOR_MONTHLY_PLAN_ID,
            process.env.UNIBEE_CREATOR_YEARLY_PLAN_ID
        ].filter(Boolean).map(id => parseInt(id));
        
        if (planIds.length === 0) {
            console.error('UNIBEE_CREATOR_MONTHLY_PLAN_ID and UNIBEE_CREATOR_YEARLY_PLAN_ID not configured');
            return { status: 500, data: { message: 'Plan IDs not configured' } };
        }
        
        // Fetch each plan individually and combine
        const plans = [];
        for (const planId of planIds) {
            const response = await apiRequest('GET', '/merchant/plan/detail', {
                planId: planId
            });
            // UniBee response has nested structure: data.plan.plan
            if (response.success && response.data.plan?.plan) {
                plans.push(response.data.plan.plan);
            }
        }
        
        // Transform to match exact ChargeBee response structure
        return {
            status: 200,
            data: {
                list: plans.map(plan => ({
                    item_price: {
                        id: plan.externalPlanId || String(plan.id),
                        name: plan.planName,
                        item_family_id: 'kpi-karta',
                        item_id: 'cb-creator-plan',
                        description: plan.description || `${plan.planName} license`,
                        status: plan.status === 2 ? 'active' : 'inactive',
                        external_name: 'Creator',
                        pricing_model: 'per_unit',
                        price: plan.amount,
                        period: plan.intervalCount || 1,
                        currency_code: plan.currency || 'USD',
                        period_unit: plan.intervalUnit,
                        trial_period: plan.trialDurationTime ? Math.floor(plan.trialDurationTime / 86400) : 14,
                        trial_period_unit: 'day',
                        free_quantity: 0,
                        channel: 'web',
                        resource_version: plan.createTime * 1000,
                        updated_at: Math.floor(Date.now() / 1000),
                        created_at: plan.createTime,
                        is_taxable: true,
                        accounting_detail: {
                            sku: plan.intervalUnit === 'year' ? 'CRE-Y' : 'CRE-M',
                            accounting_code: `Creator - ${plan.intervalUnit === 'year' ? 'Yearly' : 'Monthly'}`
                        },
                        metadata: plan.metadata || {},
                        item_type: 'plan',
                        show_description_in_invoices: true,
                        show_description_in_quotes: true,
                        deleted: false,
                        object: 'item_price',
                        _unibee: plan
                    }
                }))
            }
        };
    } catch (err) {
        console.error('Error getting plans:', err);
        return { status: 500, error: err };
    }
};

/**
 * Get specific plan by ID
 * Maps to ChargeBee's get_creator_plan() and get_champion_plan()
*/
exports.get_plan = async (planId) => {
    try {
        const response = await apiRequest('POST', '/merchant/plan/detail', {
            planId: parseInt(planId)
        });
        
        if (response.success) {
            return {
                status: 200,
                data: {
                    list: [{ item_price: response.data.plan }]
                }
            };
        }
        return { status: response.status, data: response.data };
    } catch (err) {
        console.error('Error getting plan:', err);
        return { status: 500, error: err };
    }
};

/**
 * Get champion/addon plan details
 * Alias for get_plan to maintain ChargeBee compatibility
 */
exports.get_champion_plan = async (planId) => {
    return exports.get_plan(planId);
};

/**
 * Get creator plan details
 * Alias for get_plan to maintain ChargeBee compatibility
 */
exports.get_creator_plan = async (planId) => {
    return exports.get_plan(planId);
};

/**
 * Get free plan details
 */
exports.get_plans_free = async () => {
    try {
        const freePlanId = process.env.CREATOR_FREE_PLAN_ID;
        if (!freePlanId) {
            return { status: 404, data: { message: 'Free plan ID not configured' } };
        }
        return exports.get_plan(freePlanId);
    } catch (err) {
        console.error('Error getting free plan:', err);
        return { status: 500, error: err };
    }
};

// ==================== USER/CUSTOMER MANAGEMENT ====================

/**
 * Create a new user/customer in UniBee
 * Maps to ChargeBee's create_customer()
 * Handles duplicate email by fetching existing user
 */
exports.create_customer = async (params) => {
    const { first_name, email, company } = params;
    try {
        // UniBee uses /merchant/user/new endpoint
        const response = await apiRequest('POST', '/merchant/user/new', {
            email: email,
            firstName: first_name,
            companyName: company,
            externalUserId: email // Use email as external reference
        });
        
        if (response.success) {
            return {
                status: 200,
                data: {
                    customer: {
                        id: response.data.user?.id,
                        email: response.data.user?.email,
                        firstName: response.data.user?.firstName,
                        companyName: response.data.user?.companyName
                    }
                }
            };
        }
        
        // Handle "same email exist" error (code 51) - fetch existing user instead
        if (response.code === 51) {
            const existingUser = await exports.get_user_by_email(email);
            if (existingUser.status === 200) {
                return {
                    status: 200,
                    data: {
                        customer: {
                            id: existingUser.data.user?.id || existingUser.data.user?.userId,
                            email: existingUser.data.user?.email,
                            firstName: existingUser.data.user?.firstName,
                            companyName: existingUser.data.user?.companyName
                        }
                    }
                };
            }
        }
        
        return { status: response.status, data: response.data };
    } catch (err) {
        console.error('Error creating customer:', err);
        return { status: 500, error: err };
    }
};

/**
 * Get user by email
 */
exports.get_user_by_email = async (email) => {
    try {
        const response = await apiRequest('POST', '/merchant/user/list', {
            email: email,
            page: 0,  // UniBee uses 0-based pagination
            count: 1
        });
        
        if (response.success && response.data.userAccounts?.length > 0) {
            return {
                status: 200,
                data: { user: response.data.userAccounts[0] }
            };
        }
        return { status: 404, data: { message: 'User not found' } };
    } catch (err) {
        console.error('Error getting user:', err);
        return { status: 500, error: err };
    }
};

// ==================== SUBSCRIPTION MANAGEMENT ====================

/**
 * Create a new subscription
 * Maps to ChargeBee's create_subscription()
 */
exports.create_subscription = async (params) => {
    const { customer_id, plan_id, user_email, quantity = 1, addons = [], coupon_code } = params;
    try {
        // Map plan_id to UniBee numeric ID (handles both string and numeric IDs)
        const unibeePlanId = mapPlanIdToUniBee(plan_id);
        
        // Build subscription data
        const subscriptionData = {
            planId: unibeePlanId,
            quantity: quantity,
            gatewayId: parseInt(process.env.UNIBEE_GATEWAY_ID) || 82, // Stripe gateway
            returnUrl: process.env.WEB_URL || 'http://localhost:3000',
            addonParams: [] // Explicitly set empty array to avoid "null" string
        };

        // If we have user email, use that
        if (user_email) {
            subscriptionData.email = user_email;
        } else if (customer_id) {
            subscriptionData.userId = parseInt(customer_id);
        }

        // Add addon plans if provided
        if (addons.length > 0) {
            subscriptionData.addonParams = addons.map(addon => ({
                addonPlanId: mapPlanIdToUniBee(addon.plan_id),
                quantity: addon.quantity || 1
            }));
        }

        // Add discount/coupon code if provided
        if (coupon_code) {
            subscriptionData.discountCode = coupon_code;
        }

        const response = await apiRequest('POST', '/merchant/subscription/create_submit', subscriptionData);
        
        if (response.success) {
            const subscription = response.data.subscription || response.data;
            
            // Fetch plan details to get actual pricing (subscription.amount may be 0 during trial)
            const planResponse = await apiRequest('GET', '/merchant/plan/detail', {
                planId: subscription.planId
            });
            
            let planAmount = subscription.amount;
            let trialDurationDays = 14;
            if (planResponse.success && planResponse.data.plan?.plan) {
                planAmount = planResponse.data.plan.plan.amount || planAmount;
                if (planResponse.data.plan.plan.trialDurationTime) {
                    trialDurationDays = Math.floor(planResponse.data.plan.plan.trialDurationTime / 86400);
                }
            }
            
            // Calculate correct trial dates
            // UniBee's trialEnd can be incorrect, so calculate from currentPeriodStart + trial duration
            const trialStartTimestamp = subscription.currentPeriodStart;
            const trialEndTimestamp = subscription.currentPeriodStart + (trialDurationDays * 86400);
            
            // Determine the correct status for the frontend
            // UniBee status 1 = pending (needs payment setup for trial)
            // If plan has trial and subscription just created, treat as in_trial
            let mappedStatus = mapUniBeeStatus(subscription.status);
            if (subscription.status === 1 && trialEndTimestamp > subscription.currentPeriodStart) {
                // Subscription is pending but has trial - treat as in_trial
                mappedStatus = 'in_trial';
            }
            
            return {
                status: 200,
                data: {
                    subscription: {
                        id: subscription.subscriptionId,
                        subscriptionId: subscription.subscriptionId,
                        status: mappedStatus, // Use the mapped status
                        trial_start: trialStartTimestamp,
                        trial_end: trialEndTimestamp,
                        current_term_start: subscription.currentPeriodStart,
                        current_term_end: subscription.currentPeriodEnd,
                        next_billing_at: subscription.currentPeriodEnd,
                        billing_period_unit: subscription.plan?.intervalUnit || 'month',
                        subscription_items: [{
                            item_price_id: subscription.planId,
                            quantity: subscription.quantity,
                            amount: planAmount, // Use plan amount from plan details (not subscription amount which is 0 during trial)
                            unit_price: planAmount,
                            unitAmount: planAmount,
                            planId: subscription.planId
                        }],
                        // Store amount for easy access (use plan amount, not subscription amount which is 0 during trial)
                        amount: planAmount,
                        // Store original UniBee data
                        _unibee: subscription
                    },
                    // Include payment link if subscription requires payment setup
                    link: response.data.link,
                    paid: response.data.paid
                }
            };
        }
        return { status: response.status, data: response.data };
    } catch (err) {
        console.error('Error creating subscription:', err);
        return { status: 500, error: err };
    }
};

/**
 * Get subscription details
 */
exports.get_subscription = async (subscriptionId) => {
    try {
        const response = await apiRequest('POST', '/merchant/subscription/detail', {
            subscriptionId: subscriptionId
        });
        
        if (response.success) {
            return {
                status: 200,
                data: response.data
            };
        }
        return { status: response.status, data: response.data };
    } catch (err) {
        console.error('Error getting subscription:', err.message);
        return { status: 500, error: err, message: err.message };
    }
};

/**
 * Get user's subscription details
 */
exports.get_user_subscription = async (email) => {
    try {
        const response = await apiRequest('POST', '/merchant/subscription/user_subscription_detail', {
            email: email
        });
        
        if (response.success) {
            return {
                status: 200,
                data: response.data
            };
        }
        return { status: response.status, data: response.data };
    } catch (err) {
        console.error('Error getting user subscription:', err);
        return { status: 500, error: err };
    }
};

/**
 * Update subscription (add/remove addons, change quantity)
 * Maps to ChargeBee's update_subscription()
 */
exports.update_subscription = async (params) => {
    const { subscription_id, addon_plan_id, license_count, replaceItems } = params;
    
    try {
        // Get current subscription details first
        const currentSub = await exports.get_subscription(subscription_id);
        
        if (currentSub.status !== 200) {
            return currentSub;
        }

        // Get subscription details
        const subscription = currentSub.data.subscription;
        const currentPlanId = subscription?.planId || currentSub.data.plan?.id;
        const subscriptionStatus = subscription?.status;
        
        // Check if subscription is in trial (status 1 = in_trial in UniBee)
        const isInTrial = subscriptionStatus === 1;

        // UniBee API requires newPlanId even when just updating addons
        // We use the same plan ID to keep the plan unchanged
        const subscriptionData = {
            subscriptionId: subscription_id,
            newPlanId: currentPlanId,  // Required by UniBee - use current plan to keep unchanged
            quantity: subscription?.quantity || 1,
            // For trial subscriptions, apply changes at next period (when billing starts)
            // effectImmediate: 1 = Immediate, 2 = Next Period
            effectImmediate: isInTrial ? 2 : 1
        };

        // Build addon parameters
        if (addon_plan_id && license_count > 0) {
            subscriptionData.addonParams = [{
                addonPlanId: parseInt(addon_plan_id),
                quantity: license_count
            }];
        } else if (license_count < 1 || replaceItems) {
            subscriptionData.addonParams = [];
        }

        // Use update preview first, then submit
        const previewResponse = await apiRequest('POST', '/merchant/subscription/update_preview', subscriptionData);
        
        if (!previewResponse.success) {
            return { status: previewResponse.status, data: previewResponse.data };
        }

        // Submit the update
        const submitData = {
            ...subscriptionData,
            confirmTotalAmount: previewResponse.data.totalAmount || previewResponse.data.invoice?.totalAmount || 0,
            confirmCurrency: previewResponse.data.currency || previewResponse.data.invoice?.currency || 'USD'
        };
        
        const response = await apiRequest('POST', '/merchant/subscription/update_submit', submitData);
        
        if (response.success) {
            // Handle response - could be immediate update or pending update
            const responseData = response.data;
            const subscriptionResult = responseData.subscription || responseData.subscriptionPendingUpdate || responseData;
            const isPending = !!responseData.subscriptionPendingUpdate;
            
            // For pending updates (trial subscriptions), the addon is scheduled
            // For immediate updates, the addon is applied
            const resultStatus = isPending ? 
                (isInTrial ? 'in_trial' : 'pending') : 
                mapUniBeeStatus(subscriptionResult.status);
            
            // Normalize addon structure to match ChargeBee format
            // ChargeBee uses: { item_price_id, quantity, amount, unit_price }
            // UniBee uses: { quantity, addonPlan: { id, amount, ... } }
            const rawAddons = subscriptionResult.addons || subscriptionResult.updateAddons || [];
            const normalizedSubscriptionItems = rawAddons.map(addon => ({
                item_price_id: String(addon.addonPlan?.id || addon.addonPlanId),
                addonPlanId: addon.addonPlan?.id || addon.addonPlanId,
                quantity: addon.quantity,
                amount: (addon.addonPlan?.amount || 0) * addon.quantity,
                unit_price: addon.addonPlan?.amount || 0,
                unitAmount: addon.addonPlan?.amount || 0,
                planName: addon.addonPlan?.planName,
                // Keep original structure for reference
                addonPlan: addon.addonPlan
            }));
            
            return {
                status: 200,
                data: {
                    subscription: {
                        id: subscriptionResult.subscriptionId || subscription_id,
                        status: resultStatus,
                        subscription_items: normalizedSubscriptionItems,
                        pending_update: isPending ? {
                            id: subscriptionResult.pendingUpdateId,
                            addons: normalizedSubscriptionItems,
                            effectTime: subscriptionResult.effectTime
                        } : null,
                        _unibee: responseData
                    }
                }
            };
        }
        return { status: response.status, data: response.data };
    } catch (err) {
        console.error('Error updating subscription:', err);
        return { status: 500, error: err };
    }
};

/**
 * Cancel subscription
 * Maps to ChargeBee's cancel_subscription()
 */
exports.cancel_subscription = async (params) => {
    const { subscription_id } = params;
    try {
        const response = await apiRequest('POST', '/merchant/subscription/cancel', {
            subscriptionId: subscription_id,
            cancelAtPeriodEnd: true // Cancel at end of billing period
        });
        
        if (response.success) {
            return {
                status: 200,
                data: {
                    subscription: {
                        id: subscription_id,
                        status: 'cancelled',
                        _unibee: response.data
                    }
                }
            };
        }
        return { status: response.status, data: response.data };
    } catch (err) {
        console.error('Error cancelling subscription:', err);
        return { status: 500, error: err };
    }
};

/**
 * Cancel subscription immediately
 */
exports.cancel_subscription_immediate = async (params) => {
    const { subscription_id } = params;
    try {
        const response = await apiRequest('POST', '/merchant/subscription/cancel', {
            subscriptionId: subscription_id,
            cancelAtPeriodEnd: false // Cancel immediately
        });
        
        if (response.success) {
            return {
                status: 200,
                data: {
                    subscription: {
                        id: subscription_id,
                        status: 'cancelled',
                        _unibee: response.data
                    }
                }
            };
        }
        return { status: response.status, data: response.data };
    } catch (err) {
        console.error('Error cancelling subscription immediately:', err);
        return { status: 500, error: err };
    }
};

/**
 * Pause subscription
 * Note: UniBee uses "suspend" terminology
 * Maps to ChargeBee's pause_subscription()
 */
exports.pause_subscription = async (params) => {
    const { subscription_id } = params;
    try {
        const response = await apiRequest('POST', '/merchant/subscription/suspend', {
            subscriptionId: subscription_id
        });
        
        if (response.success) {
            return {
                status: 200,
                data: {
                    subscription: {
                        id: subscription_id,
                        status: 'paused',
                        _unibee: response.data
                    }
                }
            };
        }
        return { status: response.status, data: response.data };
    } catch (err) {
        console.error('Error pausing subscription:', err);
        return { status: 500, error: err };
    }
};

/**
 * Resume/reactivate a paused/suspended subscription
 * Maps to ChargeBee's resume_subscription()
 */
exports.resume_subscription = async (params) => {
    const { subscription_id } = params;
    try {
        const response = await apiRequest('POST', '/merchant/subscription/resume', {
            subscriptionId: subscription_id
        });
        
        if (response.success) {
            return {
                status: 200,
                data: {
                    subscription: {
                        id: subscription_id,
                        status: 'active',
                        _unibee: response.data
                    }
                }
            };
        }
        return { status: response.status, data: response.data };
    } catch (err) {
        console.error('Error resuming subscription:', err);
        return { status: 500, error: err };
    }
};

/**
 * Delete/terminate subscription completely
 * Maps to ChargeBee's delete_subscription()
 */
exports.delete_subscription = async (params) => {
    const { subscription_id } = params;
    try {
        // In UniBee, we cancel immediately to simulate deletion
        const response = await apiRequest('POST', '/merchant/subscription/cancel', {
            subscriptionId: subscription_id,
            cancelAtPeriodEnd: false
        });
        
        if (response.success) {
            return {
                status: 200,
                data: {
                    subscription: {
                        id: subscription_id,
                        status: 'deleted',
                        _unibee: response.data
                    }
                }
            };
        }
        return { status: response.status, data: response.data };
    } catch (err) {
        console.error('Error deleting subscription:', err);
        return { status: 500, error: err };
    }
};

// ==================== PORTAL SESSION ====================

/**
 * Create customer portal session
 * Maps to ChargeBee's create_portal_session()
 */
exports.create_portal_session = async (params) => {
    const { customer_id, email } = params;
    try {
        // UniBee uses hosted pages for subscription management
        const requestData = {};
        
        if (email) {
            requestData.email = email;
        } else if (customer_id) {
            requestData.userId = parseInt(customer_id);
        }

        const response = await apiRequest('POST', '/merchant/session/user_sub_update_url', {
            ...requestData,
            returnUrl: `${process.env.WEB_URL}/subscription`,
            cancelUrl: `${process.env.WEB_URL}/subscription`
        });
        
        if (response.success) {
            return {
                status: 200,
                data: {
                    portal_session: {
                        access_url: response.data.url,
                        _unibee: response.data
                    }
                }
            };
        }
        return { status: response.status, data: response.data };
    } catch (err) {
        console.error('Error creating portal session:', err);
        return { status: 500, error: err };
    }
};

// ==================== TRANSACTIONS/INVOICES ====================

/**
 * Get transaction/invoice history
 * Maps to ChargeBee's get_transactions()
 */
exports.get_transactions = async (params) => {
    const { limit = 10, offset = 0, userId, email } = params;
    try {
        const requestData = {
            page: Math.floor(offset / limit) + 1,
            count: limit,
            sortField: 'createTime',
            sortType: 'desc'
        };

        if (userId) {
            requestData.userId = parseInt(userId);
        }
        if (email) {
            requestData.email = email;
        }

        const response = await apiRequest('POST', '/merchant/invoice/list', requestData);
        
        if (response.success) {
            return {
                status: 200,
                data: {
                    list: response.data.invoices || [],
                    next_offset: offset + limit,
                    _unibee: response.data
                }
            };
        }
        return { status: response.status, data: response.data };
    } catch (err) {
        console.error('Error getting transactions:', err);
        return { status: 500, error: err };
    }
};

/**
 * Get invoice details
 */
exports.get_invoice = async (invoiceId) => {
    try {
        const response = await apiRequest('POST', '/merchant/invoice/detail', {
            invoiceId: invoiceId
        });
        
        if (response.success) {
            return {
                status: 200,
                data: response.data
            };
        }
        return { status: response.status, data: response.data };
    } catch (err) {
        console.error('Error getting invoice:', err);
        return { status: 500, error: err };
    }
};

// ==================== DISCOUNT/COUPON MANAGEMENT ====================

/**
 * Verify/retrieve coupon/discount code
 * Maps to ChargeBee coupon verification
 * Only supports batch discount child codes (unique codes from a template, like AppSumo)
 */
exports.verify_coupon = async (couponCode) => {
    try {
        // Only check batch discount child codes (unique codes like AppSumo)
        const batchResult = await verifyBatchChildCode(couponCode);
        if (batchResult) {
            return batchResult;
        }
        
        return { 
            status: 404, 
            data: { message: 'Coupon not found or invalid' } 
        };
    } catch (err) {
        console.error('Error verifying coupon:', err);
        return { status: 500, error: err };
    }
};

/**
 * Verify a main discount code (regular or advanced)
 */
const verifyMainDiscount = (discount) => {
    // Check if discount is deleted
    if (discount.isDeleted && discount.isDeleted > 0) {
        return {
            status: 400,
            data: { message: 'Coupon has been deleted' }
        };
    }
    
    // Check if discount is active (status 2 = active)
    if (discount.status !== 2) {
        return {
            status: 400,
            data: { message: 'Coupon is not active or has been archived' }
        };
    }
    
    // Check validity dates
    const now = Math.floor(Date.now() / 1000);
    if (discount.startTime && now < discount.startTime) {
        return {
            status: 400,
            data: { message: 'Coupon is not yet valid' }
        };
    }
    if (discount.endTime && now > discount.endTime) {
        return {
            status: 400,
            data: { message: 'Coupon has expired' }
        };
    }
    
    // For advanced discounts, check if quantity is available
    if (discount.advance === true) {
        const remaining = discount.liveQuantity || 0;
        if (remaining <= 0) {
            return {
                status: 400,
                data: { 
                    message: 'Coupon has been fully redeemed (no uses remaining)',
                    couponCodeDetails: {
                        code: discount.code,
                        status: 'redeemed'
                    }
                }
            };
        }
    }
    
    // Return success with coupon details
    const couponStatus = discount.advance ? 'not_redeemed' : 'active';
    
    return {
        status: 200,
        data: {
            coupon: {
                id: discount.id,
                code: discount.code,
                name: discount.name,
                discount_type: discount.discountType === 1 ? 'percentage' : 'fixed_amount',
                discount_percentage: discount.discountPercentage,
                discount_amount: discount.discountAmount,
                status: 'active',
                start_time: discount.startTime,
                end_time: discount.endTime,
                is_advanced: discount.advance || false,
                quantity: discount.quantity || 0,
                quantity_used: discount.quantityUsed || 0,
                live_quantity: discount.liveQuantity || 0,
                _unibee: discount
            },
            couponCodeDetails: discount.advance ? {
                code: discount.code,
                status: couponStatus,
                coupon_set_id: discount.id
            } : null
        }
    };
};

/**
 * Verify a batch discount child code (unique codes from a template)
 * These are like ChargeBee's coupon codes from a coupon set
 * Used for AppSumo and similar campaigns with 1000s of unique codes
 * 
 * Optimized: Match by code prefix to find the right template quickly
 */
const verifyBatchChildCode = async (couponCode) => {
    try {
        // First, get all batch templates
        const templatesResponse = await apiRequest('GET', '/merchant/discount/batch/template/list', {});
        
        if (!templatesResponse.success || !templatesResponse.data.templates?.length) {
            return null;
        }
        
        // Find the template that matches this code's prefix
        // Batch codes are formatted as: {prefix}{randomChars} e.g., "ASKC79VYWVH83"
        const codeUpper = couponCode.toUpperCase();
        
        // Sort templates by prefix length (longest first) to match most specific prefix
        const sortedTemplates = templatesResponse.data.templates
            .filter(t => t.status === 2 && (!t.isDeleted || t.isDeleted === 0))
            .sort((a, b) => (b.codePrefix?.length || 0) - (a.codePrefix?.length || 0));
        
        // Find the template whose prefix matches the beginning of the code
        const matchingTemplate = sortedTemplates.find(template => 
            template.codePrefix && codeUpper.startsWith(template.codePrefix.toUpperCase())
        );
        
        if (!matchingTemplate) {
            return null; // No matching template found
        }
        
        // Search for the specific code in this template's children
        const childrenResponse = await apiRequest('GET', '/merchant/discount/batch/children/list', {
            templateId: matchingTemplate.id,
            code: couponCode,
            page: 0,
            count: 1
        });
        
        if (!childrenResponse.success || !childrenResponse.data.children?.length) {
            return null;
        }
        
        const childCode = childrenResponse.data.children.find(
            c => c.code && c.code.toLowerCase() === couponCode.toLowerCase()
        );
        
        if (!childCode) {
            return null;
        }
        
        // Check if code is already redeemed
        if (childCode.isRedeemed) {
            return {
                status: 400,
                data: { 
                    message: 'This coupon code has already been redeemed',
                    couponCodeDetails: {
                        code: childCode.code,
                        status: 'redeemed'
                    }
                }
            };
        }
        
        // Check if code is deleted
        if (childCode.isDeleted && childCode.isDeleted > 0) {
            return {
                status: 400,
                data: { message: 'Coupon code has been deleted' }
            };
        }
        
        // Check if code is active (status 2)
        if (childCode.status !== 2) {
            return {
                status: 400,
                data: { message: 'Coupon code is not active' }
            };
        }
        
        // Check validity dates from template
        const now = Math.floor(Date.now() / 1000);
        if (childCode.startTime && now < childCode.startTime) {
            return {
                status: 400,
                data: { message: 'Coupon is not yet valid' }
            };
        }
        if (childCode.endTime && now > childCode.endTime) {
            return {
                status: 400,
                data: { message: 'Coupon has expired' }
            };
        }
        
        // Valid batch child code found
        return {
            status: 200,
            data: {
                coupon: {
                    id: childCode.id,
                    code: childCode.code,
                    name: childCode.name,
                    discount_type: childCode.discountType === 1 ? 'percentage' : 'fixed_amount',
                    discount_percentage: childCode.discountPercentage,
                    discount_amount: childCode.discountAmount,
                    status: 'active',
                    start_time: childCode.startTime,
                    end_time: childCode.endTime,
                    // Mark as batch child code
                    is_batch_child: true,
                    parent_template_id: matchingTemplate.id,
                    parent_template_code: childCode.parentTemplateCode || matchingTemplate.codePrefix,
                    _unibee: childCode
                },
                // For compatibility with ChargeBee coupon_code format (AppSumo flow)
                couponCodeDetails: {
                    code: childCode.code,
                    status: 'not_redeemed',
                    coupon_set_id: matchingTemplate.id
                }
            }
        };
    } catch (err) {
        console.error('Error verifying batch child code:', err);
        return null;
    }
};

/**
 * Apply discount to subscription
 */
exports.apply_discount = async (params) => {
    const { subscription_id, discount_code } = params;
    try {
        const response = await apiRequest('POST', '/merchant/subscription/apply_discount_preview', {
            subscriptionId: subscription_id,
            discountCode: discount_code
        });
        
        if (response.success) {
            // Submit the discount application
            const applyResponse = await apiRequest('POST', '/merchant/subscription/apply_discount_submit', {
                subscriptionId: subscription_id,
                discountCode: discount_code
            });
            
            if (applyResponse.success) {
                return {
                    status: 200,
                    data: applyResponse.data
                };
            }
            return { status: applyResponse.status, data: applyResponse.data };
        }
        return { status: response.status, data: response.data };
    } catch (err) {
        console.error('Error applying discount:', err);
        return { status: 500, error: err };
    }
};

// ==================== DATA MIGRATION HELPERS ====================

/**
 * Import active subscription from ChargeBee to UniBee
 * Used during migration
 */
exports.import_active_subscription = async (params) => {
    const {
        externalSubscriptionId,
        planId,
        email,
        gateway,
        stripeUserId,
        stripePaymentMethod,
        currentPeriodStart,
        currentPeriodEnd,
        billingCycleAnchor,
        firstPaidTime,
        createTime,
        quantity = 1
    } = params;

    try {
        const response = await apiRequest('POST', '/merchant/subscription/active_subscription_import', {
            externalSubscriptionId,
            planId: parseInt(planId),
            email,
            gateway: gateway || 'stripe',
            stripeUserId,
            stripePaymentMethod,
            currentPeriodStart,
            currentPeriodEnd,
            billingCycleAnchor,
            firstPaidTime,
            createTime,
            quantity
        });
        
        if (response.success) {
            return {
                status: 200,
                data: response.data
            };
        }
        return { status: response.status, data: response.data };
    } catch (err) {
        console.error('Error importing subscription:', err);
        return { status: 500, error: err };
    }
};

/**
 * Import subscription history
 * Used during migration
 */
exports.import_subscription_history = async (params) => {
    const {
        externalSubscriptionId,
        planId,
        email,
        gateway,
        currentPeriodStart,
        currentPeriodEnd,
        totalAmount
    } = params;

    try {
        const response = await apiRequest('POST', '/merchant/subscription/history_subscription_import', {
            externalSubscriptionId,
            planId: parseInt(planId),
            email,
            gateway: gateway || 'stripe',
            currentPeriodStart,
            currentPeriodEnd,
            totalAmount
        });
        
        if (response.success) {
            return {
                status: 200,
                data: response.data
            };
        }
        return { status: response.status, data: response.data };
    } catch (err) {
        console.error('Error importing subscription history:', err);
        return { status: 500, error: err };
    }
};

// ==================== UTILITY FUNCTIONS ====================

/**
 * Map UniBee subscription status to ChargeBee-compatible status
 * UniBee statuses: 1=pending, 2=active, 3=suspended, 4=cancelled, 5=expired, 6=incomplete, 7=processing, 8=failed
 */
function mapUniBeeStatus(status) {
    const statusMap = {
        1: 'pending',
        2: 'active',
        3: 'paused',      // suspended -> paused
        4: 'cancelled',
        5: 'expired',
        6: 'in_trial',    // incomplete -> in_trial (for compatibility)
        7: 'processing',
        8: 'failed'
    };
    return statusMap[status] || 'unknown';
}

/**
 * Map ChargeBee status to UniBee status code
 */
function mapToUniBeeStatus(status) {
    const statusMap = {
        'pending': 1,
        'active': 2,
        'paused': 3,
        'suspended': 3,
        'cancelled': 4,
        'expired': 5,
        'in_trial': 6,
        'processing': 7,
        'failed': 8,
        'deleted': 4
    };
    return statusMap[status] || 1;
}

exports.mapUniBeeStatus = mapUniBeeStatus;
exports.mapToUniBeeStatus = mapToUniBeeStatus;

// ==================== WEBHOOK VERIFICATION ====================

/**
 * Verify webhook signature from UniBee
 * UniBee supports both API Key verification and HMAC signature
 */
exports.verifyWebhookSignature = (req) => {
    const authHeader = req.headers['authorization'];
    const signature = req.headers['x-signature'];
    
    // Method 1: API Key verification
    if (authHeader) {
        const expectedKey = `Bearer ${process.env.UNIBEE_API_KEY}`;
        if (authHeader === expectedKey) {
            return true;
        }
    }
    
    // Method 2: HMAC signature verification (more secure)
    if (signature && process.env.UNIBEE_WEBHOOK_SECRET) {
        const crypto = require('crypto');
        const payload = JSON.stringify(req.body);
        const expectedSignature = crypto
            .createHmac('sha256', process.env.UNIBEE_WEBHOOK_SECRET)
            .update(payload)
            .digest('hex');
        return signature === expectedSignature;
    }
    
    // For development/testing, allow if no security is configured
    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'local') {
        console.warn('Warning: Webhook signature verification skipped in development mode');
        return true;
    }
    
    return false;
};
