'use strict';

const moment = require('moment');

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

    // const addDays = (date, days) => {
    //     let result = new Date(date);
    //     result.setDate(result.getDate() + days);
    //     return result;
    // }


/* =============================CUSTOM METHODS=========================================================== */
    // Get kpi nodes by contributor's userId
    Kartanode.kpiNodes = (page, limit, searchQuery, userId,  percentage, startUpdatedDate, endUpdatedDate, next) => {
        page = parseInt(page, 10) || 1;
        limit = parseInt(limit, 10) || 100;
    
        userId = Kartanode.getDataSource().ObjectID(userId);
        let search_query = searchQuery ? searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : "";
        let query = { "contributors.userId": userId };
    
        // endUpdatedDate = addDays(endUpdatedDate, 1);
        // if (startUpdatedDate && endUpdatedDate) {
        //   query.updatedAt = {
        //       $gte: new Date(startUpdatedDate),
        //       $lte: endUpdatedDate
        //   }
        // }

        if (startUpdatedDate && endUpdatedDate) {
          query.updatedAt = {
              $gte: moment(startUpdatedDate).toDate(),
              $lte: moment(endUpdatedDate).toDate()
          }
        }
    
        const SEARCH_MATCH = {
          $match: {
            $or: [
              {
                'name': {
                  $regex: search_query,
                  $options: 'i'
                }
              }
            ]
          }
        }
        
        Kartanode.getDataSource().connector.connect(function(err, db) {
            const kartaNodeCollection = db.collection('karta_node');
            kartaNodeCollection.aggregate([
              { 
                $match: query
              },
              {
                $sort: { "createdAt": -1 }
              },
              SEARCH_MATCH,
              {
                $facet: {
                  metadata: [{ $count: "total" }, { $addFields: { 'page': page } }],
                  data: [{ $skip: (limit * page) - limit }, { $limit: limit }]
                }
              }
            ]).toArray((err, result) => {
              result[0].data.length > 0 ? result[0].metadata[0].count = result[0].data.length : 0;
              next(err, result);
            });
        });
    }

/* =============================REMOTE HOOKS=========================================================== */
    // Include childrens when fetching nodes by kartaId
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
