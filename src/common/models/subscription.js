"use strict";
const stripe = require("stripe")(process.env.STRIPE_API_KEY);
const { sendEmail } = require('../../helper/sendEmail');
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
  get_all_cards,
  attach_payment_method,
  get_subscription_plan_by_id,
  get_price_by_id,
  get_invoices,
  get_invoices_for_admin,
  get_invoices_for_admin_chart,
  create_payment_intent,
  create_refund,
  update_price_by_id,
  cancel_user_subscription,
  delete_card,
  create_source
} = require("../../helper/stripe");
const moment = require('moment');
const { sales_delete_user } = require("../../helper/salesforce");

module.exports = function (Subscription) {
  // Find user who is not deleted
  const FIND_ONLY_NOT_DELETED_USERS = {
    $match: { $or: [ { "is_deleted" : { $exists: false } }, { "is_deleted" : false } ] }
  }

   // License lookup
   const LICENSE_LOOKUP = {
    $lookup: {
      from: 'license',
      localField: 'licenseId',
      foreignField: '_id',
      as: 'license'
    },
  }

  const UNWIND_LICENSE = {
    $unwind: {
      path: "$license"
    }
  }

  Subscription.saveCard = async (userId, cardNumber, expirationDate, fullName, cvc, plan) => {
    // PLAN - Monthly/Yearly
    try {
      const userDetails = await Subscription.app.models.user.findOne({ where: { "id": userId }, include: "company" });
      const findUser = await Subscription.findOne({ where: { companyId: userDetails.companyId, cardHolder: true }});
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
        let card = await create_card({customerId: findUser.customerId, tokenId: token.id});
        if(card.statusCode == 402 || card.statusCode == 404) {
          let error = new Error(card.raw.message || "Card error..!!");
          error.status = 404;
          throw error;
        }

        if(card) {
          const previousCardId = findUser.cardId;
          // Confirm a payment from the Card
          const paymentIntent = await create_payment_intent(findUser.customerId, card.id, 50);
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
            const allCardUsers = await Subscription.find({ where: { cardId: findUser.cardId}});
            await update_customer_by_id({ customerId: findUser.customerId, data: { default_source: card.id } });
            for(let user in allCardUsers) {
              if ( !user.trialActive && user.status ) {
                await update_subscription(user.subscriptionId, { default_source: card.id, proration_behavior: 'none' });
                await Subscription.app.models.user.update({ "id": user.userId }, { paymentFailed: false });
              }
              await Subscription.update({ userId: user.userId }, { tokenId: token.id, cardId: card.id });
            }

            // Delete the Previous Card
            await delete_card(findUser.customerId, previousCardId);
  
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
        let testClock = null;
        // testClock = await stripe.testHelpers.testClocks.create({
        //   frozen_time: Math.floor(Date.now() / 1000), // Integer Unix Timestamp
        // });

        // Create Customer on Stripe
        let customerObj = { name: fullName, description: `Welcome to stripe, ${fullName}`, address: {}};
        testClock ? customerObj["clock"] = testClock.id : null;
        let customer = await create_customer(customerObj);

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
          const paymentIntent = await create_payment_intent(customer.id, card.id, 50);
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
            const trialData = await Subscription.app.models.trial_period.findOne({});
            const trialDays = trialData ? moment().add(trialData.days, 'days').unix() : moment().add(14, 'days').unix();
            await Subscription.app.models.user.update({ "id": userId }, { currentPlan: plan });
            let subscriptionObj = { 
              userId, 
              customerId: customer.id, 
              cardId: card.id, 
              tokenId: token.id, 
              trialEnds: moment().add(4, 'minutes').unix(), 
              // trialEnds: trialDays,
              trialActive: true,
              companyId: userDetails.companyId,
              cardHolder: true,
              currentPlan: plan,
              licenseId: userDetails.licenseId
            };
            testClock ? subscriptionObj["testClock"] = testClock.id : null;
            await Subscription.create(subscriptionObj);

            const superAdmin = await Subscription.app.models.user.findOne({ where: { licenseId: { exists : false }, companyId: { exists : false } }});
            const emailObj = {
              subject: `A new user has signed up..!!`,
              template: "admin-notify.ejs",
              email: superAdmin.email,
              user: userDetails,
              admin: superAdmin,
              company: userDetails.company().name
            };
            sendEmail(Subscription.app, emailObj, () => {});
  
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
      throw err;
    }
  }

  Subscription.getCards = async (companyId) => {
    try {
      let userDetails = await Subscription.findOne({ where: { companyId }});
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

  Subscription.createSubscription = async (userId) => {
    try {
      // 1. Get User Details and get Company Id
      const findUser = await Subscription.app.models.user.findOne({ where: { id: userId }});
      // 2. Get Card Holder details from Subscription of that companyId
      const cardHolder = await Subscription.findOne({ where: { companyId: findUser.companyId, cardHolder: true }});
      // 3. Check if the company admin is on trial
      if ( !cardHolder.trialActive && cardHolder.status ) {
        let subscriptionObj = { 
          userId, 
          customerId: cardHolder.customerId, 
          cardId: cardHolder.cardId, 
          tokenId: cardHolder.tokenId, 
          trialEnds: cardHolder.trialEnds, 
          trialActive: cardHolder.trialActive,
          companyId: findUser.companyId,
          cardHolder: false,
          currentPlan: cardHolder.currentPlan,
          licenseId: findUser.licenseId
        };
        cardHolder.testClock ? subscriptionObj["testClock"] = cardHolder.testClock : null;
        Subscription.create(subscriptionObj);

        const license = await Subscription.app.models.license.findOne({ where: { id: findUser.licenseId }});
        const priceData = await Subscription.app.models.price_mapping.findOne({ where: { licenseType: license.name, interval: cardHolder.currentPlan == "monthly" ? "month" : "year" }});
        let subscription = await create_subscription({ customerId: cardHolder.customerId, items: [{price: priceData.priceId, quantity: 1}] });
        await Subscription.app.models.subscription.update({ "userId": userId }, { subscriptionId: subscription.id, status: true, trialActive: false });

        return "Subscription created successfully..!!";
      } else {
        let subscriptionObj = { 
          userId, 
          customerId: cardHolder.customerId, 
          cardId: cardHolder.cardId, 
          tokenId: cardHolder.tokenId, 
          trialEnds: cardHolder.trialEnds, 
          trialActive: cardHolder.trialActive,
          companyId: findUser.companyId,
          cardHolder: false,
          currentPlan: cardHolder.currentPlan,
          licenseId: findUser.licenseId
        }
        cardHolder.testClock ? subscriptionObj["testClock"] = cardHolder.testClock : null;
        await Subscription.create(subscriptionObj);
        return "User is on trial period..!!";
      }
    } catch (err) {
      console.log(err);
      throw Error(err);
    }
  }

  Subscription.updateSubscription = async (userId, licenseName) => {
    try {
      // 1. Find user subscription
      let userSubscription = await Subscription.findOne({ where: { userId }});
      if (userSubscription) {

        if (licenseName !== "Spectator") {
          // If Switching between Creator to Champion or vice verse
          let license = await Subscription.app.models.license.findOne({ where: { name: licenseName }});
          let newPriceId = await Subscription.app.models.price_mapping.findOne({ where: { licenseType: licenseName, interval: userSubscription.currentPlan == "monthly" ? "month" : "year" }});

          // ------------------- Old Code -----------------------
          // const getSubscriptionDetails = await get_subscription_plan_by_id(userSubscription.subscriptionId);
          cancel_user_subscription(userSubscription.subscriptionId);
          // let updatedItems = [];
          // for( let j = 0; j < getSubscriptionDetails.items.data.length; j++ ) {
          //   updatedItems.push({
          //     id: getSubscriptionDetails.items.data[j].id,
          //     price: newPriceId.priceId
          //   });
          // }
          // if ( updatedItems.length > 0 ) {
          //   await update_subscription(userSubscription.subscriptionId, { items: updatedItems, proration_behavior: 'none' });
          // }
          // await Subscription.update({ userId , trialActive: false, status: true }, { licenseId: license.id });
          // ------------------- Old Code -----------------------

          let subscription = await create_subscription({ customerId: userSubscription.customerId, items: [{price: newPriceId.priceId, quantity: 1}] });
          await Subscription.update({ "userId": userId }, { subscriptionId: subscription.id, licenseId: license.id });

          return "Subscription updated successfully..!!";
        } else {

          // If switching from Creator/Champion to Spectator
          await cancel_user_subscription(userSubscription.subscriptionId);
          await Subscription.deleteAll({ userId });

          return "Subscription updated successfully..!!";
        }

      } else {
        // If switching from Spectator to Creator/Champion

        let userDetails = await Subscription.app.models.user.findOne({ where: { id: userId }});
        // 1. Find cardHolder subscription
        const cardHolder = await Subscription.findOne({ where: { companyId: userDetails.companyId, cardHolder: true }});
        if (cardHolder.subscriptionId && cardHolder.subscriptionId !== "deactivated" && cardHolder.status == true) {
          let subscriptionObj = { 
            userId, 
            customerId: cardHolder.customerId, 
            cardId: cardHolder.cardId, 
            tokenId: cardHolder.tokenId, 
            trialEnds: cardHolder.trialEnds, 
            trialActive: cardHolder.trialActive,
            companyId: userDetails.companyId,
            cardHolder: false,
            currentPlan: cardHolder.currentPlan,
            licenseId: userDetails.licenseId
          }
          cardHolder.testClock ? subscriptionObj["testClock"] = cardHolder.testClock : null;
  
          await Subscription.create(subscriptionObj);
          const license = await Subscription.app.models.license.findOne({ where: { id: userDetails.licenseId }});
          const priceData = await Subscription.app.models.price_mapping.findOne({ where: { licenseType: license.name, interval: cardHolder.currentPlan == "monthly" ? "month" : "year" }});
          let subscription = await create_subscription({ customerId: cardHolder.customerId, items: [{price: priceData.priceId, quantity: 1}] });
          await Subscription.app.models.subscription.update({ "userId": userId }, { subscriptionId: subscription.id, status: true, trialActive: false });
          return "Subscription updated successfully..!!";
        } else {
          let subscriptionObj = { 
            userId, 
            customerId: cardHolder.customerId, 
            cardId: cardHolder.cardId, 
            tokenId: cardHolder.tokenId, 
            trialEnds: cardHolder.trialEnds, 
            trialActive: cardHolder.trialActive,
            companyId: userDetails.companyId,
            cardHolder: false,
            currentPlan: cardHolder.currentPlan,
            licenseId: userDetails.licenseId
          }
          cardHolder.testClock ? subscriptionObj["testClock"] = cardHolder.testClock : null;
  
          await Subscription.create(subscriptionObj);
          return "Subscription updated successfully..!!";
        }
      }
    } catch (err) {
      console.log(err);
      throw Error(err);
    }
  }

  Subscription.blockSubscription = async (userId) => {
    try {
      const userDetails = await Subscription.findOne({ where: { userId }});
      if (userDetails && userDetails.subscriptionId && userDetails.subscriptionId !== "deactivated" && userDetails.status == true ) {
        if (userDetails.cardHolder) {
          let findCompany = await Subscription.find({ where: { companyId: userDetails.companyId }});
          for(let user of findCompany) {
            await cancel_user_subscription( user.subscriptionId );
            await Subscription.update({ userId: user.userId }, { subscriptionId: "deactivated", status: false });
          }
          return "Subscription has been cancelled..!!";
        } else {
          await cancel_user_subscription( userDetails.subscriptionId );
          await Subscription.update({ userId }, { subscriptionId: "deactivated", status: false });
          return "Subscription has been cancelled..!!";
        }
      }
    } catch (err) {
      console.log(err);
      throw err;
    }
  }

  Subscription.deleteSubscription = async (userId) => {
    try {
      const userDetails = await Subscription.findOne({ where: { userId }});
      if (userDetails) {
        if(userDetails.subscriptionId && userDetails.subscriptionId !== "deactivated" && userDetails.status == true ) {
          await cancel_user_subscription( userDetails.subscriptionId );
        }
        await Subscription.deleteAll({ userId });
        return "Subscription has been deleted..!!";
      }
    } catch (err) {
      console.log(err);
      throw err;
    }
  }

  Subscription.unblockSubscription = async (userId) => {
    try {
      const userDetails = await Subscription.findOne({ where: { userId }});
      const findUser = await Subscription.app.models.user.findOne({ where: { id: userId }});
      const cardHolder = await Subscription.findOne({ where: { companyId: findUser.companyId, cardHolder: true }});

      if (userDetails && userDetails.subscriptionId && userDetails.trialActive == false ) {
        if(userDetails.cardHolder) {
          const findCompany = await Subscription.find({ where: { companyId: userDetails.companyId }});
          for ( let user of findCompany) {
            const license = await Subscription.app.models.license.findOne({ where: { id: user.licenseId }});
            const priceData = await Subscription.app.models.price_mapping.findOne({ where: { licenseType: license.name, interval: cardHolder.currentPlan == "monthly" ? "month" : "year" }});
            let subscription = await create_subscription({ customerId: cardHolder.customerId, items: [{price: priceData.priceId, quantity: 1}] });
            await Subscription.app.models.subscription.update({ "userId": user.userId }, { subscriptionId: subscription.id, status: true, trialActive: false });
          }
          return "Subscription created successfully..!!";
        } else {
          const license = await Subscription.app.models.license.findOne({ where: { id: findUser.licenseId }});
          const priceData = await Subscription.app.models.price_mapping.findOne({ where: { licenseType: license.name, interval: cardHolder.currentPlan == "monthly" ? "month" : "year" }});
          let subscription = await create_subscription({ customerId: cardHolder.customerId, items: [{price: priceData.priceId, quantity: 1}] });
          await Subscription.app.models.subscription.update({ "userId": userId }, { subscriptionId: subscription.id, status: true, trialActive: false });
          return "Subscription created successfully..!!";
        }
      } else {
        let error = new Error("User not found..!!");
        error.status = 404;
        throw error;
      }
    } catch (err) {
      console.log(err);
      throw err;
    }
  }

  Subscription.getSubscribedUsers = async (companyId) => {
    try {
      const cardHolder = await Subscription.findOne({ where: { companyId , cardHolder: true }});
      if (cardHolder) {
        const findUsers = await Subscription.find({ where: { companyId }, include: ["license", {relation: "user", scope: { where: { is_deleted: false }}}] });
        let userObj = {
          interval: ""
        };
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
            user: "Spectators",
            quantity: 0,
            unit_amount: 0,
            total_amount: "Free",
            currency: "usd"
          }
        };
        if ( cardHolder.status == true && cardHolder.trialActive == false ) {
          for ( let i = 0; i < findUsers.length; i++) {
            let currentUser = findUsers[i];
            let licenseName = currentUser.license().name;
            let interval = currentUser.currentPlan;
            let priceDetails = await Subscription.app.models.price_mapping.findOne({ where: { licenseType: licenseName, interval: interval == "monthly" ? "month" : "year" } });
            let priceDataFromStripe = await get_price_by_id(priceDetails.priceId);
            tracker[licenseName].quantity = tracker[licenseName].quantity + 1;
            tracker[licenseName].unit_amount = priceDataFromStripe.metadata.unit_amount;
            tracker[licenseName].total_amount ? (tracker[licenseName].total_amount = Number(tracker[licenseName].total_amount) + Number(priceDataFromStripe.metadata.unit_amount)) : (tracker[licenseName].total_amount = Number(priceDataFromStripe.metadata.unit_amount));
            tracker[licenseName].currency = "usd";

            userObj.interval ? null : userObj.interval = currentUser.currentPlan;
          }

          if (tracker["Champion"].quantity == 0) {
            let interval = userObj.interval;
            let priceDetails = await Subscription.app.models.price_mapping.findOne({ where: { licenseType: "Champion", interval: interval == "monthly" ? "month" : "year" } });
            let priceDataFromStripe = await get_price_by_id(priceDetails.priceId);
            tracker["Champion"].quantity = tracker["Champion"].quantity;
            tracker["Champion"].unit_amount = priceDataFromStripe.metadata.unit_amount;
            tracker["Champion"].total_amount = 0;
            tracker["Champion"].currency = "usd";
          }
        } else {
          for ( let i = 0; i < findUsers.length; i++) {
            let currentUser = findUsers[i];
            let licenseName = currentUser.license().name;
            let interval = currentUser.currentPlan;
            let priceDetails = await Subscription.app.models.price_mapping.findOne({ where: { licenseType: licenseName, interval: interval == "monthly" ? "month" : "year" } });
            let priceDataFromStripe = await get_price_by_id(priceDetails.priceId);
            tracker[licenseName].quantity = tracker[licenseName].quantity + 1;
            tracker[licenseName].unit_amount = priceDataFromStripe.metadata.unit_amount;
            tracker[licenseName].total_amount = 0;
            tracker[licenseName].currency = "usd";

            userObj.interval ? null : userObj.interval = currentUser.currentPlan;
          }

          if (tracker["Champion"].quantity == 0) {
            let interval = userObj.interval;
            let priceDetails = await Subscription.app.models.price_mapping.findOne({ where: { licenseType: "Champion", interval: interval == "monthly" ? "month" : "year" } });
            let priceDataFromStripe = await get_price_by_id(priceDetails.priceId);
            tracker["Champion"].quantity = tracker["Champion"].quantity;
            tracker["Champion"].unit_amount = priceDataFromStripe.metadata.unit_amount;
            tracker["Champion"].total_amount = 0;
            tracker["Champion"].currency = "usd";
          }

          userObj.interval = "Trial";
        }

        // Finding Spectators List
        const spectatorLicense = await Subscription.app.models.license.findOne({ where: { name: "Spectator" }});
        const findSpectators = await Subscription.app.models.user.find({ where: { companyId, licenseId: spectatorLicense.id, is_deleted: false }, include: "license" });
        tracker["Spectator"].quantity = findSpectators.length;

        let userDetails = Object.keys(tracker).map(x => tracker[x]);
        userObj["userDetails"] = userDetails;
        return { message: "Data found..!!", data: userObj };
      } else {
        let error = new Error("Card holder not found..!!");
        error.status = 404;
        throw error;
      }
    } catch (err) {
      console.log(err);
      throw err;
    }
  }

  Subscription.getOfflineUsers = (userId, next) => {
      Subscription.app.models.user.findById(userId, (err, user) => {
        if (err) return next(err);
        else {
          userId = Subscription.getDataSource().ObjectID(userId);
          let query = {};
          user.departmentId ? query = { "companyId": user.companyId, "departmentId": user.departmentId } : query = { "companyId": user.companyId };

          Subscription.getDataSource().connector.connect(function(err, db) {
            const userCollection = db.collection('user');
            userCollection.aggregate([
              { 
                $match: query
              },
              FIND_ONLY_NOT_DELETED_USERS,
              LICENSE_LOOKUP,
              UNWIND_LICENSE,
            ]).toArray((err, result) => {

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

              result.map( async x => {
                tracker[x.license.name] = {...tracker[x.license.name], quantity: tracker[x.license.name].quantity + 1 };
              });

              let userDetails = Object.keys(tracker).map(x => tracker[x]);
              userObj["userDetails"] = userDetails;
              next(err, userObj);
            });
          });
        }
      });
  }

  Subscription.getInvoices = async (companyId) => {
    try {
      const subscriptionDetails = await Subscription.findOne({ where: { companyId, cardHolder: true }});
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

  // ------------------- ADMIN PANEL APIS -------------------

  Subscription.getInvoicesForAdmin = (page, limit, searchQuery, previousId, nextId, startDate = null, endDate = null, next) => {
    page = parseInt(page, 10) || 1;
    limit = parseInt(limit, 10) || 10;
    startDate = moment(new Date(startDate), 'DD.MM.YYYY').unix();
    endDate = moment(new Date(endDate), 'DD.MM.YYYY').unix();

    let search_query = searchQuery ? searchQuery.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : "";

    Subscription.getDataSource().connector.connect(async function (err, db) {
      const UserCollection = db.collection('company');
      await UserCollection.aggregate([
        {
          $match: {
            'name': {
              $regex: '^' + search_query,
              $options: 'i'
            }
          }
        }
      ]).toArray(async (err, result) => {
        if(err) {
          console.log('> error while finding karta contributors', err);
          next(err);
        }
        let customerId = "";
        if (result.length > 0 && search_query) {
          let subscriptionData = await Subscription.findOne({ where: { companyId: result[0]._id, cardHolder: true }});
          if (subscriptionData.customerId) customerId = subscriptionData.customerId;
        }

        if (result.length == 0 && search_query) {
          next(null, [{
            metadata: [],
            data: []
          }]);
        }

        let invoices = await get_invoices_for_admin(page, limit, customerId, previousId, nextId, startDate, endDate);
        if ( invoices.data && invoices.data.length > 0 ) {

          let newArr = [];
          for( let i = 0; i < invoices.data.length; i++) {
            let inv = invoices.data[i];
            let newObj = {
              id: inv.id,
              planName: inv.lines.data[0].plan.nickname,
              price: Number(inv.total) / 100,
              paymentDate : moment(inv.created * 1000),
              status: inv.status,
            };

            let SubscriptionData = await Subscription.findOne({ where: { customerId: inv.customer }});

            if (SubscriptionData) {
              let UserData = await Subscription.app.models.user.findOne({ where: { id: SubscriptionData.userId }, include: "company" });
              newObj["username"] = UserData.fullName;
              newObj["companyName"] = UserData.company().name;
            } else {
              newObj["username"] = inv.customer_name;
              newObj["companyName"] = "N/A";
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

          next(null, finalData);
        } else {
          next(null, [{
            metadata: [],
            data: []
          }]);
        }
      });
    });
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
            invoice_obj[date] = Number(invoice_obj[date]) + Number(invoices.data[i].amount_paid / 100)
          } else {
            invoice_obj[date] = Number(invoices.data[i].amount_paid) / 100
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
          status: priceDetails.active,
          priceId: priceDetails.id,
          duration: priceDetails.recurring.interval
        });
      }
      return priceObj;
    } catch(err) {
      console.log(err);
      throw Error(err);
    }
  }

  Subscription.getPriceByIdForAdmin = async (priceId) => {
    try {
      const priceMapping = await Subscription.app.models.price_mapping.findOne({where: { priceId }});
      const priceDetails = await get_price_by_id(priceMapping.priceId);
      if ( priceDetails.statusCode >= 400 || priceDetails.statusCode < 500 ) {
        let error = new Error(priceDetails.raw.message || "Plans fetching error..!!");
        error.status = 404;
        throw error;
      }
      let priceObj = {
        name: priceDetails.nickname,
        price: priceDetails.metadata.unit_amount,
        createdAt: moment(priceDetails.created * 1000).format("DD-MM-YYYY"),
        status: priceDetails.active,
        priceId: priceDetails.id
      };
      return priceObj;
    } catch(err) {
      console.log(err);
      throw Error(err);
    }
  }

  Subscription.updatePlansByAdmin = async (priceId, amount, name) => {
    try {
      // ALGO
      // 1. Find the Price details in DB
      const priceMapping = await Subscription.app.models.price_mapping.findOne({ where: { priceId }});

      // 2. Create a new price for that product in Stripe
      const newPrice = await create_price(name, priceMapping.productId, amount, priceMapping.interval);

      // 3. Update the new priceId for every subscription on stripe
      const subscriptionsList = await Subscription.find({ trialActive: false , status: true });

      for (let i = 0; i < subscriptionsList.length; i++ ) {
        let currentSubscription = subscriptionsList[i];
        if (currentSubscription.subscriptionId && currentSubscription.subscriptionId !== "deactivated") {
          const getSubscriptionDetails = await get_subscription_plan_by_id(currentSubscription.subscriptionId);
          let updatedItems = [];
          for( let j = 0; j < getSubscriptionDetails.items.data.length; j++ ) {
            if( getSubscriptionDetails.items.data[j].price.id == priceId ) {
              updatedItems.push({
                id: getSubscriptionDetails.items.data[j].id,
                price: newPrice.id
              });
            }
          }

          if ( updatedItems.length > 0 ) {
            await update_subscription(currentSubscription.subscriptionId, { items: updatedItems, proration_behavior: 'none' });
          }
        }
      }

      // 4. Update the new priceid in DB
      await Subscription.app.models.price_mapping.update({ priceId }, { priceId: newPrice.id });

      // 5. Deactivate the old price in stripe
      await update_price_by_id(priceId, { active: false });

      return "Price updated successfully..!!";
    } catch(err) {
      console.log(err);
      throw err;
    }
  }

  Subscription.cancelSubscription = async (userId) => {
    try {
      // Find user's subscription details
      const subscriptionDetails = await Subscription.findOne({ where: { userId, subscriptionId: { exists: true }, status: true }});
      
      if( subscriptionDetails ) {
        // Make the remaining payment before subscription cancellation
        const subscriptionStripeDetails = await get_subscription_plan_by_id(subscriptionDetails.subscriptionId);

        if(subscriptionStripeDetails.latest_invoice) {
          const amountInCents = subscriptionStripeDetails.latest_invoice.amount_due ? Number(subscriptionStripeDetails.latest_invoice.amount_due) : null;
          if(amountInCents) {
            // Calculating amount based on Usage
            const startSubscription = moment(moment.unix(subscriptionDetails.nextSubscriptionDate));
            const endSubscription = moment(moment.unix(subscriptionDetails.currentSubscriptionDate));
            let oneDayAmount = amountInCents / startSubscription.diff(endSubscription, 'days');
            let currDate = moment();
            const amountToBePaid = oneDayAmount * startSubscription.diff(currDate, 'days');
            
            const paymentIntent = await create_payment_intent(subscriptionDetails.customerId, subscriptionDetails.cardId, amountToBePaid );
            if(paymentIntent.statusCode == 402 || paymentIntent.statusCode == 404) {
              let error = new Error(paymentIntent.raw.message || "Payment Intent error..!!");
              error.status = 404;
              throw error;
            }
            // if (paymentIntent.status == "succeeded") {}
          }
        }

        const cancelSubscription = await cancel_user_subscription(subscriptionDetails.subscriptionId);
        if ( cancelSubscription.statusCode >= 400 || cancelSubscription.statusCode < 500 ) {
          let error = new Error(priceDetails.raw.message || "Subscription cancellation error..!!");
          error.status = 404;
          throw error;
        }

        await Subscription.update({ userId, status: true }, { status: false, subscriptionId: "deactivated" });
        return "Subscription deactivated successfully..!!";

      } else {
        return "User not found with a subscription..!!";
        // let error = new Error("User not found with a subscription");
        // error.status = 404;
        // throw error;
      }
    } catch (err) {
      console.log(err);
      throw err;
    }
  }

  Subscription.getUserCount = async () => {
    try {
      let userCount = {
        "Free": 0,
        "Paid": 0
      };

      // Fetching paid licenses
      let paidLicense = await Subscription.app.models.license.find({ where: { or: [ {"name": "Creator"} , {"name": "Champion"} ] } });
      paidLicense = paidLicense.map(item => item.id);
      userCount["Paid"] = await Subscription.app.models.user.count({ or: [{ licenseId: { inq: paidLicense } }, { exists: true }], is_deleted: false });      

      // Fetching free licenses
      let freeLicense = await Subscription.app.models.license.find({ where: { "name": "Spectator" } });
      freeLicense = freeLicense.map(item => item.id);
      userCount["Free"] = await Subscription.app.models.user.count({ or: [{ licenseId: { inq: freeLicense } }, { exists: true }], is_deleted: false });      

      return userCount;
    } catch(err) {
      console.log(err);
      throw err;
    }
  }
};
