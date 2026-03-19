'use strict';

const buildPlan = (id, name, price, periodUnit) => ({
    item_price: {
        id,
        name,
        item_family_id: 'kpi-karta',
        item_id: id,
        description: `${name} demo plan`,
        status: 'active',
        external_name: name,
        pricing_model: 'per_unit',
        price,
        period: 1,
        currency_code: 'USD',
        period_unit: periodUnit,
        trial_period: 14,
        trial_period_unit: 'day',
        free_quantity: 0,
        channel: 'web',
        resource_version: Date.now(),
        updated_at: Math.floor(Date.now() / 1000),
        created_at: Math.floor(Date.now() / 1000),
        is_taxable: false,
        accounting_detail: {},
        metadata: { demo: true },
        item_type: 'plan',
        show_description_in_invoices: true,
        show_description_in_quotes: true,
        deleted: false,
        object: 'item_price'
    }
});

const DEMO_PLANS = {
    'creator-monthly-demo': buildPlan('creator-monthly-demo', 'Creator Monthly', 2900, 'month'),
    'creator-yearly-demo': buildPlan('creator-yearly-demo', 'Creator Yearly', 29000, 'year'),
    'creator-free-demo': buildPlan('creator-free-demo', 'Creator Free', 0, 'month'),
    'creator-monthly-addon-demo': buildPlan('creator-monthly-addon-demo', 'Creator Addon Monthly', 900, 'month'),
    'creator-yearly-addon-demo': buildPlan('creator-yearly-addon-demo', 'Creator Addon Yearly', 9000, 'year'),
    'champion-monthly-addon-demo': buildPlan('champion-monthly-addon-demo', 'Champion Addon Monthly', 1400, 'month'),
    'champion-yearly-addon-demo': buildPlan('champion-yearly-addon-demo', 'Champion Addon Yearly', 14000, 'year'),
    'appsumo-demo': buildPlan('appsumo-demo', 'AppSumo Lifetime', 0, 'year'),
    'dealmirror-demo': buildPlan('dealmirror-demo', 'DealMirror Lifetime', 0, 'year')
};

const planIds = {
    CREATOR_MONTHLY_PLAN_ID: process.env.UNIBEE_CREATOR_MONTHLY_PLAN_ID || process.env.CREATOR_MONTHLY_PLAN_ID || 'creator-monthly-demo',
    CREATOR_YEARLY_PLAN_ID: process.env.UNIBEE_CREATOR_YEARLY_PLAN_ID || process.env.CREATOR_YEARLY_PLAN_ID || 'creator-yearly-demo',
    CREATOR_FREE_PLAN_ID: process.env.UNIBEE_CREATOR_FREE_PLAN_ID || process.env.CREATOR_FREE_PLAN_ID || 'creator-free-demo',
    APPSUMO_PLAN_ID: process.env.UNIBEE_APPSUMO_PLAN_ID || 'appsumo-demo',
    DEALMIRROR_PLAN_ID: process.env.UNIBEE_DEALMIRROR_PLAN_ID || 'dealmirror-demo',
    CREATOR_MONTHLY_ADDON_PLAN_ID: process.env.UNIBEE_CREATOR_MONTHLY_ADDON_PLAN_ID || process.env.CREATOR_MONTHLY_ADDON_PLAN_ID || 'creator-monthly-addon-demo',
    CREATOR_YEARLY_ADDON_PLAN_ID: process.env.UNIBEE_CREATOR_YEARLY_ADDON_PLAN_ID || process.env.CREATOR_YEARLY_ADDON_PLAN_ID || 'creator-yearly-addon-demo',
    CHAMPION_MONTHLY_ADDON_PLAN_ID: process.env.UNIBEE_CHAMPION_MONTHLY_ADDON_PLAN_ID || process.env.CHAMPION_MONTHLY_ADDON_PLAN_ID || 'champion-monthly-addon-demo',
    CHAMPION_YEARLY_ADDON_PLAN_ID: process.env.UNIBEE_CHAMPION_YEARLY_ADDON_PLAN_ID || process.env.CHAMPION_YEARLY_ADDON_PLAN_ID || 'champion-yearly-addon-demo'
};

const planById = (id) => DEMO_PLANS[id] || buildPlan(String(id), `Plan ${id}`, 0, 'month');

const buildSubscription = (params = {}) => {
    const now = Math.floor(Date.now() / 1000);
    const planId = String(params.plan_id || params.planId || planIds.CREATOR_MONTHLY_PLAN_ID);
    const plan = planById(planId).item_price;
    return {
        id: `demo-sub-${Date.now()}`,
        subscriptionId: `demo-sub-${Date.now()}`,
        customer_id: params.customer_id,
        status: 'active',
        billing_period_unit: plan.period_unit,
        current_term_start: now,
        current_term_end: now + (plan.period_unit === 'year' ? 31536000 : 2592000),
        next_billing_at: now + (plan.period_unit === 'year' ? 31536000 : 2592000),
        subscription_items: [
            {
                item_price_id: plan.id,
                amount: plan.price,
                unit_price: plan.price
            }
        ]
    };
};

exports.get_plans = async () => ({
    status: 200,
    data: {
        list: [planById(planIds.CREATOR_MONTHLY_PLAN_ID), planById(planIds.CREATOR_YEARLY_PLAN_ID)]
    }
});

exports.get_plans_free = async () => ({
    status: 200,
    data: {
        list: [planById(planIds.CREATOR_FREE_PLAN_ID)]
    }
});

exports.get_plan = async (planId) => ({ status: 200, data: { list: [planById(String(planId))] } });
exports.get_champion_plan = exports.get_plan;
exports.get_creator_plan = exports.get_plan;

exports.create_customer = async (params) => ({
    status: 200,
    data: {
        customer: {
            id: `demo-customer-${Date.now()}`,
            email: params.email,
            first_name: params.first_name,
            company: params.company
        }
    }
});

exports.get_user_by_email = async (email) => ({
    status: 200,
    data: {
        user: {
            id: `demo-user-${Date.now()}`,
            email
        }
    }
});

exports.create_subscription = async (params) => ({
    status: 200,
    data: {
        subscription: buildSubscription(params)
    }
});

exports.get_subscription = async (subscriptionId) => ({
    status: 200,
    data: {
        subscription: {
            ...buildSubscription({}),
            id: subscriptionId,
            subscriptionId
        }
    }
});

exports.get_user_subscription = async () => ({ status: 200, data: { subscriptions: [] } });

exports.update_subscription = async (params) => ({
    status: 200,
    data: {
        subscription: {
            subscriptionId: params.subscription_id,
            status: 'active'
        }
    }
});

exports.cancel_subscription = async (params) => ({ status: 200, data: { subscription: { subscriptionId: params.subscription_id, status: 'cancelled' } } });
exports.pause_subscription = async (params) => ({ status: 200, data: { subscription: { subscriptionId: params.subscription_id, status: 'paused' } } });
exports.resume_subscription = async (params) => ({ status: 200, data: { subscription: { subscriptionId: params.subscription_id, status: 'active' } } });
exports.delete_subscription = async (params) => ({ status: 200, data: { subscription: { subscriptionId: params.subscription_id, status: 'deleted' } } });

exports.create_portal_session = async () => ({
    status: 200,
    data: {
        portal_session: {
            access_url: process.env.WEB_URL || 'http://localhost:3000/subscription'
        }
    }
});

exports.get_transactions = async () => ({ status: 200, data: { list: [] } });
exports.get_invoice = async () => ({ status: 200, data: { invoice: null } });

exports.verify_coupon = async (couponCode) => ({
    status: 200,
    data: {
        coupon: {
            id: couponCode,
            code: couponCode,
            name: `Demo coupon ${couponCode}`,
            discount_type: 'percentage',
            discount_percentage: 100,
            discount_amount: 0,
            status: 'active',
            is_advanced: false,
            quantity: 999999,
            quantity_used: 0,
            live_quantity: 999999,
            _unibee: { demo: true }
        }
    }
});

exports.apply_discount = async (params) => ({
    status: 200,
    data: {
        subscription_id: params.subscription_id,
        discount_code: params.discount_code,
        applied: true,
        demo: true
    }
});

exports.verifyWebhookSignature = () => true;
exports.import_active_subscription = async () => ({ status: 200, data: { demo: true } });
exports.import_subscription_history = async () => ({ status: 200, data: { demo: true } });
exports.mapUniBeeStatus = (status) => status || 'active';
exports.mapToUniBeeStatus = (status) => status || 'active';
