'use strict';

const keygen = require('keygenerator');
const { sales_update_user } = require('../../../helper/salesforce');
const moment = require('moment');

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

    // Chargebee webhook url
    app.post("/webhook", async (req, res) => {
        const { content, event_type } = req.body;
        console.log(`==========>>>>> WEBHOOK (${new Date()})`, req.body);

        try {
            let { customer_id, status } = content.subscription;
            const subscription = await app.models.subscription.findOne({ where: { "customerId": customer_id }});
            const mainUser = await app.models.user.findOne({ where: { id: subscription.userId }});
            const allUsers = await app.models.user.find({ where: { companyId: mainUser.companyId }});
    
            // Update subscription status of all users
            const updateSubscriptionStatus = async () => {
                if (event_type === "subscription_deleted") status = "deleted"; 
                let updatedData = { status };
                if (event_type === "subscription_renewed") updatedData.nextSubscriptionDate = moment(Number(content.subscription.next_billing_at) * 1000);
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
                    res.status(200).json({ error: false, status: 200, message: "Success" });
                    break;
                default:
                    res.status(200).json({ error: false, status: 200, message: "Success" });
                    break;
            }
        } catch(err) {
            res.status(500).json({ error: false, status: 500, message: "Error" });
        }
    });
};
