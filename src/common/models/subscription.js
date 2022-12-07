"use strict";
const stripe = require("stripe")(process.env.STRIPE_API_KEY);
const { create_customer, update_customer_by_id, create_token, get_plan_by_id, update_product, update_plan, create_card, create_subscription, create_price, get_all_products, create_product } = require("../../helper/stripe");

module.exports = function (Subscription) {
  // NOTE:- Cant Change a Plan except its Name and Description
  Subscription.saveCard = async (userId, cardNumber, expirationDate, fullName, cvc, plan) => {
    // PLAN - Monthly/Yearly
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
        // const testClock = await stripe.testHelpers.testClocks.create({
        //   frozen_time: Math.floor(Date.now() / 1000), // Integer Unix Timestamp
        // });

        // Create Cutomer on Stripe
        let customer = await create_customer({name: fullName, description: `Welcome to stripe, ${fullName}`, address: {}, clock: testClock.id });

        // Create a token
        let [expMonth, expYear] = expirationDate.split("/");
        let token = await create_token({cardNumber, expMonth, expYear, cvc});
        
        // Create Card
        let card = await create_card({customerId: customer.id, tokenId: token.id});
        if(card) {
          await update_customer_by_id({customerId: customer.id, data: {default_source: card.id}});
          await Subscription.app.models.user.update({"id": userId}, {currentPlan: plan});
          const intervalValue = plan == "monthly" ? "month" : "year";
          const getPriceId = await Subscription.app.models.price_mapping.findOne({where: { licenseType: "Creator", interval: intervalValue }});
          const priceArray = [
            { price: getPriceId.priceId, quantity: 1 },
          ];
          const subscription = await create_subscription({customerId: customer.id, items: priceArray});
          await Subscription.create({userId, customerId: customer.id, cardId: card.id, tokenId: token.id, subscriptionId: subscription.id});
          return "Card saved successfully";
        }
      }
    }
    catch(err) {
      console.log(err);
    }
  }

  Subscription.createPrice = async (nickname, amount, interval, userId, licenseType) => {
    try {
      // LicenseType - Creator/Champion
      // INTERVAL - Month/Year
      const allProducts = await get_all_products();
      const findProductByInterval = allProducts.findIndex(prod => prod.name == interval);
      if ( findProductByInterval == -1 ) {
        const newProduct = await create_product(interval, `PER SEAT ${interval.toUpperCase()} PLAN`);
        const price = await create_price(nickname, newProduct.id, amount, interval);
        const priceDetails = await Subscription.app.models.price_mapping.create({ priceId: price.id, userId, productId: newProduct.id, interval, licenseType });
  
        return priceDetails;
      } else {
        const price = await create_price(nickname, allProducts[findProductByInterval].id, amount, interval);
        const priceDetails = await Subscription.app.models.price_mapping.create({ priceId: price.id, userId, productId: allProducts[findProductByInterval].id, interval, licenseType });
  
        return priceDetails;
      }
    } catch (err) {
      console.log(err);
    }
  }

  // Subscription.updateSubscription = async (userId, licenseType) => {
  //   try {
  //     // LicenseType - Creator/Champion
  //     const findUser = await Subscription.findOne({where: { userId, licenseType }});
  //   } catch (err) {
  //     console.log(err);
  //   }
  // }
};
