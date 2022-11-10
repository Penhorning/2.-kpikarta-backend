'use strict';

module.exports = function(Colorsetting) {
    // Get color settings by user
    Colorsetting.getColorsByUser = (userId, next) => {
        Colorsetting.findOne({ where: { userId } }, function (err, userResult) {
            if (userResult) next(err, userResult.color_settings);
            else {
                Colorsetting.findOne({ where: { "userId" : { "exists" : false } } }, function (error, globalResult) {
                    next(error, globalResult.color_settings);
                });
            }
        });
    }
    // Get color settings by karta
    Colorsetting.getColorsByKarta = (userId, kartaId, next) => {
        Colorsetting.findOne({ where: { userId, kartaId } }, function (err, kartaResult) {
            if (kartaResult) next(err, kartaResult.color_settings);
            else {
                Colorsetting.findOne({ where: { "userId" : { "exists" : false }, "kartaId" : { "exists" : false } } }, function (error, globalResult) {
                    next(error, globalResult.color_settings);
                });
            }
        });
    }
};
