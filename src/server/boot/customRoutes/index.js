'use strict';

const keygen = require('keygenerator');
const { sales_update_user } = require('../../../helper/salesforce');
const moment = require('moment');
const { BILLING_PROVIDER, isUniBee, verifyWebhookSignature, mapUniBeeStatus } = require('../../../helper/billingProvider');

module.exports = function (app) {
    // Success redirect url for social login
    app.get("/auth/account", (req, res) => {

        const { user, signedCookies } = req;

        let user_data = {
            userId: signedCookies.userId,
            accessToken: signedCookies.access_token,
            name: user.fullName,
            email: user.email
        }

        if(user.active && !user.is_deleted) {
            if (user.emailVerified) {
                // Get company details
                req.app.models.user.findById(user.id.toString(), { include: ['company', 'role', 'license'] }, (err, result) => {
                    if (err) return console.log('> error while fetching user details');
                    user_data.companyLogo = result.company() ? (result.company().logo || "") : "";
                    user_data.companyId = result.company() ? (result.company().id || "") : "";
                    user_data.role = result.role() ? (result.role().name || "") : "";
                    user_data.license = result.license() ? (result.license().name || "") : "";
                    user_data.profilePic = user.profilePic || "";
                    user_data._2faEnabled = user._2faEnabled || false;
                    user_data.mobileVerified = user.mobileVerified || false;
                    user_data.subscriptionStatus = user.subscriptionStatus;
                    if (user._2faEnabled && user.mobileVerified) {
                        let mobileVerificationCode = keygen.number({length: 6});
                        req.user.updateAttributes({ mobileVerificationCode }, {}, err => {
                          let twilio_data = {
                            type: 'sms',
                            to: user.mobile.e164Number,
                            from: process.env.TWILIO_MESSAGINGSERVICE_SID,
                            body: `${mobileVerificationCode} is your One-Time Password (OTP) for login on KPI Karta. Request you to please enter this to complete your login. This is valid for one time use only. Please do not share with anyone.`
                          }
                          req.app.models.Twilio.send(twilio_data, function (err, data) {
                            console.log('> sending code to mobile number:', user.mobile.e164Number);
                          });
                        });
                    }

                    sales_update_user(user, { userLastLogin: moment().format('DD/MM/YYYY, HH:mm A') });
                    res.redirect(`${process.env.WEB_URL}/login?name=${user_data.name}&email=${user_data.email}&userId=${user_data.userId}&access_token=${user_data.accessToken}&profilePic=${user_data.profilePic}&companyLogo=${user_data.companyLogo}&companyId=${user_data.companyId}&role=${user_data.role}&license=${user_data.license}&_2faEnabled=${user_data._2faEnabled}&mobileVerified=${user_data.mobileVerified}&subscriptionStatus=${user_data.subscriptionStatus}`);
                });
            } else {
                res.redirect(`${process.env.WEB_URL}/sign-up?name=${user_data.name}&email=${user_data.email}&userId=${user_data.userId}&access_token=${user_data.accessToken}`);
            }
        } else res.redirect(`${process.env.WEB_URL}/login?isDeleted=true&isActive=false`);
    });

    // Unified webhook handler - supports both ChargeBee and UniBee
    app.post("/webhook", async (req, res) => {
        console.log(`==========>>>>> WEBHOOK (${new Date()}) - Provider: ${BILLING_PROVIDER}`, req.body);

        try {
            // Route to appropriate handler based on billing provider
            if (isUniBee) {
                return handleUniBeeWebhook(app, req, res);
            } else {
                return handleChargeBeeWebhook(app, req, res);
            }
        } catch(err) {
            console.log(`==========>>>>> ERROR IN WEBHOOK AT (${new Date()})`, err);
            res.status(500).json({ error: true, status: 500, message: "Error processing webhook" });
        }
    });

    // UniBee specific webhook endpoint (optional - can use same /webhook endpoint)
    app.post("/webhook/unibee", async (req, res) => {
        console.log(`==========>>>>> UNIBEE WEBHOOK (${new Date()})`, req.body);

        try {
            return handleUniBeeWebhook(app, req, res);
        } catch(err) {
            console.log(`==========>>>>> ERROR IN UNIBEE WEBHOOK AT (${new Date()})`, err);
            res.status(500).json({ error: true, status: 500, message: "Error processing webhook" });
        }
    });
};

/**
 * Handle ChargeBee webhook events
 */
async function handleChargeBeeWebhook(app, req, res) {
    const { content, event_type } = req.body;

    let { customer_id, status } = content.subscription;
    const subscription = await app.models.subscription.findOne({ where: { "customerId": customer_id }});
    
    if (!subscription) {
        console.log(`Subscription not found for customer_id: ${customer_id}`);
        return res.status(200).json({ error: false, status: 200, message: "Subscription not found" });
    }

    const mainUser = await app.models.user.findOne({ where: { id: subscription.userId }});
    const allUsers = await app.models.user.find({ where: { companyId: mainUser.companyId }});

    // Update subscription status of all users
    const updateSubscriptionStatus = async () => {
        if (event_type === "subscription_deleted") status = "deleted"; 
        let updatedData = { status };
        if (event_type === "subscription_renewed") {
            updatedData.nextSubscriptionDate = moment(Number(content.subscription.next_billing_at) * 1000);
        }
        await app.models.subscription.update({ "customerId": customer_id }, updatedData);
        for (let user of allUsers) {
            await app.models.user.update({ "id": user.id }, { "subscriptionStatus": status });
        }
    }

    switch(event_type) {
        case "subscription_reactivated":
        case "subscription_renewed":
        case "subscription_cancelled":
        case "subscription_deleted":
            await updateSubscriptionStatus();
            break;
        default:
            // Handle other events silently
            break;
    }
    
    res.status(200).json({ error: false, status: 200, message: "Success" });
}

/**
 * Handle UniBee webhook events
 * UniBee webhook event structure:
 * {
 *   "event_type": "subscription.created|subscription.updated|subscription.cancelled|...",
 *   "data": {
 *     "subscription": { ... },
 *     "user": { ... }
 *   }
 * }
 */
async function handleUniBeeWebhook(app, req, res) {
    const { event_type, data } = req.body;

    // Verify webhook signature if secret is configured
    const webhookSecret = process.env.UNIBEE_WEBHOOK_SECRET;
    if (webhookSecret) {
        const signature = req.headers['x-unibee-signature'] || req.headers['x-webhook-signature'];
        const rawBody = JSON.stringify(req.body);
        
        if (!verifyWebhookSignature(rawBody, signature, webhookSecret)) {
            console.log('Invalid webhook signature');
            return res.status(401).json({ error: true, status: 401, message: "Invalid signature" });
        }
    }

    // Extract subscription data from UniBee payload
    const subscriptionData = data?.subscription;
    if (!subscriptionData) {
        console.log('No subscription data in webhook payload');
        return res.status(200).json({ error: false, status: 200, message: "No subscription data" });
    }

    // Get customer/user ID from UniBee - might be userId or externalUserId
    const customerId = subscriptionData.userId || subscriptionData.user_id || subscriptionData.externalUserId;
    const subscriptionId = subscriptionData.subscriptionId || subscriptionData.subscription_id || subscriptionData.id;

    // Find subscription in our database - try by subscriptionId first, then by customerId
    let subscription = await app.models.subscription.findOne({ 
        where: { 
            or: [
                { subscriptionId: subscriptionId },
                { customerId: customerId },
                { unibeeUserId: customerId }
            ]
        }
    });

    if (!subscription) {
        console.log(`Subscription not found for UniBee subscription_id: ${subscriptionId} or customer_id: ${customerId}`);
        return res.status(200).json({ error: false, status: 200, message: "Subscription not found" });
    }

    const mainUser = await app.models.user.findOne({ where: { id: subscription.userId }});
    if (!mainUser) {
        console.log(`User not found for subscription userId: ${subscription.userId}`);
        return res.status(200).json({ error: false, status: 200, message: "User not found" });
    }

    const allUsers = await app.models.user.find({ where: { companyId: mainUser.companyId }});

    // Map UniBee status to internal status
    const unibeeStatus = subscriptionData.status;
    let internalStatus = mapUniBeeStatus ? mapUniBeeStatus(unibeeStatus) : unibeeStatus;

    // Map UniBee event types to internal handling
    // UniBee events: subscription.created, subscription.updated, subscription.cancelled, 
    // subscription.expired, subscription.renewed, subscription.paused, subscription.resumed
    const eventTypeMapping = {
        'subscription.created': 'subscription_created',
        'subscription.updated': 'subscription_updated',
        'subscription.activated': 'subscription_reactivated',
        'subscription.reactivated': 'subscription_reactivated',
        'subscription.renewed': 'subscription_renewed',
        'subscription.cancelled': 'subscription_cancelled',
        'subscription.canceled': 'subscription_cancelled',
        'subscription.expired': 'subscription_deleted',
        'subscription.deleted': 'subscription_deleted',
        'subscription.paused': 'subscription_paused',
        'subscription.resumed': 'subscription_resumed',
        // Payment events
        'payment.success': 'payment_success',
        'payment.failed': 'payment_failed',
        'invoice.paid': 'invoice_paid',
        'invoice.created': 'invoice_created'
    };

    const normalizedEventType = eventTypeMapping[event_type] || event_type;

    // Update subscription status
    const updateSubscriptionStatus = async (status, additionalData = {}) => {
        let updatedData = { status, ...additionalData };
        
        // Handle next billing date if available
        if (subscriptionData.currentPeriodEnd || subscriptionData.current_period_end) {
            const nextBillingAt = subscriptionData.currentPeriodEnd || subscriptionData.current_period_end;
            updatedData.nextSubscriptionDate = moment(nextBillingAt * 1000);
        }

        await app.models.subscription.update({ id: subscription.id }, updatedData);
        
        for (let user of allUsers) {
            await app.models.user.update({ id: user.id }, { subscriptionStatus: status });
        }
        
        console.log(`Updated subscription status to ${status} for ${allUsers.length} users`);
    };

    switch(normalizedEventType) {
        case 'subscription_created':
        case 'subscription_updated':
        case 'subscription_reactivated':
        case 'subscription_renewed':
            await updateSubscriptionStatus(internalStatus);
            break;
            
        case 'subscription_cancelled':
            await updateSubscriptionStatus('cancelled');
            break;
            
        case 'subscription_deleted':
            await updateSubscriptionStatus('deleted');
            break;
            
        case 'subscription_paused':
            await updateSubscriptionStatus('paused');
            break;
            
        case 'subscription_resumed':
            await updateSubscriptionStatus(internalStatus || 'active');
            break;
            
        case 'payment_success':
        case 'invoice_paid':
            // Payment received - could trigger additional logic
            console.log(`Payment received for subscription: ${subscriptionId}`);
            break;
            
        case 'payment_failed':
            // Payment failed - could trigger notification
            console.log(`Payment failed for subscription: ${subscriptionId}`);
            await updateSubscriptionStatus('payment_failed');
            break;
            
        default:
            console.log(`Unhandled UniBee event type: ${event_type}`);
            break;
    }

    res.status(200).json({ error: false, status: 200, message: "Success" });
}
