'use strict';

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
                res.redirect(`${process.env.WEB_URL}/login?name=${user.name}&email=${user.email}&userId=${user.userId}&access_token=${user.accessToken}&profilePic=${user.profilePic}&companyLogo=${user.companyLogo}`);
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
};
