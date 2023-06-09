"use strict";

const { sendEmail } = require('../../helper/sendEmail');
const { sales_delete_user } = require("../../helper/salesforce");
const moment = require('moment');
const { get_plans, create_customer, create_subscription, get_transactions } = require('../../helper/chargebee');


module.exports = function (Subscription) {
  // Find users who is not deleted
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
  // Unwind license
  const UNWIND_LICENSE = {
    $unwind: {
      path: "$license"
    }
  }

/* =============================CUSTOM HOOKS=========================================================== */
  // Get plans
  Subscription.getPlans = async () => {
    try {
      const plans = await get_plans();
      return plans.data.list;
    } catch(err) {
      return err;
    }
  }

  // Assign plan
  Subscription.assignPlan = async (planId) => {
    try {
      // Find current user details
      const userId = Subscription.app.currentUser.id;
      const user = await Subscription.app.models.user.findOne({ where: { "_id": userId }, include: 'company' });
      const data = {
        id: user.company().name,
        first_name: user.fullName,
        email: user.email,
        company: user.company().name
      }
      // Create customer in chargebee
      const customerResponse = await create_customer(data);
      if (customerResponse.status === 200) {
        const customerId = customerResponse.data.customer.id;
        // Create subscription in chargebee
        const subscriptionData = {
          customer_id: customerId,
          plan_id: planId
        }
        const subscriptionResponse = await create_subscription(subscriptionData);
        if (subscriptionResponse.status === 200) {
          const { id, trial_start, trial_end, next_billing_at, status, billing_period_unit, subscription_items } = subscriptionResponse.data.subscription;
          // Store subscription details in db
          const data = { 
            userId,
            companyId: user.companyId, 
            customerId,
            planId,
            subscriptionId: id,
            amount: subscription_items[0].amount/100,
            status,
            frequency: billing_period_unit,
            nextSubscriptionDate: moment(Number(next_billing_at) * 1000),
            trialStart: moment(Number(trial_start) * 1000),
            trialEnd: moment(Number(trial_end) * 1000),
            subscriptionDetails: subscriptionResponse.data.subscription
          };
          await Subscription.create(data);
          await Subscription.app.models.user.update({ "id": userId }, { "subscriptionId": id, "subscriptionStatus": status });
          return "Subscription started successfully!";
        } else {
          const err = new Error("Internal Server Error");
          err.status = customerResponse.status;
          throw err;
        }
      } else {
        const err = new Error("Internal Server Error");
        err.status = customerResponse.status;
        throw err;
      }
    } catch(err) {
      return err;
    }
  }

  // Get subscribed users
  Subscription.getSubscribedUsers = async (companyId) => {
    try {
      // Find Card Holder
      const cardHolder = await Subscription.findOne({ where: { companyId , cardHolder: true }});
      if (cardHolder) {
        // Find All members of Company
        const findUsers = await Subscription.find({ where: { companyId }, include: ["license", {relation: "user", scope: { where: { is_deleted: false }}}] });
        let userObj = {
          interval: "",
          trialEnds: "",
          trialStarts: "",
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
            userObj.trialEnds = moment(Number(currentUser.trialEnds) * 1000).format("MM/DD/yyyy");
            userObj.trialStarts = moment(currentUser.createdAt).format("MM/DD/yyyy");
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

  // Get user count for Admin
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
