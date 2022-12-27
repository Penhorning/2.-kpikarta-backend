'use strict';

module.exports = function(Suggestion) {
    // Get suggestion by global
    Suggestion.getGloabl = (phaseId, next) => {
        Suggestion.findOne({ where: { "userId" : { "exists" : false }, phaseId } }, function (error, globalResult) {
            next(error, globalResult);
        });
    }
    // Get suggestion by user or global
    Suggestion.getByUser = (userId, phaseId, next) => {
        Suggestion.findOne({ where: { userId, phaseId } }, function (err, userResult) {
            if (userResult) next(err, userResult);
            else {
                Suggestion.findOne({ where: { "userId" : { "exists" : false }, phaseId } }, function (error, globalResult) {
                    next(error, globalResult);
                });
            }
        });
    }
};
