"use strict";
const stripe = require("stripe")(process.env.STRIPE_API_KEY);
const { create_product, create_plan, get_plan_by_id, update_product, update_plan, update_plan_status } = require("../../helper/stripe");

module.exports = function (Subscriptions) {
  Subscriptions.createPlan = async (planName, amount, description, duration, userId, next) => {
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

  Subscriptions.updatePlan = async (planId, planName, description, userId, next) => {
    // NOTE:- Cant Change a Plan except its Name and Description

    // Get Plan Details
    const getPlanDetails = await get_plan_by_id({ planId });

    // Update Product
    const prodDetails = await update_product({ productId: getPlanDetails.product, planName, description });

    // Update Plan
    const updatedPlan = await update_plan({ planId, planName: planName });

    // Update Plan in database
    const updatedPlanDetails = await Subscriptions.update({ plan_id: planId, user_id: userId } , {
      name: updatedPlan.metadata.name,
      description: prodDetails.description,
    });

    if(updatedPlanDetails){
      return "Plan updated successfully..!!";
    }
  }

  Subscriptions.changePlanStatus = async (planId, status, next) => {
    // Update Plan By ID
    const updatedPlan = await update_plan_status({ planId, status });

    // Update Plan Status in Databae
    const updatedPlanInDb = await Subscriptions.update({ plan_id: planId }, { status });

    if(updatedPlanInDb){
      return "Status changed successfully..!!";
    }
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
