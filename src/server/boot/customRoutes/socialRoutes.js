'use strict';

module.exports = function socialRoutes(app) {
  app.get("/auth/account", (req, res) => {

    console.log(req.signedCookies);
    console.log(req.signedCookies.userId);

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
};
