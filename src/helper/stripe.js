'use strict';
const stripe = require("stripe")(process.env.STRIPE_API_KEY);

//---------------- PRICE APIS ----------------
// CREATE PRICE
exports.create_price = async (nickname, productId, amount, interval) => {
    try {
        const response = await stripe.prices.create({
            nickname: nickname,
            product: productId,
            // unit_amount: amount,
            currency: 'usd',
            recurring: { interval: interval, usage_type: 'licensed' }, // interval can be month/year
            billing_scheme: 'tiered', 
            tiers_mode: 'graduated', 
            tiers: [
                { up_to: 'inf', unit_amount: amount*100 },
            ]
        });
        return response;
    } catch (err) {
        console.log(err);
        return err;
    }
}
//----------------


//---------------- PRODUCT APIS ----------------
// CREATE PRODUCT PLAN
exports.create_product = async (name, description) => {
    try {
        const response = await stripe.products.create({ name, description });
        return response;
    } catch (err) {
        console.log(err);
        return err;
    }
}

// GET PRODUCT BY ID
exports.get_product_by_id = async (params) => {
    try {
        const response = await stripe.products.retrieve( params.prodId );
        return response;
    } catch (err) {
        console.log(err);
        return err;
    }
}

// LIST ALL PRODUCT
exports.get_all_products = async () => {
    try {
        const products = await stripe.products.list({
            limit: 2,
        });
        return products.data;
    } catch (err) {
        console.log(err);
        return err;
    }
}
//----------------


//---------------- PLAN APIS ----------------
// UPDATE PRODUCT PLAN
exports.update_product = async (params) => {
    try {
        const response = await stripe.products.update(params.productId, { name: params.name, description: params.description });
        return response;
    } catch (err) {
        console.log(err);
        return err;
    }
}

// CREATE A PLAN PLAN (PRODUCT PRICING)
exports.create_plan = async (params) => {
    try {
        const response = await stripe.plans.create({
            amount: params.amount * 100,
            currency: params.currency,
            interval: "day", // MONTH
            interval_count: params.duration, // MONTH
            product: params.productId,
            metadata: {
                name: params.planName,
            },
        });
        return response;
    } catch (err) {
        console.log(err);
        return err;
    }
}

// GET PLAN BY ID
exports.get_plan_by_id = async (params) => {
    try {
        // PLANID is referred to PRICEID
        const response = await stripe.plans.retrieve( params.planId ); 
        return response;
    } catch (err) {
        console.log(err);
        return err;
    }
}

// UPDATE A PRODUCT PLAN (PRODUCT PRICING)
exports.update_plan = async (params) => {
    try {
        const response = await stripe.plans.update(
            params.planId, {
                metadata: {
                    name: params.planName,
                }
            });
        return response;
    } catch (err) {
        console.log(err);
        return err;
    }
}

// UPDATE PLAN STATUS (PRODUCT PRICING)
exports.update_plan_status = async (params) => {
    try {
        const response = await stripe.plans.update(
            params.planId, {
                active: params.status
            });
        return response;
    } catch (err) {
        console.log(err);
        return err;
    }
}
//----------------


//---------------- CUSTOMER APIS ----------------
// CREATE CUSTOMER
exports.create_customer = async (params) => {
    try {
        const response = await stripe.customers.create({ 
            name: params.name,  
            description: params.description, 
            address: {
                city: "Gurgaon",
                country: "India",
                line1: "Test Line 1",
                line2: "Test Line 2",
                postal_code: "",
                state: "Haryana"
            },
            // test_clock: params.clock
        });
        return response;
    } catch (err) {
        console.log(err);
        return err;
    }
}

// GET CUSTOMER BY ID
exports.get_customer_by_id = async (params) => {
    try {
        const response = await stripe.customers.retrieve(params.customerId);
        return response;
    } catch (err) {
        console.log(err);
        return err;
    }
}

// UPDATE CUSTOMER BY ID
exports.update_customer_by_id = async (params) => {
    try {
        const response = await stripe.customers.update( params.customerId, params.data);
        return response;
    } catch (err) {
        console.log(err);
        return err;
    }
}
//----------------

// ----------------- SETUPINTENT APIS --------------------
exports.create_setup_intent = async (customerId, cardId) => {
    try {
        const setupIntent = await stripe.setupIntents.create({
            customer: customerId,
            payment_method_types: ['card'],
            // payment_method: cardId,
            usage: 'off_session',
        });
        return setupIntent;
    } catch ( err ) {
        console.log(err);
        return err;
    }
} 

exports.confirm_setup_intent = async (setupIntentId, cardId) => {
    try {
        const setupIntent = await stripe.setupIntents.confirm(
            setupIntentId,
            { payment_method: cardId }
        );
        return setupIntent;
    } catch (err) {
        console.log(err);
        return err;
    }
}
//----------------


// ----------------- CARD APIS --------------------
// CREATE TOKEN WHICH TAKES CARD INFORMATION - TOKEN NEEDS TO BE CREATED BEFORE CARD
exports.create_token = async (params) => {
    try {
        const response = await stripe.tokens.create({
            card: {
              number: params.cardNumber,
              exp_month: params.expMonth,
              exp_year: params.expYear,
              cvc: params.cvc,
              name: params.name,
            },
        });
        return response;
    } catch (err) {
        console.log(err);
        return err;
    }
}

// CREATE CARD
exports.create_card = async (params) => {
    try {
        const response = await stripe.customers.createSource( params.customerId, { source: params.tokenId } );
        return response;
    } catch (err) {
        console.log(err);
        return err;
    }
}

// GET CUSTOMER CARD BY CARD ID
exports.get_card_by_id = async (customerId, cardId) => {
    try {
        const response = await stripe.customers.retrieveSource( customerId, cardId );
        return response;
    } catch (err) {
        console.log(err);
        return err;
    }
}

// LIST ALL CARDS BY USER ID
exports.get_all_cards = async (customerId) => {
    try {
        const response = await stripe.customers.listSources(
            customerId,
            {object: 'card', limit: 3}
        );
        return response;
    } catch (err) {
        console.log(err);
        return err;
    }
}
//----------------


// ----------------- SUBSCRIPTION APIS --------------------
// CREATE SUBSCRIPTION
exports.create_subscription = async (params) => {
    try {
        const response = await stripe.subscriptions.create({ 
            customer: params.customerId,
            proration_behavior: 'create_prorations',
            items: params.items,
            trial_period_days: 10,
            // collection_method: "charge_automatically",
            // default_source: params.sourceId,
            expand: ["latest_invoice.payment_intent"],
            off_session: true,
        });
        return response;
    } catch (err) {
        console.log(err);
        return err;
    }
}

// GET SUBSCRIPTION PLAN BY ID
exports.get_subscription_plan_by_id = async (params) => {
    try {
        const response = await stripe.subscriptions.retrieve( params.subscriptionId );
        return response;
    } catch (err) {
        console.log(err.response);
        return err.response;
    }
}

exports.update_subscription = async (params) => {
    try {
        const subscription = await stripe.subscriptions.update(
            'sub_1MCdVj2eZvKYlo2CGKqmDzwj',
            params.data
        );
        return subscription;
    } catch (err) {
        console.log(err);
    }
}

// CANCEL USER SUBSCRIPTION
exports.cancel_user_subscription = async (params) => {
    try {
        const response = await stripe.subscriptions.del( params.subscriptionId );
        return response;
    } catch (err) {
        console.log(err.response);
        return err.response;
    }
}

// GET ALL SUBSCRIPTION PLANS
exports.get_all_subscription_plans = async (params) => {
    try {
        const response = await stripe.subscriptions.list();
        return response;
    } catch (err) {
        console.log(err.response);
        return err.response;
    }
}

// ACTIVATE SUBSCRIPTION PLAN
exports.activate_subscription_plan = async (params) => {
    try {
        const planId = params.planId;
        const response = await axios.post(`${BILLING_PLAN_URL}/${planId}/activate`, {}, { headers: REQUEST_HEADER });
        return response;
    } catch (err) {
        console.log(err.response);
        return err.response;
    }
}

// DEACTIVATE SUBSCRIPTION PLAN
exports.deactivate_subscription_plan = async (params) => {
    try {
        const planId = params.planId;
        const response = await axios.post(`${BILLING_PLAN_URL}/${planId}/deactivate`, {}, { headers: REQUEST_HEADER });
        return response;
    } catch (err) {
        console.log(err.response);
        return err.response;
    }
}
//----------------