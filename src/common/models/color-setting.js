'use strict';

module.exports = function(Colorsetting) {
    // Get color settings by global
    Colorsetting.getGloabl = (userId, next) => {
        Colorsetting.findOne({ where: { userId, "is_global" : true } }, function (error, userGlobalResult) {
            if (userGlobalResult) next(error, userGlobalResult);
            else {
                Colorsetting.findOne({ where: { "userId" : { "exists" : false }, "kartaId" : { "exists" : false } } }, function (error, globalResult) {
                    next(error, globalResult);
                });
            }
        });
    }
    // Get color settings by user
    Colorsetting.getByUser = (userId, kartaId, next) => {
        Colorsetting.findOne({ where: { userId, "is_global" : true } }, function (error, userGlobalResult) {
            if (userGlobalResult) next(error, userGlobalResult);
            else {
                Colorsetting.findOne({ where: { userId, kartaId } }, function (error, userResult) {
                    if (userResult) next(error, userResult);
                    else {
                        Colorsetting.findOne({ where: { "userId" : { "exists" : false }, "kartaId" : { "exists" : false } } }, function (error, globalResult) {
                            next(error, globalResult);
                        });
                    }
                });
            }
        });
    }
    // Toggle global color setting
    Colorsetting.toggleGlobal = (colorId, userId, is_global, next) => {
        console.log('here')
        Colorsetting.update({ "_id": colorId, userId }, { is_global }, function (err, result) {
            if (err) {
                let error = err;
                error.status = 500;
                return next(error);
            } else {
                Colorsetting.update({ "_id": { ne: colorId }, userId }, { "is_global": false }, function (err, result) {
                    next (err, result);
                });
            }
        });
    }
};
