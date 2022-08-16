/* eslint-disable max-len */
// Copyright IBM Corp. 2016,2019. All Rights Reserved.
// Node module: loopback-workspace
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';
const path = require('path');
const loopback = require('loopback');
const boot = require('loopback-boot');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const morgan = require('morgan');

const app = module.exports = loopback();

app.middleware('parse', bodyParser.json());

// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }))

require('dotenv').config();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'templates'));

// Setup log for every request
app.use(morgan('dev')); // log every request to the console

app.use(function(req, res, next) {
  var tokenId = false;
  if (req.query && req.query.access_token) {
    tokenId = req.query.access_token;
  } else if (req.headers.authorization) {
    tokenId = req.headers.authorization;
  }

  app.currentUser = false;
  if (tokenId) {
    const UserModel = app.models.user;
    UserModel.relations.accessTokens.modelTo.findById(tokenId, function(err, accessToken) {
      if (err) return next(err);
      if (!accessToken) {
        if (req.body.confirmPassword && req.body.newPassword) {
          let error = new Error("Reset token expired");
          error.status = 400;
          return next(error);
        } else {
          let error = new Error("could not find accessToken");
          error.status = 401;
          return next(error);
        }
      }
      UserModel.findById(accessToken.userId, function(err, user) {
        if (err) return next(err);
        if (!user) {
          let error = new Error("could not find a valid user");
          error.status = 401;
          return next(error);
        }
        app.currentUser = user;
        next();
      });
    });
  } else next();
});

app.start = function() {
  // start the web server
  return app.listen(function() {
    app.emit('started');
    const baseUrl = app.get('url').replace(/\/$/, '');
    console.log('Web server listening at: %s', baseUrl);
    if (app.get('loopback-component-explorer')) {
      const explorerPath = app.get('loopback-component-explorer').mountPath;
      console.log('Browse your REST API at %s%s', baseUrl, explorerPath);
    }
  });
};

// Bootstrap the application, configure models, datasources and middleware.
// Sub-apps like REST API are mounted via boot scripts.
boot(app, __dirname, function(err) {
  if (err) throw err;

  // start the server if `$ node server.js`
  if (require.main === module)
    app.start();

/* =================================PASSPORT CONFIGURATIONS============================================== */
  var loopbackPassport = require('loopback-component-passport');
  var PassportConfigurator = loopbackPassport.PassportConfigurator;
  var passportConfigurator = new PassportConfigurator(app);

  // Load the provider configurations
  var config = {};
  try {
    config = require(`../providers.${process.env.NODE_ENV || 'development'}.json`);
  } catch (err) {
    console.error('Passport configuration', err);
    process.exit(1);
  }
  // Initialize passport
  passportConfigurator.init();

  // Set up related models
  passportConfigurator.setupModels({
    userModel: app.models.user,
    userIdentityModel: app.models.userIdentity,
    userCredentialModel: app.models.userCredential,
  });
  function customProfileToUser(provider, profile, options) {
    var userInfo;
    if (provider === 'linkedin') {
      delete profile['_json']['profilePicture'];
      userInfo = {
        username: profile.emails[0].value,
        password: 'linkedin_secret',
        fullName: profile.displayName,
        email: profile.emails[0].value,
      };
    } else if (provider === 'google') {
      userInfo = {
        username: profile._json.email,
        password: 'google_secret',
        fullName: profile._json.name,
        email: profile._json.email,
      };
    } else if (provider === 'facebook') {
      let email = "";
      if (profile._json.email) email = profile._json.email;
      else email = `${profile._json.id}@facebook.com`;
      userInfo = {
        username: email,
        password: 'facebook_secret',
        fullName: profile._json.name,
        email: email,
      };
    }
    return userInfo;
  }
  // Configure passport strategies for third party auth providers
  for (var s in config) {
    var c = config[s];
    c.session = c.session !== false;
    c.profileToUser = customProfileToUser;
    passportConfigurator.configureProvider(s, c);
  }
/* ====================================================================================================== */
});

// The access token is only available after boot
app.middleware('auth', loopback.token({
  model: app.models.accessToken,
}));

// Cookie parser
app.use(cookieParser(process.env.COOKIE_SECRET));
app.middleware('session:before', cookieParser(process.env.COOKIE_SECRET));
app.middleware('session', session({
  secret: process.env.COOKIE_SECRET,
  saveUninitialized: true,
  resave: true,
}));
