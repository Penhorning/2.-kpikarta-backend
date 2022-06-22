'use strict';

const keygen = require('keygenerator');

module.exports = function socialRoutes(app) {
  app.get("/auth/account", (req, res) => {

    const user = {
        userId: req.signedCookies.userId,
        accessToken: req.signedCookies.access_token,
        name: req.user.fullName,
        email: req.user.email
    }

    if (req.user.emailVerified && req.user.currentPlan) {
        res.redirect(`${process.env.WEB_LOGIN_URL}?name=${user.name}&email=${user.email}&userId=${user.userId}&access_token=${user.accessToken}` );
    } else {
        req.user.updateAttributes({emailVerified: true}, (err)=>{
            res.redirect(`${process.env.AUTH_REDIRECT_URL}?name=${user.name}&email=${user.email}&userId=${user.userId}&access_token=${user.accessToken}`);
        });
    }

  });

  app.post("/send/otp", (req, res) => {
    let otp = keygen.number({length: 6});
    let data = {
      type: 'sms',
      to: req.body.number || "+918076454846",
      from: "+16063667831",
      body: `${otp} is your OTP for KPI Karta mobile verification.`
    }
    req.app.models.Twillio.updateAttributes({ mobileVerificationCode: otp }, {}, err => {
      // req.app.models.Twillio.send(data, function (err, data) {
      //   if (err) {
      //       console.log(err);
      //       res.json({ status: 500, message: err.message });
      //   } else {
      //       console.log(data);
      //       res.json({ status: 200, message: "OTP sent successfully" });
      //   }
      // });
    });
  });
};
