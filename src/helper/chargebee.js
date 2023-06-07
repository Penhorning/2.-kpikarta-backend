'use strict';

const axios = require('axios');
const REQUEST_HEADER = {
    "Content-Type": "application/x-www-form-urlencoded",
    "Authorization": `Basic ${Buffer.from(process.env.CHARGEBEE_API_KEY).toString('base64')}`
};
const SITE_URL = `${process.env.CHARGEBEE_SITE_URL}/api/v2`;


// GET PLANS
exports.get_plans = async () => {
    try {
        const planIds = [process.env.CREATOR_MONTHLY_PLAN_ID, process.env.CREATOR_YEARLY_PLAN_ID,];
        const URL = `${SITE_URL}/item_prices?id[in]=[${planIds}]`;
        const response = await axios.get(URL, { headers: REQUEST_HEADER });
        return response;
    } catch (err) {
        console.log(err);
        return err;
    }
}

// CREATE CUSTOMER
exports.create_customer = async (params) => {
    const { id, first_name, email, company } = params;
    try {
        const data = `id=${id}&first_name=${first_name}&email=${email}&company=${company}`;
        const URL = `${SITE_URL}/customers`;
        const response = await axios.post(URL, data, { headers: REQUEST_HEADER });
        return response;
    } catch (err) {
        console.log(err);
        return err;
    }
}

// CREATE SUBSCRIPTION
exports.create_subscription = async (params) => {
    const { customer_id, plan_id } = params;
    try {
        const data = `subscription_items[item_price_id][0]=${plan_id}&subscription_items[quantity][0]=1`;
        const URL = `${SITE_URL}/customers/${customer_id}/subscription_for_items`;
        const response = await axios.post(URL, data, { headers: REQUEST_HEADER });
        return response;
    } catch (err) {
        console.log(err);
        return err;
    }
}

// CREATE PORTAL SESSION
exports.create_portal_session = async (params) => {
    const { customer_id } = params;
    try {
        const data = `customer[id]=${customer_id}`;
        const URL = `${SITE_URL}/portal_sessions`;
        const response = await axios.post(URL, data, { headers: REQUEST_HEADER });
        return response;
    } catch (err) {
        console.log(err);
        return err;
    }
}

// UPDATE SUBSCRIPTION
exports.update_subscription = async (params) => {
    const { subscription_id, addon_plan_id, license_count, replaceItems } = params;
    try {
        let data = `subscription_items[item_price_id][1]=${addon_plan_id}&subscription_items[quantity][1]=${license_count}`;
        if (license_count < 1) data = `replace_items_list=true`;
        else if (license_count > 0 && replaceItems) {
            data = `subscription_items[item_price_id][1]=${addon_plan_id}&subscription_items[quantity][1]=${license_count}&replace_items_list=true`;
        }
        const URL = `${SITE_URL}/subscriptions/${subscription_id}/update_for_items`;
        const response = await axios.post(URL, data, { headers: REQUEST_HEADER });
        return response;
    } catch (err) {
        console.log(err);
        return err;
    }
}

// PAUSE SUBSCRIPTION
exports.pause_subscription = async (params) => {
    const { subscription_id } = params;
    try {
        const URL = `${SITE_URL}/subscriptions/${subscription_id}/pause`;
        const response = await axios.post(URL, {}, { headers: REQUEST_HEADER });
        return response;
    } catch (err) {
        console.log(err);
        return err;
    }
}

// Resume SUBSCRIPTION
exports.resume_subscription = async (params) => {
    const { subscription_id } = params;
    try {
        const URL = `${SITE_URL}/subscriptions/${subscription_id}/resume`;
        const response = await axios.post(URL, {}, { headers: REQUEST_HEADER });
        return response;
    } catch (err) {
        console.log(err);
        return err;
    }
}

// CANCEL SUBSCRIPTION
exports.cancel_subscription = async (params) => {
    const { subscription_id } = params;
    try {
        const URL = `${SITE_URL}/subscriptions/${subscription_id}/cancel_for_items`;
        const response = await axios.post(URL, {}, { headers: REQUEST_HEADER });
        return response;
    } catch (err) {
        console.log(err);
        return err;
    }
}

// Delete SUBSCRIPTION
exports.delete_subscription = async (params) => {
    const { subscription_id } = params;
    try {
        const URL = `${SITE_URL}/subscriptions/${subscription_id}/delete`;
        const response = await axios.post(URL, {}, { headers: REQUEST_HEADER });
        return response;
    } catch (err) {
        console.log(err);
        return err;
    }
}

// GET TRANSACTIONS
exports.get_transactions = async (params) => {
    const { limit, offset } = params;
    try {
        const URL = `${SITE_URL}/transactions?limit=${limit}&offset=${offset}`;
        const response = await axios.get(URL, { headers: REQUEST_HEADER });
        return response;
    } catch (err) {
        console.log(err);
        return err;
    }
}
