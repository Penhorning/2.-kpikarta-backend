/* eslint-disable max-len */
'use strict';
var async = require('async');

module.exports = function(app) {
  function setupRole(role, users, done) {
    async.series([function(callback) {
      app.models.Role.create(role, function(err, created) {
        if (err) {
          console.log('[DB] ADD ROLE: ' + created.name + ' -> FAILED ' + err.details.messages.name[0]);
          return callback(err);
        };
        console.log('[DB] ADD ROLE: ' + created.name + ' -> DONE');
        callback(err, created);
      });
    }, function(callback) {
      app.models.user.create(users, (err, created) => {
        if (err) return console.log('[DB] SEED user -> FAILED');
        console.log('[DB] SEED user -> DONE');
        callback(err, created);
      });
    }], function(er, results) {
      var role = results[0];
      var users = results[1];
      async.forEach(users, function(user, callback) {
        role.principals.create({
          principalType: app.models.RoleMapping.USER,
          principalId: user.id,
        }, function(err, principal) {
          callback(err);
        });
      }, function(err) {
        done(err);
      });
    });
  }

  setupRole({name: 'admin'}, [], function(err) {
    setupRole({name: 'user'}, [], function(err) {
      setupRole({name: 'company_admin'}, [], function(err) {
        setupRole({name: 'department_admin'}, [], function(err) {
          setupRole({name: 'billing_staff'}, [], function(err) {
            if (err) return console.log('[DB] SEED user -> FAILED');
            console.log('[DB] SEED SETUP -> READY');
          });
        });
      });
    });
  });
};
