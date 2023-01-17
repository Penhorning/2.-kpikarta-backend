'use strict';

const keygen = require('keygenerator');

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
                req.app.models.company.findById(user.companyId.toString(), (err, company) => {
                    if (err) return console.log('> error while fetching company details');
                    user_data.companyLogo = company.logo ? company.logo : "";
                    user_data.profilePic = user.profilePic ? user.profilePic : "";
                    user_data._2faEnabled = user._2faEnabled ? user._2faEnabled : false;
                    user_data.mobileVerified = user.mobileVerified ? user.mobileVerified : false;
                    if (user._2faEnabled && user.mobileVerified) {
                        let mobileVerificationCode = keygen.number({length: 6});
                        req.user.updateAttributes({ mobileVerificationCode }, {}, err => {
                          let twilio_data = {
                            type: 'sms',
                            to: user.mobile.e164Number,
                            from: "+16063667831",
                            body: `${mobileVerificationCode} is your code for KPI Karta Login.`
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
                    res.redirect(`${process.env.WEB_URL}/login?name=${user_data.name}&email=${user_data.email}&userId=${user_data.userId}&access_token=${user_data.accessToken}&profilePic=${user_data.profilePic}&companyLogo=${user_data.companyLogo}&_2faEnabled=${user_data._2faEnabled}&mobileVerified=${user_data.mobileVerified}`);
                });
            } else {
                req.user.updateAttributes({emailVerified: true}, (err) => {
                res.redirect(`${process.env.WEB_URL}/sign-up?name=${user_data.name}&email=${user_data.email}&userId=${user_data.userId}&access_token=${user_data.accessToken}`);
            });
            }
        } else res.redirect(`${process.env.WEB_URL}/login?isDeleted=true&isActive=false`);
    });

    // Stripe webhook url
    app.post("/webhook", (req, res) => {
        req.app.models.subscription.update({ subscriptionId: req.body.data.object.id, customerId: req.body.data.object.customer }, { nextSubscriptionDate: req.body.data.object.current_period_end, currentSubscriptionDate: req.body.data.object.current_period_start }, (err) => {
            if (err) return console.log('> error while updating subscription on webhook..!!');
            res.send("webhook working..!!");
        });
    });
};
