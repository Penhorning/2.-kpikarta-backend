'use strict';

const fs = require("fs");
const path = require('path');

module.exports = function(Company) {
  // After company update
  Company.afterRemote('prototype.patchAttributes', function(context, instance,  next) {
    const req = context.req;

    if (req.body.oldCompanyLogo) {
        fs.unlink(path.resolve('storage/company/', req.body.oldCompanyLogo), (err) => { console.log(err) });
    }
    next();
  });
};
