'use strict';

const customRoutes = require("./customRoutes");

module.exports = function so(app) {
    customRoutes(app);
};
