'use strict';
const stripe = require("stripe")(process.env.STRIPE_API_KEY);
const moment = require('moment');

//---------------- PRICE APIS ----------------
// CREATE PRICE
exports.create_price = async (nickname, productId, amount, interval) => {
    try {
        const response = await stripe.prices.create({
            nickname: nickname,
            product: productId,
            currency: 'usd',
            unit_amount: amount * 100,
            recurring: { interval }, // interval can be month/year
            // recurring: { interval: interval, usage_type: 'licensed' }, // interval can be month/year
            // billing_scheme: 'tiered', 
            // tiers_mode: 'graduated', 
            // tiers: [
            //     { up_to: 'inf', unit_amount: amount*100 },
            // ],
            metadata: {
                unit_amount: amount,
            }
        });
        return response;
    } catch (err) {
        console.log(err);
        return err;
    }
}

// GET PRICE
exports.get_price_by_id = async (priceId) => {
    try {
        const response = await stripe.prices.retrieve( priceId );
        return response;
    } catch (err) {
        console.log(err);
        return err;
    }
}

// UPDATE PRICE
exports.update_price_by_id = async (priceId, data) => {
    try {
        const price = await stripe.prices.update(
            priceId,
            data
        );
        return price;
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
exports.get_product_by_id = async (productId) => {
    try {
        const response = await stripe.products.retrieve( productId );
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
        let body = {
            name: params.name,  
            description: params.description, 
            address: {
                line1: '510 Townsend St',
                postal_code: '98140',
                city: 'San Francisco',
                state: 'CA',
                country: 'US',
            }
        };
        params.clock ? body["test_clock"] = params.clock : null;
        const response = await stripe.customers.create(body);
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

// ATTACH PAYMENT METHOD TO A CUSTOMER
exports.attach_payment_method = async (paymentMethodId, cutomerId) => {
    try {
        const response = await stripe.paymentMethods.attach(
            paymentMethodId,
            {customer: cutomerId}
        );
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
            payment_method: cardId,
            usage: 'off_session',
            confirm: true
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

// ----------------- PAYMENT INTENT APIS --------------------
exports.create_payment_intent = async (customerId, cardId, cents) => {
    try {
        const paymentIntent = await stripe.paymentIntents.create({
            customer: customerId,
            amount: cents,
            currency: 'usd',
            description: "Card verification payment",
            payment_method_types: ['card'],
            payment_method: cardId,
            confirm: true,
            off_session: true
        });
        return paymentIntent;
    } catch ( err ) {
        console.log(err);
        return err;
    }
} 

exports.confirm_payment_intent = async (paymentIntentId, cardId, returnUrl) => {
    try {
        const paymentIntent = await stripe.paymentIntents.confirm(
            paymentIntentId,
            {
                payment_method: cardId,
                return_url: returnUrl
            }
        );
        return paymentIntent;
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
            {object: 'card', limit: 1}
        );
        return response;
    } catch (err) {
        console.log(err);
        return err;
    }
}

// DELETE A CARD
exports.delete_card = async (customerId, cardId) => {
    try {
        const response = await stripe.customers.deleteSource(
            customerId,
            cardId
        );
        return response;
    } catch (err) {
        console.log(err);
        return err;
    }
}

// CREATE SOURCE
exports.create_source = async (params) => {
    try {
        let response = await stripe.sources.create({ 
            customer: params.customerId, 
            usage: 'reusable',
        });
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
            payment_behavior: 'allow_incomplete',
            items: params.items,
            collection_method: "charge_automatically",
            expand: ["latest_invoice.payment_intent"],
            off_session: true,
            // billing_cycle_anchor: moment().add(1, 'months').subtract(1, 'days').unix(),
            // proration_behavior : 'none',
        });
        return response;
    } catch (err) {
        console.log(err);
        return err;
    }
}

// GET SUBSCRIPTION PLAN BY ID
exports.get_subscription_plan_by_id = async (subscriptionId) => {
    try {
        const response = await stripe.subscriptions.retrieve( subscriptionId, { expand: ["latest_invoice.payment_intent"] } );
        return response;
    } catch (err) {
        console.log(err.response);
        return err.response;
    }
}

// UPDATE SUBSCRIPTION
exports.update_subscription = async (subscriptionId, data) => {
    try {
        const subscription = await stripe.subscriptions.update(
            subscriptionId,
            data,
        );
        return subscription;
    } catch (err) {
        console.log(err);
    }
}

// CANCEL USER SUBSCRIPTION
exports.cancel_user_subscription = async (subscriptionId) => {
    try {
        const response = await stripe.subscriptions.del( subscriptionId );
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
        // Not In Use
        return null;
    } catch (err) {
        console.log(err);
        return err;
    }
}

// DEACTIVATE SUBSCRIPTION PLAN
exports.deactivate_subscription_plan = async (params) => {
    try {
        // Not In Use
        return null;
    } catch (err) {
        console.log(err);
        return err;
    }
}
//----------------

// ----------------- CHARGES APIS --------------------
exports.get_charge = async (chargeId) => {
    try {
        const charge = await stripe.charges.retrieve(chargeId);
        return charge;
    } catch ( err ) {
        console.log(err);
        return err;
    }
}


// ----------------- INVOICES APIS --------------------

// GET INVOICES
exports.get_invoices = async (customerId) => {
    try {
        let query = {
            status: "paid"
        };
        customerId ? query['customer'] =  customerId : null;
        const invoices = await stripe.invoices.list(query);
        return invoices;
    } catch ( err ) {
        console.log(err);
        return err;
    }
}

// GET INVOICES FOR ADMIN
exports.get_invoices_for_admin = async (page, limit, customerId, previousId, nextId, startDate, endDate) => {
    try {
        let query = {
            // query: 'status>\'paid\'',
            // page,
            status: "paid", 
            limit,
            expand: ["total_count"]
        };

        startDate && endDate ? query["created"] = {gte: startDate, lte: endDate} : null;
        previousId ? query["ending_before"] = previousId : null;
        nextId ? query["starting_after"] = nextId : null;
        customerId ? query["customer"] = customerId : null;
        const invoices = await stripe.invoices.list(query);
        // const invoices = await stripe.invoices.search(query);
        return invoices;
    } catch ( err ) {
        console.log(err);
        return err;
    }
}

// GET INVOICES FOR ADMIN CHART
exports.get_invoices_for_admin_chart = async (startDate, endDate) => {
    try {
        let query = {
            created: {
                gte: startDate,
                lte: endDate
            },
            limit: 5000,
            status: "paid",
        };
        const invoices = await stripe.invoices.list(query);
        return invoices;
    } catch ( err ) {
        console.log(err);
        return err;
    }
}
//----------------

// ----------------- REFUND APIS --------------------
// CREATE REFUND
exports.create_refund = async (paymentIntentId) => {
    try {
        const refund = await stripe.refunds.create({
            payment_intent: paymentIntentId
        });
        return refund;
    } catch ( err ) {
        console.log(err);
        return err;
    }
}
//----------------