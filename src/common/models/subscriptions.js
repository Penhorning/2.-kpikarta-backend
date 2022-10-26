"use strict";
const stripe = require("stripe")(process.env.STRIPE_API_KEY);
const { create_product, create_plan, get_plan_by_id, update_product, update_plan } = require("../../helper/stripe");

module.exports = function (Subscriptions) {
  Subscriptions.createPlan = async (planName, amount, description, duration, userId, next) => {
    try {
      // Creating a Product on Plan Creation
      const product = await create_product({name: planName, description});

      // Creating a Subscription Plan
      const plan = await create_plan({
        amount,
        currency: "usd",
        interval: duration, // day, week, month, year
        productId: product.id,
        planName: planName,
      });

      // // Saving a Subscription Plan in database
      const planData = await Subscriptions.create({
        name: plan.metadata.name,
        amount: amount,
        description: product.description,
        currency: plan.currency,
        duration: plan.interval,
        interval_count: plan.interval_count,
        plan_id: plan.id,
        user_id: userId,
        product_id: product.id,
        status: plan.active,
      });

      return planData;
    } catch (err) {
      console.log(err);
    }
  };

  Subscriptions.updatePlan = async (planId, planName, amount, description, duration, userId, next) => {
    const getPlanDetails = await get_plan_by_id({ planId });

    // Update Product
    const prod_details = await update_product({productId: getPlanDetails.product, planName, description});

    // Update Plan
    const updated_plan = await update_plan({planId, amount, interval: duration, planName: planName});

    // Update Plan in database
    const updatedPlanDetails = await Subscriptions.update({where: { plan_id: planId, user_id: userId }}, {
      name: updated_plan.metadata.name,
      amount,
      description: prod_details.description,
      duration: updated_plan.interval
    });

    return updatedPlanDetails;
  }

  Subscriptions.saveCards = async (customerId) => {
    //Create a Card
    const card = await stripe.customers.createSource(
      'cus_4QFHdAzXHKCFfn',
      {source: 'tok_amex'}
    );
  }

  Subscriptions.makeSubcription = async (customerId) => {
    // Create a Subscription
    const subscription = await stripe.subscriptions.create({
      customer: 'cus_MdrG2B6720sNNl',
      items: [
        {price: 'price_1LvEOZSGltNYnTVR4WeitFWe'},
      ],
    });

    console.log(subscription, 'subscription');
    return subscription;
  }
};
