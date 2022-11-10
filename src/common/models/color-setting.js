'use strict';

module.exports = function(Colorsetting) {
    // Get color settings by user
    Colorsetting.getColorsByUser = (userId, next) => {
        Colorsetting.findOne({ where: { userId, "kartaId" : { "exists" : false } } }, function (err, userResult) {
            if (userResult) next(err, userResult);
            else {
                Colorsetting.findOne({ where: { "userId" : { "exists" : false }, "kartaId" : { "exists" : false } } }, function (error, globalResult) {
                    next(error, globalResult);
                });
            }
        });
    }
    // Get color settings by karta
    Colorsetting.getColorsByKarta = (userId, kartaId, next) => {
        Colorsetting.findOne({ where: { userId, kartaId } }, function (err, kartaResult) {
            if (kartaResult) next(err, kartaResult);
            else {
                Colorsetting.findOne({ where: { "userId" : { "exists" : false }, "kartaId" : { "exists" : false } } }, function (error, globalResult) {
                    next(error, globalResult);
                });
            }
        });
    }
};
