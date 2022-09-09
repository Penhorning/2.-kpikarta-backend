'use strict';

module.exports = function(Kartanode) {
    Kartanode.observe("access", (ctx, next) => {
        if(!ctx.query.include) {
            ctx.query.include = "children"
        }
        next();
    });
};
