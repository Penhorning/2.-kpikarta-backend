'use strict';
const stripe = require("stripe")(process.env.STRIPE_API_KEY);

// CREATE PRODUCT PLAN
exports.create_product = async (params) => {
    try {
        const response = await stripe.products.create({ name: params.name, description: params.description });
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
            interval: params.interval, // MONTH
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
                amount: params.amount * 100,
                interval: params.interval, // MONTH
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

// CREATE CUSTOMER
exports.create_customer = async (params) => {
    try {
        const response = await stripe.customers.create({ name: params.name,  description: params.description });
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

// CREATE TOKEN WHICH TAKES CARD INFORMATION - TOKEN NEEDS TO BE CREATED BEFORE CARD
exports.create_token = async (params) => {
    try {
        const response = await stripe.tokens.create({
            card: {
              number: params.cardNumber,
              exp_month: params.expMonth,
              exp_year: params.expYear,
              cvc: params.cvc,
            },
        });
        return response;
    } catch (err) {
        console.log(err);
        return err;
    }
}

// CREATE CUSTOMER
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
exports.get_card_by_id = async (params) => {
    try {
        const response = await stripe.customers.retrieveSource( params.customerId, params.cardId );
        return response;
    } catch (err) {
        console.log(err);
        return err;
    }
}

// CREATE SUBSCRIPTION
exports.create_subscription = async (params) => {
    try {
        const response = await stripe.subscriptions.create({ 
            customer: params.customerId,
            items: [
              {price: params.planId},
            ],
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
//----------------



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
