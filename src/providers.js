module.exports = {
  "facebook-login": {
    "provider": "facebook",
    "module": "passport-facebook",
    "profileFields": ["gender", "link", "locale", "name", "displayName", "timezone", "verified", "email", "updated_time"],
    "clientID": process.env.FACEBOOK_CLIENT_ID,
    "clientSecret": process.env.FACEBOOK_CLIENT_SECRET,
    "callbackURL": `${process.env.API_URL}/auth/facebook/callback`,
    "authPath": "/auth/facebook",
    "callbackPath": "/auth/facebook/callback",
    "successRedirect": "/auth/account",
    "failureRedirect": process.env.FAILURE_REDIRECT,
    "scope": ["email", "public_profile"]
  },
  "google-login": {
    "provider": "google",
    "module": "passport-google-oauth",
    "strategy": "OAuth2Strategy",
    "clientID": process.env.GOOGLE_CLIENT_ID,
    "clientSecret": process.env.GOOGLE_CLIENT_SECRET,
    "callbackURL": "/auth/google/callback",
    "authPath": "/auth/google",
    "callbackPath": "/auth/google/callback",
    "successRedirect": "/auth/account",
    "failureRedirect": process.env.FAILURE_REDIRECT,
    "scope": ["email", "profile"],
    "failureFlash": true
  },
  "linkedin-login": {
    "provider": "linkedin",
    "module": "passport-linkedin-oauth2",
    "profileFields": ["gender", "link", "locale", "name", "timezone", "verified", "email", "updated_time"],
    "clientID": process.env.LINKEDIN_CLIENT_ID,
    "clientSecret": process.env.LINKEDIN_CLIENT_SECRET,
    "callbackURL": `${process.env.API_URL}/auth/linkedin/callback`,
    "authPath": "/auth/linkedin",
    "callbackPath": "/auth/linkedin/callback",
    "successRedirect": "/auth/account",
    "failureRedirect": process.env.FAILURE_REDIRECT,
    "scope": ["r_emailaddress", "r_liteprofile"]
  }
}
