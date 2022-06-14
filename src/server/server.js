// Copyright IBM Corp. 2016,2019. All Rights Reserved.
// Node module: loopback-workspace
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';
const path = require('path');
const loopback = require('loopback');
const boot = require('loopback-boot');

const app = module.exports = loopback();

require('dotenv').config();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'templates'));

/* Verify token configuration ==========================================================================
========================================================================================================*/
  // Retrieve the currently authenticated user
  app.use(function(req, res, next) {
    // First, get the access token, either from the url or from the headers
    var tokenId = false;
    if (req.query && req.query.access_token) {
      tokenId = req.query.access_token;
    }
    // @TODO - not sure if this is correct since I'm currently not using headers
    // to pass the access token
    else if (req.headers && req.headers.access_token) {
      // tokenId = req.headers.access_token
    }

    // Now, if there is a tokenId, use it to look up the currently authenticated
    // user and attach it to the app
    app.currentUser = false;
    if (tokenId) {
      const UserModel = app.models.user;
      // Logic borrowed from user.js -> User.logout()
      UserModel.relations.accessTokens.modelTo.findById(tokenId, function(err, accessToken) {
        if (err) return next(err);
        if (! accessToken) return next(new Error('could not find accessToken'));

        // Look up the user associated with the accessToken
        UserModel.findById(accessToken.userId, function(err, user) {
          if (err) return next(err);
          if (! user) return next(new Error('could not find a valid user'));
          app.currentUser = user;
          next();
        });
      });
    }
    // If no tokenId was found, continue without waiting
    else next();
  });
/* Passport configurations starts ======================================================================
========================================================================================================*/
  // Create an instance of PassportConfigurator with the app instance
  var loopbackPassport = require('loopback-component-passport');
  var PassportConfigurator = loopbackPassport.PassportConfigurator;
  var passportConfigurator = new PassportConfigurator(app);

  // Load the provider configurations
  var config = {};
  try {
    config = require('../providers.json');
  } catch(err) {
    console.error("Passport configuration", err);
    process.exit(1);
  }
  // Initialize passport
  passportConfigurator.init();

  // Set up related models
  passportConfigurator.setupModels({
    userModel: app.models.user,
    userIdentityModel: app.models.UserIdentity,
    userCredentialModel: app.models.UserCredential
  });
  // Configure passport strategies for third party auth providers
  for (var s in config) {
    var c = config[s];
    c.session = c.session !== false;
    passportConfigurator.configureProvider(s, c);
  }
/* Passport configurations ends ========================================================================
========================================================================================================*/  
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
});
