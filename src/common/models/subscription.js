"use strict";

const moment = require('moment');
const { get_plans, create_customer, create_subscription, get_transactions, cancel_subscription, create_portal_session } = require('../../helper/chargebee');


module.exports = function (Subscription) {

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
  Subscription.getSubscribedUsers = async () => {
    try {
      const companyId = Subscription.app.currentUser.companyId;
      // Find subscription
      const subscription = await Subscription.findOne({ where: { companyId }});
      if (subscription) {
        const creatorLicense = await Subscription.app.models.license.findOne({ where: { name: "Creator" }});
        const championLicense = await Subscription.app.models.license.findOne({ where: { name: "Champion" }});
        const spectatorLicense = await Subscription.app.models.license.findOne({ where: { name: "Spectator" }});

        const creatorMembers = await Subscription.app.models.user.count({ companyId, "active": true, "is_deleted": false, "licenseId": creatorLicense.id });
        const championMembers = await Subscription.app.models.user.count({ companyId, "active": true, "is_deleted": false, "licenseId": championLicense.id });
        const spectatorMembers = await Subscription.app.models.user.count({ companyId, "active": true, "is_deleted": false, "licenseId": spectatorLicense.id });

        const mainPlan = subscription.subscriptionDetails.subscription_items[0];
        const findSubscriptionItemDetails = (planId, type) => {
          const subscriptionPriceDetails = subscription.subscriptionDetails.subscription_items.find(item => item.item_price_id === planId);
          if (subscriptionPriceDetails && subscriptionPriceDetails[type]) return subscriptionPriceDetails[type]/100;
          else return 0;
        }

        let userObj = { interval: subscription.frequency };
        let tracker = {
          Creator: {
            license: "Creator",
            count: creatorMembers,
            unit_price: mainPlan.unit_price/100,
            amount: mainPlan.amount/100
          },
          Champion: {
            license: "Champion",
            count: championMembers
          },
          Spectator: {
            license: "Spectator",
            count: spectatorMembers,
            unit_price: 0,
            amount: 0
          }
        }
        if (subscription.frequency === "year") {
          tracker.Creator.amount += findSubscriptionItemDetails(process.env.CREATOR_YEARLY_ADDON_PLAN_ID, 'amount');
          tracker.Champion.unit_price = findSubscriptionItemDetails(process.env.CHAMPION_YEARLY_ADDON_PLAN_ID, 'unit_price');
          tracker.Champion.amount = findSubscriptionItemDetails(process.env.CHAMPION_YEARLY_ADDON_PLAN_ID, 'amount');
        } else {
          tracker.Creator.amount += findSubscriptionItemDetails(process.env.CREATOR_MONTHLY_ADDON_PLAN_ID, 'amount');
          tracker.Champion.unit_price = findSubscriptionItemDetails(process.env.CHAMPION_MONTHLY_ADDON_PLAN_ID, 'unit_price');
          tracker.Champion.amount = findSubscriptionItemDetails(process.env.CHAMPION_MONTHLY_ADDON_PLAN_ID, 'amount');
        }
        let userDetails = Object.keys(tracker).map(x => tracker[x]);
        userObj["userDetails"] = userDetails;
        return userObj;
      } else {
        let error = new Error("Subscription not found!");
        error.status = 404;
        throw error;
      }
    } catch (err) {
      console.log(err);
      return err;
    }
  }

  // Cancel subscription
  Subscription.cancel =  async (userId) => {
    try {
      const user = await Subscription.app.models.user.findOne({ where: { "_id": userId } });
      if (user) {
        const subscription = await Subscription.findOne({ where: { "companyId": user.companyId } });
        const subscriptionData = { subscription_id: subscription.subscriptionId };
        const subscriptionResponse = await cancel_subscription(subscriptionData);
        if (subscriptionResponse.status === 200) {
          const { status } = subscriptionResponse.data.subscription;
          await Subscription.app.models.user.updateAll({ "companyId": user.companyId }, { "subscriptionStatus": status });
          await Subscription.update({ "id": subscription.id }, { status, "subscriptionDetails": subscriptionResponse.data.subscription });
          return "Subscription cancelled successfully!";
        } else {
          let error = new Error("Error while cancelling the subscription!");
          error.status = 500;
          throw error;
        }
      } else {
        let error = new Error("User not found!");
        error.status = 404;
        throw error;
      }
    } catch(err) {
      return err;
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

  // Get chargebee portal url for custumer
  Subscription.getPortal = (res, next) => {
    const user = Subscription.app.currentUser;
    Subscription.findOne({ where: { "companyId": user.companyId } }, async(err, subscription) => {
      if (err) next(err);
      else if (subscription) {
        const portal = await create_portal_session({ customer_id: subscription.customerId });
        if (portal.status === 200) res.redirect(portal.data.portal_session.access_url);
        else {
          let error = new Error("Error while getting portal details!");
          error.status = 500;
          next(error);
        }
      } else {
        let error = new Error("Subscription not found!");
        error.status = 404;
        next(error);
      }
    });
  }
};
