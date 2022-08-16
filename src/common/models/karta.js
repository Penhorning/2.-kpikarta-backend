'use strict';

module.exports = function(Karta) {
    // Karta.afterRemote('create', function(context, karta,  next) {
    //     // Find role
    //     Karta.app.models.kartaphase.findOne({ where:{ "name": "Goal" } }, (err, phase) => {
    //         if (err) {
    //             console.log('> error while finding karta phase', err);
    //             return next(err);
    //         } else {
    //             // Add default root node
    //             Karta.app.models.kartanode.create({ "name": karta.name, "kartaId": karta.id, "phaseId": phase.id }, {}, err => {
    //                 if (err) {
    //                     console.log('> error while creating karta node', err);
    //                     return next(err);
    //                 } else next();
    //             });
    //         }
    //     });
    // });
};
