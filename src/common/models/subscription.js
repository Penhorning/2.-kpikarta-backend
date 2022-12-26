"use strict";
const stripe = require("stripe")(process.env.STRIPE_API_KEY);
const { 
  create_customer, 
  update_customer_by_id, 
  create_token, create_card, 
  create_subscription, 
  create_price, 
  get_all_products, 
  create_product, 
  update_subscription, 
  create_setup_intent, 
  confirm_setup_intent, 
  get_all_cards,
  attach_payment_method,
  get_subscription_plan_by_id,
  get_price_by_id,
  get_product_by_id,
  get_invoices,
  get_invoices_for_admin,
  get_invoices_for_admin_chart
} = require("../../helper/stripe");
const moment = require('moment');

module.exports = function (Subscription) {
  Subscription.saveCard = async (userId, cardNumber, expirationDate, fullName, cvc, plan) => {
    // PLAN - Monthly/Yearly
    try {
      const findUser = await Subscription.findOne({where: { userId }});
      if(findUser) {
        // Create a token
        let [expMonth, expYear] = expirationDate.split("/");
        let token = await create_token({cardNumber, expMonth, expYear, cvc, name: fullName});

        // Create Card
        let card = await create_card({customerId: customer.id, tokenId: token.id});

        if(card) {
          await update_customer_by_id({ customerId: findUser.customerId, data: { default_source: card.id } });
          await update_subscription({ subcriptionId: findUser.subscriptionId, data: { default_source: card.id } });
          await Subscription.update({ where: { userId }}, { tokenId: token.id, cardId: card.id });
          return "Card saved successfully";
        }
      } else {
        // Creating Test Clock for testing
        const testClock = await stripe.testHelpers.testClocks.create({
          frozen_time: Math.floor(Date.now() / 1000), // Integer Unix Timestamp
        });

        // Create Cutomer on Stripe
        let customer = await create_customer({ name: fullName, description: `Welcome to stripe, ${fullName}`, address: {}, clock: testClock.id });
        // let customer = await create_customer({ name: fullName, description: `Welcome to stripe, ${fullName}`, address: {} });

        // Create a token
        let [ expMonth, expYear ] = expirationDate.split("/");
        let token = await create_token({ cardNumber, expMonth, expYear, cvc });
        
        // Create Card
        let card = await create_card({ customerId: customer.id, tokenId: token.id });
        if( card ) {
          const paymentMethods = await stripe.customers.listPaymentMethods(
            customer.id,
            {type: 'card'}
          );

          // SetupIntent
          const setupIntent = await create_setup_intent(customer.id, paymentMethods.data[0].id); // Create SetupIntent
          
          await attach_payment_method(setupIntent.payment_method, customer.id); // Attach payment method to customer
          
          // await confirm_setup_intent(setupIntent.id, card.id); // Confirm SetupIntent 

          // Update Customer
          await update_customer_by_id({ customerId: customer.id, data: { default_source: card.id } });
          await Subscription.app.models.user.update({ "id": userId }, { currentPlan: plan });

          // Create Subscription
          const intervalValue = plan == "monthly" ? "month" : "year";
          const getCreatorPriceId = await Subscription.app.models.price_mapping.findOne({ where: { licenseType: "Creator", interval: intervalValue }});
          const getChampionPriceId = await Subscription.app.models.price_mapping.findOne({ where: { licenseType: "Champion", interval: intervalValue }});
          const priceArray = [
            { price: getCreatorPriceId.priceId, quantity: 1 },
            { price: getChampionPriceId.priceId, quantity: 0 },
          ];
          const subscription = await create_subscription({ customerId: customer.id, items: priceArray, sourceId: card.id });
          await Subscription.create({ userId, customerId: customer.id, cardId: card.id, tokenId: token.id, subscriptionId: subscription.id });

          // Successful Return
          return "Card saved successfully";
        }
      }
    }
    catch(err) {
      console.log(err);
    }
  }

  Subscription.getCards = async (userId) => {
    try {
      let userDetails = await Subscription.findOne({ where: { userId }});
      if (userDetails) {
        let cardDetails = await get_all_cards( userDetails.customerId );
        if (cardDetails) {
          return cardDetails;
        } else {
          throw Error("Card details not found..!!");
        }
      }
    } catch (err) {
      console.log(err);
      throw Error(err);
    }
  }

  Subscription.createPrice = async (nickname, amount, interval, userId, licenseType) => {
    try {
      // LicenseType - Creator/Champion
      // INTERVAL - Month/Year
      const allProducts = await get_all_products();
      const findProductByInterval = allProducts.findIndex(prod => prod.name == interval && prod.active == true );
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

  Subscription.updateSubscription = async (userId, licenseType, type) => {
    try {
      // LicenseType - Creator/Champion
      // Type - Add/Remove
      const findUser = await Subscription.findOne({ where: { userId }});
      const subscriptionDetails = await get_subscription_plan_by_id(findUser.subscriptionId);
      const itemsData = subscriptionDetails.items.data;

      let pricingArr = [];
      for( let i = 0; i < itemsData.length; i++ ) {
        let currentItem = itemsData[i];
        const findPricing = await Subscription.app.models.price_mapping.findOne( { where: { priceId: currentItem.price.id }} );

        if ( findPricing.licenseType == licenseType ) {
          pricingArr.push({
            id: currentItem.id,
            price: currentItem.price.id, 
            quantity: type.toLowerCase() == "add" ? currentItem.quantity + 1 : currentItem.quantity - 1
          });
        } else {
          pricingArr.push({
            id: currentItem.id,
            price: currentItem.price.id, 
            quantity: currentItem.quantity
          });
        }
      };

      let response = await update_subscription( findUser.subscriptionId, { items: pricingArr, cancel_at_period_end: false, proration_behavior: 'create_prorations' });
      return response;

    } catch (err) {
      console.log(err);
    }
  }

  Subscription.getSubscribedUsers = async (userId) => {
    try {
      const findUser = await Subscription.findOne({ where: { userId }});
      const subscriptionDetails = await get_subscription_plan_by_id(findUser.subscriptionId);
      const itemsData = subscriptionDetails.items.data;

      let userArr = {};
      let userArray = [];
      let interval = "";

      for( let i = 0; i < itemsData.length; i++ ) {
        let currentItem = itemsData[i];
        const findPricing = await Subscription.app.models.price_mapping.findOne( { where: { priceId: currentItem.price.id }} );
        interval = currentItem.plan.interval;
        userArr["interval"] = currentItem.plan.interval + "ly";

        if ( findPricing.licenseType == "Creator" ) {
          let newObj = {
            user: "Creator",
            quantity: currentItem.quantity,
            unit_amount: currentItem.price.metadata.unit_amount ? Number(currentItem.price.metadata.unit_amount) : null,
            total_amount: currentItem.price.metadata.unit_amount ? Number(currentItem.price.metadata.unit_amount) * currentItem.quantity : null,
            currency: currentItem.price.currency
          };
          userArray.push(newObj);
        } else {
          let newObj = {
            user: "Champion",
            quantity: currentItem.quantity,
            unit_amount: currentItem.price.metadata.unit_amount ? Number(currentItem.price.metadata.unit_amount) : null,
            total_amount: currentItem.price.metadata.unit_amount ? Number(currentItem.price.metadata.unit_amount) * currentItem.quantity : null,
            currency: currentItem.price.currency
          };
          userArray.push(newObj);
        }
      };

      // Finding Spectators from Application Database
      const findUserDetails = await Subscription.app.models.user.findOne({ where: { "id": userId }});
      const spectatorLicenseId = await Subscription.app.models.license.findOne({ where: { name: "Spectator" }});
      const findSpectatorsList = await Subscription.app.models.user.find({ where: { "licenseId": spectatorLicenseId.id, "companyId": findUserDetails.companyId }});
      let newObj = {
        user: "Spectators",
        quantity: findSpectatorsList.length,
        unit_amount: 0,
        total_amount: "Free",
        currency: "usd"
      };
      userArray.push(newObj);
      
      userArr["userDetails"] = userArray;

      return userArr;
    } catch (err) {
      console.log(err);
      throw Error(err);
    }
  }

  Subscription.getInvoices = async (userId) => {
    try {
      const subscriptionDetails = await Subscription.findOne({ where: { userId }});
      let invoices = await get_invoices( subscriptionDetails.customerId );
      if ( invoices.data.length > 0 ) {
        return invoices;
      } else {
        return [];
      }
    } catch (err) {
      console.log(err);
      throw Error(err);
    }
  }

  Subscription.getInvoicesForAdmin = async (page, limit) => {
    try {
      page = parseInt(page, 10) || 1;
      limit = parseInt(limit, 10) || 100;

      let invoices = await get_invoices_for_admin(page, limit);
      if ( invoices.data && invoices.data.length > 0 ) {

        let newArr = []; 
        for( let i = 0; i < invoices.data.length; i++) {
          let inv = invoices.data[i];
          let newObj = {
            planName: inv.lines.data[0].plan.nickname,
            price: inv.total,
            paymentDate : moment(inv.created * 1000),
            status: inv.status
          };

          let SubscriptionData = await Subscription.findOne({ where: { customerId: inv.customer }});

          if (SubscriptionData) {
            let UserData = await Subscription.app.models.user.findOne({ where: { id: SubscriptionData.userId }});
            newObj["username"] = UserData.fullName;
          } else {
            newObj["username"] = inv.customer_name;
          }

          newArr.push(newObj);
        }

        return newArr;
      } else {
        return [];
      }
    } catch (err) {
      console.log(err);
      throw Error(err);
    }
  }

  Subscription.getInvoicesForAdminChart = async (startDate, endDate) => {
    try {
      startDate = moment(new Date(startDate), 'DD.MM.YYYY').unix();
      endDate = moment(new Date(endDate), 'DD.MM.YYYY').unix();

      let finalMapping = [];
      let invoices = await get_invoices_for_admin_chart(startDate, endDate);

      if(invoices && invoices.data && invoices.data.length) {
        let invoice_obj = {};
        for (let i = 0; i < invoices.data.length; i++ ) {
          let date = moment(invoices.data[i].created * 1000).format("DD-MM-yyyy");
          if( invoice_obj[date] ) {
            invoice_obj[date] = invoice_obj[date] + invoices.data[i].amount_paid
          } else {
            invoice_obj[date] = invoices.data[i].amount_paid
          }
        }
  
        finalMapping = Object.keys(invoice_obj).map(data => {
          return {
            invoice_date: data,
            amount: invoice_obj[data]
          }
        });
      }

      return finalMapping;
    } catch (err) {
      console.log(err);
      throw Error(err);
    }
  }

  Subscription.getPrices = async () => {
    try {
      const priceMapping = await Subscription.app.models.price_mapping.find({ where : { licenseType: "Creator" }});
      let priceObj = {};
      for(let i = 0; i < priceMapping.length; i++ ) {
        const priceDetails = await get_price_by_id(priceMapping[i].priceId);
        priceObj[priceDetails.recurring.interval] = priceDetails.metadata.unit_amount
      }

      return priceObj;

    } catch(err) {
      console.log(err);
      return err;
    }
  }
};
