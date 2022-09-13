'use strict';

module.exports = function(Colorsetting) {
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
};
