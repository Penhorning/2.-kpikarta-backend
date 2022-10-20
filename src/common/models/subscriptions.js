"use strict";

const stripe = require("stripe")(process.env.STRIPE_API_KEY);

module.exports = function (Subscriptions) {
  Subscriptions.createPlan = async (plan_name, amount, next) => {
    try {
      // Creating a Product on first Plan Creation
      let product = null;
      const products = await stripe.products.list();
      if (products.data.length == 0) {
        product = await stripe.products.create({
          name: "Dev-Product",
        });
      } else {
        product = products.data[0];
      }

      // Creating a Subscription Plan
      const plan = await stripe.plans.create({
        amount,
        currency: "usd",
        interval: "month",
        product: product.id,
        metadata: {
          name: plan_name,
        },
      });

      // Saving a Subscription Plan in database
      const planData = await Subscriptions.create({
        name: plan.metadata.name,
        amount: plan.amount,
        currency: plan.currency,
        interval: plan.interval,
        interval_count: plan.interval_count,
        status: plan.active,
      });

      return planData;
    } catch (err) {
      console.log(err);
    }
  };
};
