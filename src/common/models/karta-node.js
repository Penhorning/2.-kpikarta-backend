'use strict';

module.exports = function(Kartanode) {
    // Delete child nodes
    const deleteChildNodes = (params) => {
        try {
            params.forEach(async item => {
                let childrens = await Kartanode.find({ where: { "parentId": item.id } });
                await Kartanode.deleteById(item.id);
                if (childrens.length > 0) deleteChildNodes(childrens);
            });
        } catch (err) {
            console.log('> error while deleting child nodes', err);
        }
    }


    Kartanode.observe("access", (ctx, next) => {
        if (!ctx.query.include) ctx.query.include = "children";
        next();
    });

    // Delete node with all child nodes
    Kartanode.observe('after delete', function(ctx, next) {
        next();
        Kartanode.find({ where: { "parentId": ctx.where.id } }, (err, result) => {
            if (err) console.log('> error while finding child nodes', err);
            else deleteChildNodes(result);
        });
    });
};
