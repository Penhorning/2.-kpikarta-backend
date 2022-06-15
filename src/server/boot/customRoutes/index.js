'use strict';

const socialRoutes = require("./socialRoutes");

module.exports = function so(app) {
    socialRoutes(app);
};
