'use strict';

const keygen = require('keygenerator');
const { sales_update_user } = require('../../../helper/salesforce');
const moment = require('moment');
const { sendEmail } = require('../../../helper/sendEmail');

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
                    user_data.paymentVerified = user.paymentVerified || false;
                    user_data.paymentFailed = user.paymentFailed || false;
                    user_data.trialCancelled = user.trialCancelled || false;
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
                            // if (err) {
                            //     console.log('> error while sending code to mobile number', err);
                            //     let error = err;
                            //     error.status = 500;
                            //     return next(error);
                            // }
                          });
                        });
                    }

                    sales_update_user(user, { userLastLogin: moment().format('DD/MM/YYYY, HH:mm A') });
                    res.redirect(`${process.env.WEB_URL}/login?name=${user_data.name}&email=${user_data.email}&userId=${user_data.userId}&access_token=${user_data.accessToken}&profilePic=${user_data.profilePic}&companyLogo=${user_data.companyLogo}&companyId=${user_data.companyId}&role=${user_data.role}&license=${user_data.license}&_2faEnabled=${user_data._2faEnabled}&mobileVerified=${user_data.mobileVerified}&paymentVerified=${user_data.paymentVerified}&paymentFailed=${user_data.paymentFailed}&trialCancelled=${user_data.trialCancelled}`);
                });
            } else {
                res.redirect(`${process.env.WEB_URL}/sign-up?name=${user_data.name}&email=${user_data.email}&userId=${user_data.userId}&access_token=${user_data.accessToken}`);
            }
        } else res.redirect(`${process.env.WEB_URL}/login?isDeleted=true&isActive=false`);
    });

    // Stripe webhook url
    app.post("/webhook", async (req, res) => {
        const { data, type } = req.body; 
        console.log(`==========>>>>> WEBHOOK (${new Date()})`, req.body);

        const customerId = data.object.customer;
        const userData = await app.models.Subscription.findOne({ where: { customerId, cardHolder: true }});
        const userDetails = await app.models.user.findOne({ where: { id: userData.userId }});
        const allCardUsers = await app.models.subscription.find({ where: { customerId }});
        switch(type) {
            case "invoice.created": 
                const emailObj = {
                    subject: `KPI Invoice`,
                    template: "invoice.ejs",
                    email: userDetails.email,
                    user: userDetails,
                    amount: parseFloat(Number(data.object.total) / 100),
                    date: moment(data.object.created * 1000).format("MMM-DD-yyyy"),
                };
                sendEmail(app, emailObj, (err, response) => {
                    if(err) res.status(500).json({ error: false, status: 500, message: "Error" });
                    else res.status(200).json({ error: false, status: 200, message: "Success" });
                });
                break;

            case "customer.source.expiring": 
                for(let user in allCardUsers) {
                    await app.models.user.update({ id: user.userId }, { paymentFailed: true });
                }
                res.status(200).json({ error: false, status: 200, message: "Success" });
                break;

            case "charge.failed":
                for(let user in allCardUsers) {
                    await app.models.user.update({ id: user.userId }, { paymentFailed: true });
                }
                res.status(200).json({ error: false, status: 200, message: "Success" });
                break;

            default:
                res.status(200).json({ error: false, status: 200, message: "Success" });
                break;
        }
    });
};
