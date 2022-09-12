'use strict';

module.exports = function(Karta) {
    // Karta.afterRemote('create', function(context, karta,  next) {
    //     // Find role
    //     Karta.app.models.karta_phase.findOne({ where:{ "name": "Goal" } }, (err, phase) => {
    //         if (err) {
    //             console.log('> error while finding karta phase', err);
    //             return next(err);
    //         } else {
    //             // Add default root node
    //             Karta.app.models.karta_node.create({ "name": karta.name, "kartaId": karta.id, "phaseId": phase.id }, {}, err => {
    //                 if (err) {
    //                     console.log('> error while creating karta node', err);
    //                     return next(err);
    //                 } else next();
    //             });
    //         }
    //     });
    // });
    Karta.observe('after delete', function(ctx, next) {
        next();
        Karta.app.models.karta_node.destroyAll({ or: [ {"kartaId": ctx.where.id}, {"kartaDetailId": ctx.where.id} ] }, (err, result) => {
            if (err) console.log('> error while deleting karta nodes', err);
        });
        // Karta.app.models.karta_sub_phase.destroyAll({ "kartaId": ctx.where.id }, (err, result) => {
        //     if (err) console.log('> error while deleting karta sub phases', err);
        // });
    });
};