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
  // Get kpi status by contributor's userId
  Kartanode.kpiStats = (userId, next) => {
    let completedQuery = { "contributors.userId": userId, $expr: { $eq: [ { "$arrayElemAt": ["$target.value", 0] }, "$achieved_value" ] } };
    let inCompletedQuery = { "contributors.userId": userId, $expr: { $gt: [ { "$arrayElemAt": ["$target.value", 0] }, "$achieved_value" ] } };

    Kartanode.count(completedQuery, (err, result) => {
      Kartanode.count(inCompletedQuery, (err2, result2) => {
        Kartanode.count({ "contributors.userId": userId }, (err2, result3) => {
          let data = {
            "All": result3,
            "InProgress": result2,
            "Completed": result
          }
          next(err2, data);
        });
      });
    });
  }

  // Get kpi nodes by contributor's userId
  Kartanode.kpiNodes = (page, limit, searchQuery, userId, kpiType, sortBy, percentage, targetTypes, startUpdatedDate, endUpdatedDate, startDueDate, endDueDate, next) => {
    page = parseInt(page, 10) || 1;
    limit = parseInt(limit, 10) || 100;

    userId = Kartanode.getDataSource().ObjectID(userId);
    let search_query = searchQuery ? searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : "";

    let query;

    // Find shared or assigned nodes
    if (kpiType === "shared") query = { "sharedTo.userId": userId };
    else query = { "contributors.userId": userId };

    // Filter nodes by last updated date ranges
    if (startUpdatedDate && endUpdatedDate) {
      query.updatedAt = {
        $gte: moment(startUpdatedDate).toDate(),
        $lte: moment(endUpdatedDate).toDate()
      }
    }
    // Filter nodes by due date ranges
    if (startDueDate && endDueDate) {
      query.due_date = {
        $gte: moment(startDueDate).toDate(),
        $lte: moment(endDueDate).toDate()
      }
    }
    // Filter nodes by frequency
    if (targetTypes.length > 0) {
      query["target.0.frequency"] = { $in: targetTypes }
    }
    // Filter nodes by percentage
    let percentage_query = {};
    if (percentage) {
      let percentageRange = [];
      percentage.forEach(item => {
        percentageRange.push({
          "target.0.percentage": { $gte: item.min, $lte: item.max }
        });
      });
      percentage_query = { $or: percentageRange };
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
          $match: percentage_query
        },
        {
          $sort: SORT
        },
        SEARCH_MATCH,
        KARTA_LOOKUP,
        UNWIND_KARTA,
        {
          $lookup: {
            from: "user",
            localField: "karta.userId",
            foreignField: "_id",
            pipeline: [
              { $project: {
                  "fullName": "$fullName",
                  "email": "$email"
                } 
              }
            ],
            as: "karta.user",
          }
        },
        {
          $unwind: "$karta.user"
        },
        {
          $facet: {
            metadata: [{ $count: "total" }, { $addFields: { 'page': page } }],
            data: [{ $skip: (limit * page) - limit }, { $limit: limit }]
          }
        }
      ]).toArray((err, result) => {
        if (result) result[0].data.length > 0 ? result[0].metadata[0].count = result[0].data.length : 0;
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
