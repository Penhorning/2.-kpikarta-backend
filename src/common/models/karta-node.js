'use strict';

const moment = require('moment');

module.exports = function (Kartanode) {
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

  const KARTA_LOOKUP = {
    $lookup: {
      from: 'karta',
      localField: 'kartaDetailId',
      foreignField: '_id',
      as: 'karta'
    },
  }
  const UNWIND_KARTA = {
    $unwind: {
      path: "$karta"
    }
  }


/* =============================CUSTOM METHODS=========================================================== */
  // Get kpi nodes by contributor's userId
  Kartanode.kpiNodes = (page, limit, searchQuery, userId, kpiType, sortBy, percentage, targetTypes, startUpdatedDate, endUpdatedDate, next) => {
    page = parseInt(page, 10) || 1;
    limit = parseInt(limit, 10) || 100;

    userId = Kartanode.getDataSource().ObjectID(userId);
    let search_query = searchQuery ? searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : "";

    let query;

    // Find shared or assigned nodes
    if (kpiType === "shared") query = { "sharedTo.userId": userId };
    else query = { "contributors.userId": userId };

    // endUpdatedDate = addDays(endUpdatedDate, 1);
    // if (startUpdatedDate && endUpdatedDate) {
    //   query.updatedAt = {
    //       $gte: new Date(startUpdatedDate),
    //       $lte: endUpdatedDate
    //   }
    // }

    // Filter nodes by last updated date ranges
    if (startUpdatedDate && endUpdatedDate) {
      query.updatedAt = {
        $gte: moment(startUpdatedDate).toDate(),
        $lte: moment(endUpdatedDate).toDate()
      }
    }
    // Filter nodes by frequency
    if (targetTypes.length > 0) {
      query["target.0.frequency"] = { $in: targetTypes }
    }
    // Filter nodes by percentage
    if (percentage) {
      query["target.0.percentage"] = { $gte: percentage.min, $lte: percentage.max }
    }

    // Sort nodes by date and percentage
    let SORT = { "createdAt": -1 };
    if (sortBy === "oldest") SORT = { "createdAt": 1 };
    else if (sortBy === "worst") SORT = { "target.0.percentage": 1 };
    else if (sortBy === "best") SORT = { "target.0.percentage": -1 };

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

    Kartanode.getDataSource().connector.connect(function (err, db) {
      const kartaNodeCollection = db.collection('karta_node');
      kartaNodeCollection.aggregate([
        {
          $match: query
        },
        {
          $sort: SORT
        },
        SEARCH_MATCH,
        KARTA_LOOKUP,
        UNWIND_KARTA,
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
  Kartanode.observe('after delete', function (ctx, next) {
    next();
    Kartanode.find({ where: { "parentId": ctx.where.id } }, (err, result) => {
      if (err) console.log('> error while finding child nodes', err);
      else deleteChildNodes(result);
    });
  });
};
