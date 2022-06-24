'use strict';

const keygen = require('keygenerator');


module.exports = function socialRoutes(app) {

  // Success redirect url for social login
  app.get("/auth/account", (req, res) => {
    const user = {
        userId: req.signedCookies.userId,
        accessToken: req.signedCookies.access_token,
        name: req.user.fullName,
        email: req.user.email
    }

    if (req.user.emailVerified && req.user.currentPlan) {
        res.redirect(`${process.env.WEB_URL}/login?name=${user.name}&email=${user.email}&userId=${user.userId}&access_token=${user.accessToken}`);
    } else {
      req.user.updateAttributes({emailVerified: true}, (err)=>{
        res.redirect(`${process.env.WEB_URL}/sign-up?name=${user.name}&email=${user.email}&userId=${user.userId}&access_token=${user.accessToken}`);
      });
    }
  });

  // Send otp
  app.post("/send-otp", (req, res) => {
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

  // Get suggestion by user id or global
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
};
