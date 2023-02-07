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

  async function createDummyKarta() {
    try {
      const kartaDetails = await app.models.karta.findOne({ where: { or: [ { sample: true, name: "SAMPLE_KARTA" }, { sample: { exists: true }} ]}});
      if(!kartaDetails) {
        // Creating Karta
        const sampleKarta = await app.models.karta.create({ name: "SAMPLE_KARTA", sample: true });
        const sampleVersion = await app.models.karta_version.create({ "name" : "1", "kartaId": sampleKarta.id });
        await app.models.karta.update({ "id" : sampleKarta.id }, { "versionId" : sampleVersion.id });

        // Creating Karta Nodes
        const globalPhases = await app.models.karta_phase.find({ where: { kartaId: { exists: false }}});
        let parentId = "";
        if(globalPhases.length > 0) {
          for(let i = 0; i < globalPhases.length; i++) {
            let currentPhase = globalPhases[i];
            let data = {};
            if(currentPhase.name == "Goal") {
              data = {
                name: "SAMPLE_GOAL",
                phaseId: currentPhase.id,
                kartaId: sampleKarta.id
              };
            } else {
              data = {
                name: "SAMPLE",
                kartaDetailId: sampleKarta.id,
                phaseId: currentPhase.id,
                parentId: parentId,
                weightage: 100
              }
              if(currentPhase.name == "KPI") {
                data.node_type = "measure";
                data.target = [{ frequency: 'monthly', value: 0, percentage: 0 }];
                data.achieved_value = 0;
                data.is_achieved_modified = false;
                data.days_to_calculate = "all";
                data.alert_type = "";
                data.alert_frequency = "";
                data.kpi_calc_period = 'monthly';
              }
            }

            const createSampleNode = await app.models.karta_node.create(data);
            parentId = createSampleNode.id;
          }
        }
      }
    } catch(err) {
      console.log(err);
      throw err;
    }
  }

  createDummyKarta();
};
