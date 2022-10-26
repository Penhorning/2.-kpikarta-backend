"use strict";
const stripe = require("stripe")(process.env.STRIPE_API_KEY);
const { create_product, create_plan } = require("../../helper/stripe");

module.exports = function (Subscriptions) {
  Subscriptions.createPlan = async (plan_name, amount, description, duration, next) => {
    try {
      // Creating a Product on Plan Creation
      const product = await create_product({name: plan_name, description});

      // Creating a Subscription Plan
      const plan = await create_plan({
        amount,
        currency: "usd",
        interval: duration, // day, week, month, year
        productId: product.id,
        planName: plan_name,
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
        product_id: product.id,
        status: plan.active,
      });

      return planData;
    } catch (err) {
      console.log(err);
    }
  };

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
