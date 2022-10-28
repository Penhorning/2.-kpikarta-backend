"use strict";
const stripe = require("stripe")(process.env.STRIPE_API_KEY);
const { create_product, create_plan, get_plan_by_id, update_product, update_plan, update_plan_status } = require("../../helper/stripe");

module.exports = function (Subscription) {
  Subscription.createPlan = async (planName, amount, description, duration, userId, next) => {
    try {
      // Creating a Product on Plan Creation
      const product = await create_product({name: planName, description});

      // Creating a Subscription Plan
      const plan = await create_plan({
        amount,
        currency: "usd",
        duration,
        productId: product.id,
        planName: planName,
      });

      // // Saving a Subscription Plan in database
      const planData = await Subscription.create({
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

  Subscription.changePlanStatus = async (planId, status, next) => {
    // Update Plan By ID
    const updatedPlan = await update_plan_status({ planId, status });

    // Update Plan Status in Databae
    const updatedPlanInDb = await Subscription.update({ plan_id: planId }, { status });

    if(updatedPlanInDb){
      return "Status changed successfully..!!";
    }
  }

  Subscription.saveCards = async (customerId) => {
    //Create a Card
    const card = await stripe.customers.createSource(
      'cus_4QFHdAzXHKCFfn',
      {source: 'tok_amex'}
    );
  }

  Subscription.makeSubcription = async (customerId) => {
    // Create a Subscription
    const subscription = await stripe.Subscription.create({
      customer: 'cus_MdrG2B6720sNNl',
      items: [
        {price: 'price_1LvEOZSGltNYnTVR4WeitFWe'},
      ],
    });

    console.log(subscription, 'subscription');
    return subscription;
  }

  Subscription.beforeRemote('prototype.patchAttributes', async function(context, instance,  next) {
    // NOTE:- Cant Change a Plan except its Name and Description
    const req = context.req;

    // Get Plan Details
    const getPlanDetails = await get_plan_by_id({ planId: req.body.planId });

    // Update Product
    const prodDetails = await update_product({ productId: getPlanDetails.product, planName: req.body.planName, description: req.body.description });

    // Update Plan
    const updatedPlan = await update_plan({ planId: req.body.planId, planName: req.body.planName });

    // Update Plan in database
    const updatedPlanDetails = await Subscription.update({ plan_id: req.body.planId, user_id: req.body.userId } , {
      name: updatedPlan.metadata.name,
      description: prodDetails.description,
    });

    if(updatedPlanDetails){
      return "Plan updated successfully..!!";
    }

  });
};
