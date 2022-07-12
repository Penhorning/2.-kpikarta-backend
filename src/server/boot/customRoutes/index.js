'use strict';

const keygen = require('keygenerator');

module.exports = function (app) {
    // Success redirect url for social login
    app.get("/auth/account", (req, res) => {

        let user = {
            userId: req.signedCookies.userId,
            accessToken: req.signedCookies.access_token,
            name: req.user.fullName,
            email: req.user.email
        }

        if (req.user.emailVerified) {
            req.user.company((err, company) => {
                if (err) return console.log('> error while fetching company details');
                user.companyLogo = company.__data.logo ? company.__data.logo : "";
                user.profilePic = req.user.profilePic ? req.user.profilePic : "";
                user.mfaEnabled = req.user.mfaEnabled ? req.user.mfaEnabled : false;
                if (!req.user.mfaEnabled) {
                    let mobileVerificationCode = keygen.number({length: 6});
                    req.user.updateAttributes({ mobileVerificationCode }, {}, err => {
                      let twilio_data = {
                        type: 'sms',
                        to: req.user.mobile.e164Number,
                        from: "+16063667831",
                        body: `${mobileVerificationCode} is your code for KPI Karta mobile verification.`
                      }
                      req.app.models.Twilio.send(twilio_data, function (err, data) {
                        console.log('> sending code to mobile number:', req.user.mobile.e164Number);
                        if (err) {
                            console.log('> error while sending code to mobile number', err);
                            let error = err;
                            error.status = 500;
                            return next(error);
                        }
                      });
                    });
                }
                res.redirect(`${process.env.WEB_URL}/login?name=${user.name}&email=${user.email}&userId=${user.userId}&access_token=${user.accessToken}&profilePic=${user.profilePic}&companyLogo=${user.companyLogo}&mfaEnabled=${user.mfaEnabled}`);
            });
        } else {
            req.user.updateAttributes({emailVerified: true}, (err) => {
            res.redirect(`${process.env.WEB_URL}/sign-up?name=${user.name}&email=${user.email}&userId=${user.userId}&access_token=${user.accessToken}`);
        });
        }
    });

    // Get suggestion by userId or global
    app.post("/api/suggestion-by-user", async (req, res) => {
        let { userId, phaseId } = req.body;

        try {
            let result;
            let userRresult = await req.app.models.suggestion.findOne({ where: { userId, phaseId } });
            if (userRresult) result = userRresult;
            else {
                let globalRresult = await req.app.models.suggestion.findOne({ where: { phaseId } });
                result = globalRresult;
            }
            res.json(result);
        } catch(err) {
            res.json(err);
        }
    });

    // Get color settings by userId or global
    app.post("/api/color-settings-by-user", async (req, res) => {
        let { userId } = req.body;

        try {
            let result;
            let userRresult = await req.app.models.color_setting.find({ where: { userId } });
            if (userRresult) result = userRresult;
            else {
                let globalRresult = await req.app.models.color_setting.find({ where: { "userId" : { "eq": null }, "type": "global" } });
                result = globalRresult;
            }
            res.json(result);
        } catch(err) {
            res.json(err);
        }
    });
};
