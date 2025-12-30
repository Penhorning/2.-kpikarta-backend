"use strict";

const moment = require('moment');
// Use billing provider abstraction layer for UniBee/ChargeBee compatibility
const { 
  get_plans, 
  get_plans_free, 
  get_champion_plan, 
  get_creator_plan, 
  create_customer, 
  create_subscription, 
  cancel_subscription, 
  create_portal_session,
  getPlanIds,
  isUniBee,
  BILLING_PROVIDER
} = require('../../helper/billingProvider');
const { sendEmail } = require('../../helper/sendEmail');

// Get plan IDs based on billing provider
const PLAN_IDS = getPlanIds();

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
  Subscription.getPlansFree = async () => {
    try {
      const plans = await get_plans_free();
      return plans.data.list;
    } catch(err) {
      return err;
    }
  }

  // Assign plan
  Subscription.assignPlan = async (planId, couponCode) => {
    try {
      // Find current user details
      const userId = Subscription.app.currentUser.id;
      const user = await Subscription.app.models.user.findOne({ where: { "_id": userId }, include: 'company' });
      
      // For AppSumo users, use the free/spectator plan (like ChargeBee's KPI-Karta-Creator---AppSumo-USD-Yearly)
      // The coupon was only for verification - the plan itself is already $0
      if (user.userType === 'appsumo') {
        if (isUniBee) {
          // UniBee Spectator plan (equivalent to ChargeBee's AppSumo plan)
          planId = process.env.UNIBEE_SPECTATOR_PLAN_ID || '419';
        } else {
          // ChargeBee AppSumo plan
          planId = 'KPI-Karta-Creator---AppSumo-USD-Yearly';
        }
      }
      
      const data = {
        first_name: user.fullName,
        email: user.email,
        company: user.company().name
      }
      // Create customer in billing provider
      const customerResponse = await create_customer(data);
      if (customerResponse.status === 200) {
        const customerId = customerResponse.data.customer.id;
        // Create subscription in billing provider
        const subscriptionData = {
          customer_id: customerId,
          plan_id: planId,
          user_email: user.email // For UniBee compatibility
        }
        
        // For AppSumo users with UniBee, apply the coupon code to track usage
        // This decrements the discount's liveQuantity in UniBee
        if (isUniBee && couponCode && user.userType === 'appsumo') {
          subscriptionData.coupon_code = couponCode;
        }
        
        const subscriptionResponse = await create_subscription(subscriptionData);
        if (subscriptionResponse.status === 200) {
          const subscription = subscriptionResponse.data.subscription;
          
          // Handle both ChargeBee and UniBee response formats
          const id = subscription.id || subscription.subscriptionId;
          const trial_start = subscription.trial_start;
          const current_term_start = subscription.current_term_start || subscription.currentPeriodStart;
          const trial_end = subscription.trial_end || subscription.trialEnd;
          const current_term_end = subscription.current_term_end || subscription.currentPeriodEnd;
          const next_billing_at = subscription.next_billing_at || subscription.currentPeriodEnd;
          const status = subscription.status;
          const billing_period_unit = subscription.billing_period_unit || subscription._unibee?.plan?.intervalUnit || 'month';
          const subscription_items = subscription.subscription_items || [{
            item_price_id: planId,
            amount: subscription.amount || subscription._unibee?.amount || 0,
            unit_price: subscription._unibee?.plan?.amount || 0
          }];
          
          // Store subscription details in db
          const trialStart = trial_start ? moment(Number(trial_start) * 1000) : 
          (current_term_start ? moment(Number(current_term_start) * 1000) : null);
          const trialEnd = trial_end ? moment(Number(trial_end) * 1000) : 
          (current_term_end ? moment(Number(current_term_end) * 1000) : null);

          const dbData = { 
            userId,
            companyId: user.companyId, 
            customerId,
            planId,
            subscriptionId: id,
            amount: (subscription_items[0].amount || 0) / 100,
            status,
            frequency: billing_period_unit,
            nextSubscriptionDate: next_billing_at ? moment(Number(next_billing_at) * 1000) : null,
            trialStart,
            trialEnd,
            subscriptionDetails: subscriptionResponse.data.subscription,
            billingProvider: BILLING_PROVIDER // Track which provider was used
          };
          const dbSubscription = await Subscription.create(dbData);
          // Update user with subscription details - use _id for MongoDB
          await Subscription.app.models.user.updateAll({ "_id": userId }, { "subscriptionId": dbSubscription.id, "subscriptionStatus": status });
          // Send new user mail to super admin
          Subscription.app.models.Role.findOne({ where: { name: "admin" } }, (err, role) => {
            if (err) throw err;
            else {
              // Find admin user
              Subscription.app.models.user.findOne({ where: { "roleId": role.id, "email": { neq: process.env.EXCLUDE_ADMIN_EMAIL } } }, (err, adminUser) => {
                if (!err) {
                  const emailObj = {
                    subject: `A new user has signed up..!!`,
                    template: "admin-notify.ejs",
                    email: adminUser.email,
                    user: user,
                    admin: adminUser,
                    company: user.company().name
                  };
                  sendEmail(Subscription.app, emailObj, () => {});
                }
              }); 
            }
          });
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
  Subscription.getSubscribedUsers = async (companyId, userType) => {
    try {
      // Find subscription
      const subscription = await Subscription.findOne({ where: { companyId }});
      if (subscription) {
        const creatorLicense = await Subscription.app.models.license.findOne({ where: { name: "Creator" }});
        const championLicense = await Subscription.app.models.license.findOne({ where: { name: "Champion" }});
        const spectatorLicense = await Subscription.app.models.license.findOne({ where: { name: "Spectator" }});

        const creatorMembers = await Subscription.app.models.user.count({ companyId, "active": true, "is_deleted": false, "licenseId": creatorLicense.id });
        const championMembers = await Subscription.app.models.user.count({ companyId, "active": true, "is_deleted": false, "licenseId": championLicense.id });
        const spectatorMembers = await Subscription.app.models.user.count({ companyId, "active": true, "is_deleted": false, "licenseId": spectatorLicense.id });
        
        // Handle both ChargeBee (subscription_items) and UniBee (addons/planAddons) structures
        const subscriptionItems = subscription.subscriptionDetails?.subscription_items 
            || subscription.subscriptionDetails?.addons 
            || subscription.subscriptionDetails?.planAddons
            || [];
        
        // For UniBee, get main plan from _unibee data
        const unibeeData = subscription.subscriptionDetails?._unibee;
        const unibeePlan = unibeeData?.subscriptionPendingUpdate?.plan 
            || unibeeData?.subscription?.plan 
            || unibeeData?.plan;
        
        // Get main plan - prioritize _unibee plan data over subscription_items
        let mainPlan;
        if (unibeePlan) {
            // UniBee: use the plan object from _unibee
            mainPlan = {
                item_price_id: subscription.planId,
                unit_price: unibeePlan.amount || 0,
                amount: unibeePlan.amount || 0,
                unitAmount: unibeePlan.amount || 0
            };
        } else if (subscriptionItems.length > 0 && !subscriptionItems[0].addonPlan) {
            // ChargeBee or normalized structure where first item is the main plan (not an addon)
            mainPlan = subscriptionItems[0];
        } else {
            // Fallback: create from subscription metadata
            const planAmount = subscription.subscriptionDetails?.amount || subscription.amount || 0;
            
            mainPlan = {
                item_price_id: subscription.planId,
                unit_price: planAmount,
                amount: planAmount,
                unitAmount: planAmount
            };
        }
        
        const findSubscriptionItemDetails = (planId, type) => { 
          // Handle ChargeBee structure (item_price_id) - both exact and string match
          let subscriptionPriceDetails = subscriptionItems.find(item => 
              item.item_price_id === planId || 
              item.item_price_id === String(planId) ||
              String(item.item_price_id) === String(planId)
          );
          
          // Handle UniBee structure (planId or addonPlanId)
          if (!subscriptionPriceDetails) {
              subscriptionPriceDetails = subscriptionItems.find(item => 
                  item.planId === planId || 
                  item.addonPlanId === planId ||
                  String(item.planId) === String(planId) ||
                  String(item.addonPlanId) === String(planId) ||
                  // Handle nested addonPlan structure from UniBee
                  item.addonPlan?.id === planId ||
                  String(item.addonPlan?.id) === String(planId) ||
                  item.addonPlan?.id === parseInt(planId)
              );
          }
          
          if (subscriptionPriceDetails) {
              // Handle nested addonPlan structure from UniBee
              // UniBee stores: { quantity, addonPlan: { id, amount, ... } }
              // ChargeBee stores: { item_price_id, quantity, amount, unit_price }
              let value;
              
              if (subscriptionPriceDetails.addonPlan) {
                  // UniBee nested structure
                  const addonPlan = subscriptionPriceDetails.addonPlan;
                  if (type === 'amount') {
                      // Total amount = unit price * quantity
                      value = (addonPlan.amount || 0) * (subscriptionPriceDetails.quantity || 1);
                  } else if (type === 'unit_price' || type === 'unitAmount') {
                      value = addonPlan.amount || 0;
                  } else {
                      value = subscriptionPriceDetails[type] || addonPlan[type] || 0;
                  }
              } else {
                  // ChargeBee or normalized structure
                  value = subscriptionPriceDetails[type] 
                      || subscriptionPriceDetails.amount 
                      || subscriptionPriceDetails.unitAmount
                      || 0;
              }
              
              // Convert from cents if needed (ChargeBee stores in cents, values > 100 likely in cents)
              return typeof value === 'number' && value > 100 ? value / 100 : value;
          }
          return 0;
        }

        let userObj = { interval: subscription.frequency, trialStart: subscription.trialStart, trialEnd: subscription.trialEnd, status: subscription.status };
        
        // Helper to convert price from cents if needed (ChargeBee stores in cents)
        const convertPrice = (value) => {
            if (!value || value === 0) return 0;
            // If value > 100, assume it's in cents and convert
            return typeof value === 'number' && value > 100 ? value / 100 : value;
        };
        
        let tracker = {
          Creator: {
            license: "Creator",
            count: creatorMembers,
            // unit_price will be updated below from the addon plan
            unit_price: 0,
            amount: convertPrice(mainPlan.amount || 0)
          },
          Champion: {
            license: "Champion",
            count: championMembers,
            unit_price: 0,
            amount: 0
          },
          Spectator: {
            license: "Spectator",
            count: spectatorMembers,
            unit_price: 0,
            amount: 0
          }
        }
        if (subscription.frequency === "year") {
          if(userType === "appsumo"){
            // Get addon unit_price for Creator
            tracker.Creator.unit_price = findSubscriptionItemDetails(PLAN_IDS.CREATOR_MONTHLY_ADDON_PLAN_ID || process.env.CREATOR_MONTHLY_ADDON_PLAN_ID, 'unit_price');
            tracker.Creator.amount += findSubscriptionItemDetails(PLAN_IDS.CREATOR_MONTHLY_ADDON_PLAN_ID || process.env.CREATOR_MONTHLY_ADDON_PLAN_ID, 'amount');
            tracker.Champion.unit_price = findSubscriptionItemDetails(PLAN_IDS.CHAMPION_MONTHLY_ADDON_PLAN_ID || process.env.CHAMPION_MONTHLY_ADDON_PLAN_ID, 'unit_price');
            tracker.Champion.amount = findSubscriptionItemDetails(PLAN_IDS.CHAMPION_MONTHLY_ADDON_PLAN_ID || process.env.CHAMPION_MONTHLY_ADDON_PLAN_ID, 'amount');
          }
          else{
            // Get addon unit_price for Creator
            tracker.Creator.unit_price = findSubscriptionItemDetails(PLAN_IDS.CREATOR_YEARLY_ADDON_PLAN_ID || process.env.CREATOR_YEARLY_ADDON_PLAN_ID, 'unit_price');
            tracker.Creator.amount += findSubscriptionItemDetails(PLAN_IDS.CREATOR_YEARLY_ADDON_PLAN_ID || process.env.CREATOR_YEARLY_ADDON_PLAN_ID, 'amount');
            tracker.Champion.unit_price = findSubscriptionItemDetails(PLAN_IDS.CHAMPION_YEARLY_ADDON_PLAN_ID || process.env.CHAMPION_YEARLY_ADDON_PLAN_ID, 'unit_price');
            tracker.Champion.amount = findSubscriptionItemDetails(PLAN_IDS.CHAMPION_YEARLY_ADDON_PLAN_ID || process.env.CHAMPION_YEARLY_ADDON_PLAN_ID, 'amount');
          }
        } else {
          // Get addon unit_price for Creator
          tracker.Creator.unit_price = findSubscriptionItemDetails(PLAN_IDS.CREATOR_MONTHLY_ADDON_PLAN_ID || process.env.CREATOR_MONTHLY_ADDON_PLAN_ID, 'unit_price');
          tracker.Creator.amount += findSubscriptionItemDetails(PLAN_IDS.CREATOR_MONTHLY_ADDON_PLAN_ID || process.env.CREATOR_MONTHLY_ADDON_PLAN_ID, 'amount');
          tracker.Champion.unit_price = findSubscriptionItemDetails(PLAN_IDS.CHAMPION_MONTHLY_ADDON_PLAN_ID || process.env.CHAMPION_MONTHLY_ADDON_PLAN_ID, 'unit_price');
          tracker.Champion.amount = findSubscriptionItemDetails(PLAN_IDS.CHAMPION_MONTHLY_ADDON_PLAN_ID || process.env.CHAMPION_MONTHLY_ADDON_PLAN_ID, 'amount');
        }
        if (!tracker.Champion.unit_price) {
          try {
            let planId = PLAN_IDS.CHAMPION_MONTHLY_ADDON_PLAN_ID || process.env.CHAMPION_MONTHLY_ADDON_PLAN_ID;
            if (subscription.frequency === "year"){ 
              planId = PLAN_IDS.CHAMPION_YEARLY_ADDON_PLAN_ID || process.env.CHAMPION_YEARLY_ADDON_PLAN_ID
            }
            if (subscription.frequency === "year" && userType === "appsumo"){ 
              planId = PLAN_IDS.CHAMPION_MONTHLY_ADDON_PLAN_ID || process.env.CHAMPION_MONTHLY_ADDON_PLAN_ID
            }
            const plan = await get_champion_plan(planId);
            // Handle both ChargeBee and UniBee response formats
            if (plan.status === 200) {
              const priceData = plan.data.list[0];
              tracker.Champion.unit_price = (priceData.item_price?.price || priceData.amount || 0) / 100;
            }
          } catch(err) {
            // Silently handle error - unit_price will remain 0
          }
        }
        if (!tracker.Creator.amount && userType === 'appsumo') {
          try {
            let planId = PLAN_IDS.CREATOR_MONTHLY_ADDON_PLAN_ID || process.env.CREATOR_MONTHLY_ADDON_PLAN_ID;
            const plan = await get_creator_plan(planId);
            // Handle both ChargeBee and UniBee response formats
            if (plan.status === 200) {
              const priceData = plan.data.list[0];
              tracker.Creator.unit_price = (priceData.item_price?.price || priceData.amount || 0) / 100;
            }
          } catch(err) {
            // Silently handle error
          }
        }
        if (!tracker.Creator.unit_price && userType === 'appsumo') {
          try {
            let planId = PLAN_IDS.CREATOR_MONTHLY_ADDON_PLAN_ID || process.env.CREATOR_MONTHLY_ADDON_PLAN_ID;
            const plan = await get_creator_plan(planId);
            // Handle both ChargeBee and UniBee response formats
            if (plan.status === 200) {
              const priceData = plan.data.list[0];
              tracker.Creator.unit_price = (priceData.item_price?.price || priceData.amount || 0) / 100;
            }
          } catch(err) {
            // Silently handle error
          }
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
      return err;
    }
  }

  // Cancel subscription
  Subscription.cancel = async(userId) => {
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
      throw err;
    }
  }

  // Get billing portal url for customer (supports both ChargeBee and UniBee)
  Subscription.getPortal = (res, next) => {
    const user = Subscription.app.currentUser;
    Subscription.findOne({ where: { "companyId": user.companyId } }, async(err, subscription) => {
      if (err) next(err);
      else if (subscription) {
        try {
          // For UniBee, we can also pass email for better compatibility
          const portal = await create_portal_session({ 
            customer_id: subscription.customerId,
            email: user.email 
          });
          
          if (portal.status === 200 && portal.data?.portal_session?.access_url) {
            res.redirect(portal.data.portal_session.access_url);
          } else {
            // Handle UniBee specific errors
            const errorMessage = portal.data?.message || "Error while getting portal details!";
            console.error('Portal session error:', errorMessage, portal.data);
            
            // Check if it's a "user not found" error - user needs to be created in UniBee
            if (errorMessage.includes('user not found') || portal.data?.code === 51) {
              let error = new Error("Billing account not found. Please contact support to set up your billing account.");
              error.status = 404;
              next(error);
            } else {
              let error = new Error(errorMessage);
              error.status = 500;
              next(error);
            }
          }
        } catch (portalErr) {
          console.error('Portal error:', portalErr);
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

  // Verify coupon code
  Subscription.verifyCoupon = async (couponCode) => {
    try {
      const { verify_coupon } = require('../../helper/billingProvider');
      const result = await verify_coupon(couponCode);
      
      if (result.status === 200) {
        return {
          valid: true,
          coupon: result.data.coupon
        };
      }
      return {
        valid: false,
        message: result.data.message || 'Invalid coupon code'
      };
    } catch (err) {
      console.error('Error verifying coupon:', err);
      return {
        valid: false,
        message: 'Error verifying coupon'
      };
    }
  };

  // Apply discount to existing subscription
  Subscription.applyDiscount = async (discountCode) => {
    try {
      const userId = Subscription.app.currentUser.id;
      const user = await Subscription.app.models.user.findOne({ where: { "_id": userId }});
      
      if (!user) {
        const err = new Error("User not found");
        err.status = 404;
        throw err;
      }

      // Find user's subscription
      const subscription = await Subscription.findOne({ where: { companyId: user.companyId }});
      
      if (!subscription) {
        const err = new Error("No active subscription found");
        err.status = 404;
        throw err;
      }

      const { apply_discount } = require('../../helper/billingProvider');
      const result = await apply_discount({
        subscription_id: subscription.subscriptionId,
        discount_code: discountCode
      });

      if (result.status === 200) {
        // Update subscription in database with new discount info
        await subscription.updateAttributes({
          subscriptionDetails: {
            ...subscription.subscriptionDetails,
            discount: result.data
          }
        });
        
        return {
          success: true,
          message: 'Discount applied successfully',
          data: result.data
        };
      }

      return {
        success: false,
        message: result.data.message || 'Failed to apply discount'
      };
    } catch (err) {
      console.error('Error applying discount:', err);
      throw err;
    }
  };
};
