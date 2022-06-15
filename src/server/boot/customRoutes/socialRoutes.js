'use strict';

module.exports = function socialRoutes(app) {
  app.get("/auth/account", (req, res) => {

    let cookies = req.headers.cookie;
    let cookieArray = cookies.split(";");
    let accessTokenString = decodeURIComponent(cookieArray[1].substring(18));
    let accessTokenArray = accessTokenString.split(".");
    let access_token = accessTokenArray[0];
    let userIdString = decodeURIComponent(cookieArray[2].substring(12));
    let userIdArray = userIdString.split(".");
    let userId = userIdArray[0];

    if (req.user.emailVerified) {
        res.redirect(`${process.env.WEB_LOGIN_URL}?name=${req.user.fullName}&email=${req.user.email}&userId=${userId}&access_token=${access_token}` );
    } else {
        req.user.updateAttributes({emailVerified: true}, (err)=>{
            res.redirect(`${process.env.AUTH_REDIRECT_URL}?name=${req.user.fullName}&email=${req.user.email}&userId=${userId}&access_token=${access_token}`);
        });
    }

  });
};
