/* eslint-disable max-len */
/* eslint-disable camelcase */
'use strict';
Object.defineProperty(Array.prototype, 'unique', {
  enumerable: false,
  configurable: false,
  writable: false,
  value: function() {
    var a = this.concat();
    for (var i = 0; i < a.length; ++i) {
      for (var j = i + 1; j < a.length; ++j) {
        if (a[i] === a[j]) a.splice(j--, 1);
      }
    }
    return a;
  },
});

var allowed_path = [
  '/login',
  '/logout',
];
var ROLE_MANAGER = {};

ROLE_MANAGER.removeRoles = function(app, rolesToRemove, forUserId, cb) {
  app.models.RoleMapping.destroyAll({principalId: forUserId, roleId: {inq: rolesToRemove}}, (err, removed)=>{
    cb();
  });
};

ROLE_MANAGER.addRoles = function(app, rolesToAdd, forUserId, cb) {
  var roleObjects = rolesToAdd.map((roleId)=>{
    return {principalType: app.models.RoleMapping.USER, principalId: forUserId, roleId: roleId};
  });
  app.models.RoleMapping.create(roleObjects, (err, newRoles)=>{
    cb();
  });
};

ROLE_MANAGER.assignRoles = function(app, roles_to_assign, forUserId, cb) {
  var roles_ids = roles_to_assign;
  app.models.user.findById(forUserId, {'include': 'roles'}, (err, user) =>{
    app.models.RoleMapping.find({where: {principalType: app.models.RoleMapping.USER, principalId: forUserId}}, (err, user_roles)=>{
      var currentRoleIds = user_roles.map((r)=>r.roleId);
      var rolesToRemove = currentRoleIds.filter((r)=>{
        return roles_ids.indexOf(r) == -1;
      });
      var rolesToAdd = roles_ids.filter((r)=>currentRoleIds.indexOf(r) == -1);
      ROLE_MANAGER.removeRoles(app, rolesToRemove, forUserId, function() {
        ROLE_MANAGER.addRoles(app, rolesToAdd, forUserId, function() {
          cb();
        });
      });
    });
  });
};

ROLE_MANAGER.checkRole = function(roles, redirectPath) {
  return function(req, res, next) {
    if (!req.path.startsWith('/api') || allowed_path.indexOf(req.path) == -1) {
      if (req.app.currentUser) {
        var user_roles = req.app.currentUser.roles.map((r)=>r.name);
        const newRoles = user_roles.concat(roles).unique().length;
        const totalRoles = user_roles.length + roles.length;
        var role_is_available = newRoles != totalRoles;
        if (role_is_available) {
          next();
        } else {
          res.redirect(redirectPath || '/login?status=access_denied');
        }
      } else {
        res.redirect('/login');
      }
    } else {
      next();
    }
  };
};

module.exports = ROLE_MANAGER;

