"use strict";
const stripe = require("stripe")(process.env.STRIPE_API_KEY);
const { create_customer, update_customer_by_id, create_token, get_plan_by_id, update_product, update_plan, create_card } = require("../../helper/stripe");

module.exports = function (Subscription) {
  // NOTE:- Cant Change a Plan except its Name and Description

  Subscription.saveCard = async (userId, cardNumber, expirationDate, fullName, cvc, plan) => {
    try {
      const findUser = await Subscription.findOne({where: { userId }});
      if(findUser) {
        // Create a token
        let [expMonth, expYear] = expirationDate.split("/");
        let token = await create_token({cardNumber, expMonth, expYear, cvc});

        // Create Card
        let card = await create_card({customerId: customer.id, tokenId: token.id});

        if(card) {
          await update_customer_by_id({customerId: findUser.customerId, data: {default_source: card.id}});
          return "Card saved successfully";
        }
      } else {
        // Create Cutomer on Stripe
        let customer = await create_customer({name: fullName, description: `Welcome to stripe, ${fullName}`});

        // Create a token
        let [expMonth, expYear] = expirationDate.split("/");
        let token = await create_token({cardNumber, expMonth, expYear, cvc});
        
        // Create Card
        let card = await create_card({customerId: customer.id, tokenId: token.id});
        if(card) {
          await update_customer_by_id({customerId: customer.id, data: {default_source: card.id}});
          await Subscription.app.models.user.update({"id": userId}, {currentPlan: plan});
          await Subscription.create({userId, customerId: customer.id, cardId: card.id, tokenId: token.id});
          return "Card saved successfully";
        }
      }
    }
    catch(err) {
      console.log(err);
    }
  }
};
