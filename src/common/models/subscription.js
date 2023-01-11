"use strict";
// const stripe = require("stripe")(process.env.STRIPE_API_KEY);
const stripe = require("stripe")("sk_test_51LuW5cSGltNYnTVRwbilCUIn5u4puvslqLb92mluDWYyF4bsm3PY2eyMKdKXT59CEST68nS3o08oK1YYXNcKdCtA00ZgArs8ha");
const https = require('https');
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
  get_invoices_for_admin_chart,
  create_payment_intent,
  confirm_payment_intent,
  create_refund
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
        if(token.statusCode == 402 || token.statusCode == 404) {
          let error = new Error(token.raw.message || "Card error..!!");
          error.status = 404;
          throw error;
        }

        // Create Card
        let card = await create_card({customerId: customer.id, tokenId: token.id});
        if(card.statusCode == 402 || card.statusCode == 404) {
          let error = new Error(card.raw.message || "Card error..!!");
          error.status = 404;
          throw error;
        }

        if(card) {
          // Confirm a payment from the Card
          const paymentIntent = await create_payment_intent(customer.id, card.id);
          if(paymentIntent.statusCode == 402 || paymentIntent.statusCode == 404) {
            let error = new Error(paymentIntent.raw.message || "Payment Intent error..!!");
            error.status = 404;
            throw error;
          }

          if (paymentIntent.status == "succeeded") {
            // Payment Refund
            const refundData = await create_refund(paymentIntent.id); 
            if(refundData.statusCode == 402 || refundData.statusCode == 404) {
              let error = new Error(refundData.raw.message || "Refund Payment error..!!");
              error.status = 404;
              throw error;
            }

            // Update Customer & Subscription
            await update_customer_by_id({ customerId: findUser.customerId, data: { default_source: card.id } });
            if (findUser.subscriptionId) {
              await update_subscription({ subcriptionId: findUser.subscriptionId, data: { default_source: card.id } });
            }
            await Subscription.update({ where: { userId }}, { tokenId: token.id, cardId: card.id });
  
            // Successful Return
            return {message: "Card saved successfully", data: null};

          } else {
            let error = new Error(paymentIntent.raw.message || "Card error..!!");
            error.status = 404;
            throw error;
          }
        }
      } else {
        // Creating Test Clock for testing
        const testClock = await stripe.testHelpers.testClocks.create({
          frozen_time: Math.floor(Date.now() / 1000), // Integer Unix Timestamp
        });

        // Create Customer on Stripe
        let customer = await create_customer({ name: fullName, description: `Welcome to stripe, ${fullName}`, address: {}, clock: testClock.id });
        // let customer = await create_customer({ name: fullName, description: `Welcome to stripe, ${fullName}`, address: {} });

        // Create a token
        let [ expMonth, expYear ] = expirationDate.split("/");
        let token = await create_token({ cardNumber, expMonth, expYear, cvc });
        if(token.statusCode == 402 || token.statusCode == 404) {
          let error = new Error(token.raw.message || "Card error..!!");
          error.status = 404;
          throw error;
        }
        
        // Create Card
        let card = await create_card({ customerId: customer.id, tokenId: token.id });
        if(card.statusCode == 402 || card.statusCode == 404) {
          let error = new Error(card.raw.message || "Card error..!!");
          error.status = 404;
          throw error;
        }
        if( card ) {
          // Update Customer
          await update_customer_by_id({ customerId: customer.id, data: { default_source: card.id } });

          // Confirm a payment from the Card
          const paymentIntent = await create_payment_intent(customer.id, card.id);
          if(paymentIntent.statusCode == 402 || paymentIntent.statusCode == 404) {
            let error = new Error(paymentIntent.raw.message || "Payment Intent error..!!");
            error.status = 404;
            throw error;
          }

          if (paymentIntent.status == "succeeded") {
            // Payment Refund
            const refundData = await create_refund(paymentIntent.id); 
            if(refundData.statusCode == 402 || refundData.statusCode == 404) {
              let error = new Error(refundData.raw.message || "Refund Payment error..!!");
              error.status = 404;
              throw error;
            }

            // Create Subscription and update user plan
            await Subscription.app.models.user.update({ "id": userId }, { currentPlan: plan });
            await Subscription.create({ userId, customerId: customer.id, cardId: card.id, tokenId: token.id, trialEnds: moment().subtract(2, 'days').unix(), trialActive: true });
  
            // Successful Return
            return {message: "Card saved successfully", data: null};
          } else {
            let error = new Error(paymentIntent.raw.message || "Card error..!!");
            error.status = 404;
            throw error;
          }
        }
      }
    }
    catch(err) {
      console.log(err);
      throw Error(err);
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

  Subscription.createSubscription = async (userId, plan) => {
    try {
      // PLAN - Monthly/Yearly

      const subscriptionData = await Subscription.findOne({ where: { userId }}); // Fetching card details
      const userDetails = await Subscription.app.models.user.findOne({ where: { id: userId }}); // Fetching user details for companyId
      const allUsersOfCompany = await Subscription.app.models.user.find({ where: { companyId: userDetails.companyId }}); // All users of same company

      let userRoleMapping = {
        Creator: 0,
        Champion: 0,
      };

      for( let i = 0; i < allUsersOfCompany.length; i++ ) {
        let currentUser = allUsersOfCompany[i];
        let currentLicense = await Subscription.app.models.license.findOne({ where: { id: currentUser.licenseId } });
        if (userRoleMapping.hasOwnProperty(currentLicense.name)) {
          userRoleMapping[currentLicense.name] = userRoleMapping[currentLicense.name] + 1;
        }
      }

      // Create Payment methods
      const paymentMethods = await stripe.customers.listPaymentMethods(
        subscriptionData.customerId,
        { type: 'card' }
      );

      // SetupIntent
      const setupIntent = await create_setup_intent(subscriptionData.customerId, paymentMethods.data[0].id); // Create SetupIntent
      await attach_payment_method( setupIntent.payment_method, subscriptionData.customerId ); // Attach payment method to customer
      // await confirm_setup_intent(setupIntent.id, card.id); // Confirm SetupIntent 

      // Create Subscription
      const intervalValue = plan == "monthly" ? "month" : "year";
      // const getCreatorTrialPriceId = await Subscription.app.models.price_mapping.findOne({ where: { licenseType: "Creator-Trial", interval: intervalValue }});
      const getCreatorPriceId = await Subscription.app.models.price_mapping.findOne({ where: { licenseType: "Creator", interval: intervalValue }});
      const getChampionPriceId = await Subscription.app.models.price_mapping.findOne({ where: { licenseType: "Champion", interval: intervalValue }});
      const priceArray = [
        // { price: getCreatorTrialPriceId.priceId, quantity: 1 },
        { price: getCreatorPriceId.priceId, quantity: userRoleMapping.Creator },
        { price: getChampionPriceId.priceId, quantity: userRoleMapping.Champion },
      ];
      const subscription = await create_subscription({ customerId: customer.id, items: priceArray, sourceId: card.id });
      await Subscription.update({ id: subscriptionData.id } , { subscriptionId: subscription.id });

      return "Subscription created successfully..!!";

    } catch (err) {
      console.log(err);
      throw Error(err);
    }
  }

  Subscription.updateSubscription = async (userId, licenseType, type) => {
    try {
      // LicenseType - Creator/Champion
      // Type - Add/Remove
      const findUser = await Subscription.findOne({ where: { userId }});

      if ( !findUser.trialActive && findUser.status ) {
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
  
        let response = await update_subscription( findUser.subscriptionId, { items: pricingArr, cancel_at_period_end: false, proration_behavior: 'none' });
        return response;
      } else {
        return { message: "User is on trial period..!!", data: null };
      }

    } catch (err) {
      console.log(err);
    }
  }

  Subscription.getSubscribedUsers = async (userId) => {
    try {
      const findUser = await Subscription.findOne({ where: { userId, subscriptionId: { exists: true } }});
      if (findUser) {
      
        const subscriptionDetails = await get_subscription_plan_by_id(findUser.subscriptionId);
        if(subscriptionDetails) {
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
          return { message: "Data found..!!", data: userArr };
        } else {
          return { message: "No Data found..!!", data: null };
        }
      } else {
        // Finding Registered Users from Application Database
        const findUserDetails = await Subscription.app.models.user.findOne({ where: { "id": userId }});
        const findRegisteredUserDetails = await Subscription.app.models.user.find({ where: { "companyId": findUserDetails.companyId }});
        let userObj = {};
        let tracker = {
          Creator: {
            user: "Creator",
            quantity: 0,
            unit_amount: null,
            total_amount: null,
            currency: null
          },
          Champion: {
            user: "Champion",
            quantity: 0,
            unit_amount: null,
            total_amount: null,
            currency: null
          },
          Spectator: {
            user: "Spectator",
            quantity: 0,
            unit_amount: null,
            total_amount: null,
            currency: null
          }
        };
        for(let i = 0; i < findRegisteredUserDetails.length; i++) {
          let currentUser = findRegisteredUserDetails[i];
          const licenseId = await Subscription.app.models.license.findOne({ where: { id: currentUser.licenseId }});
          tracker[licenseId.name] = {...tracker[licenseId.name], quantity: tracker[licenseId.name].quantity + 1 };
        }

        let userDetails = Object.keys(tracker).map(x => tracker[x]);
        userObj["userDetails"] = userDetails;
        return { message: "Data found..!!", data: userObj };
      }
    } catch (err) {
      console.log(err);
      throw Error(err);
    }
  }

  Subscription.getInvoices = async (userId) => {
    try {
      const subscriptionDetails = await Subscription.findOne({ where: { userId }});
      if(subscriptionDetails) {
        let invoices = await get_invoices( subscriptionDetails.customerId );
        if ( invoices.data.length > 0 ) {
          return invoices;
        } else {
          return [];
        }
      } else return [];
    } catch (err) {
      console.log(err);
      throw Error(err);
    }
  }

  Subscription.getInvoicesForAdmin = async (page, limit, previousId, nextId) => {
    try {
      page = parseInt(page, 10) || 1;
      limit = parseInt(limit, 10) || 10;

      let invoices = await get_invoices_for_admin(page, limit, previousId, nextId);
      if ( invoices.data && invoices.data.length > 0 ) {

        let newArr = [];
        for( let i = 0; i < invoices.data.length; i++) {
          let inv = invoices.data[i];
          let newObj = {
            id: inv.id,
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
        };

        let finalData = [{
            metadata: [{
              total: invoices.total_count || 0,
              page: page || 0,
              count: newArr.length
            }],
            data: newArr
        }];

        return finalData;
      } else {
        return [{
          metadata: [],
          data: []
        }];
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
        invoices.data = invoices.data.sort((a,b) => {
          return a.created - b.created;
        });
        for (let i = 0; i < invoices.data.length; i++ ) {
          let date = moment(invoices.data[i].created * 1000).format("MM-DD-yyyy");
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
      throw Error(err);
    }
  }

  Subscription.getPricesForAdmin = async () => {
    try {
      const priceMapping = await Subscription.app.models.price_mapping.find({});
      let priceObj = [];
      for(let i = 0; i < priceMapping.length; i++ ) {
        const priceDetails = await get_price_by_id(priceMapping[i].priceId);
        if ( priceDetails.statusCode >= 400 || priceDetails.statusCode < 500 ) {
          let error = new Error(priceDetails.raw.message || "Plans fetching error..!!");
          error.status = 404;
          throw error;
        }
        priceObj.push({
          name: priceDetails.nickname,
          price: priceDetails.metadata.unit_amount,
          createdAt: moment(priceDetails.created * 1000).format("DD-MM-YYYY"),
          status: priceDetails.active
        });
      }
      return priceObj;
    } catch(err) {
      console.log(err);
      throw Error(err);
    }
  }
};
