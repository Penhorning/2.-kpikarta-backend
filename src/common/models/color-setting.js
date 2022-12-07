'use strict';

module.exports = function(Colorsetting) {
    // Get color settings by user
    Colorsetting.getColorSettings = (next) => {
        Colorsetting.findOne({ where: { "userId" : { "exists" : false }, "kartaId" : { "exists" : false } } }, function (error, result) {
            next(error, result);
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
