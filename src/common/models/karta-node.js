'use strict';

const moment = require('moment');

module.exports = function (Kartanode) {
  // Delete child nodes
  const deleteChildNodes = (params) => {
    try {
      if(params.length > 0){
        params.forEach(async item => {
          let childrens = await Kartanode.find({ where: { "parentId": item.id } });
          await Kartanode.updateAll({ "_id": item.id }, { $set: { "is_deleted": true } });
          if (childrens.length > 0) deleteChildNodes(childrens);
        });
      }
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
  // Share karta to multiple users
  Kartanode.share = (nodeId, userIds, next) => {

    if (userIds.length > 0) {
      Kartanode.update({ "_id": nodeId }, { $addToSet: { "sharedTo": { $each: userIds } } }, (err) => {
        if (err) {
          console.log('> error while updating the node sharedTo property ', err);
          next(err);
        }
        else next(null, "Node shared successfully!");
      });
    } else {
      let error = new Error("Please send an userId array");
      error.status = 400;
      next(error);
    }
  }

  // Get unique creators by contributorId
  Kartanode.kpiCreators = (userId, next) => {

    userId = Kartanode.getDataSource().ObjectID(userId);
    
    Kartanode.getDataSource().connector.connect(function (err, db) {
      const kartaNodeCollection = db.collection('karta_node');
      kartaNodeCollection.aggregate([
        {
          $match: { "contributorId": userId }
        },
        {
          $sort: { "createdAt": -1 }
        },
        KARTA_LOOKUP,
        UNWIND_KARTA,
        {
          $group: {
            "_id": null,
            "userId": { $addToSet: "$karta.userId" }
          }
        }
      ]).toArray((err, result) => {
        if (err) next (err);
        else {
          if (result.length > 0) {
            Kartanode.app.models.user.find({ where: { "_id": { $in: result[0].userId } }, fields: { "id": true, "email": true, fullName: true } }, (err2, result2) => {
              next(err2, result2);
            });
          } else next(null, result);
        }
      });
    });
  }

  // Get kpi stats by contributorId
  Kartanode.kpiStats = (userId, next) => {
    let completedQuery = { "contributorId": Kartanode.getDataSource().ObjectID(userId), $expr: { $lte: [ { "$arrayElemAt": ["$target.value", 0] }, "$achieved_value" ] }, $or: [ { "is_deleted": false }, { "is_deleted": { "$exists": false} } ] };
    let inCompletedQuery = { "contributorId": Kartanode.getDataSource().ObjectID(userId), $expr: { $gt: [ { "$arrayElemAt": ["$target.value", 0] }, "$achieved_value" ] }, $or: [ { "is_deleted": false }, { "is_deleted": { "$exists": false} } ] };

    Kartanode.count({completedQuery}, (err, result) => {
      Kartanode.count(inCompletedQuery, (err2, result2) => {
        Kartanode.count({ "contributorId": Kartanode.getDataSource().ObjectID(userId) }, (err2, result3) => {
          let data = {
            "All": result3 || 0,
            "InProgress": result2 || 0,
            "Completed": result || 0
          }
          next(err2, data);
        });
      });
    });
  }

  // Get kpi nodes by contributorId
  Kartanode.kpiNodes = (page, limit, searchQuery, userId, kartaCreatorIds, kpiType, sortBy, percentage, targetTypes, startUpdatedDate, endUpdatedDate, startDueDate, endDueDate, next) => {
    page = parseInt(page, 10) || 1;
    limit = parseInt(limit, 10) || 100;

    let search_query = searchQuery ? searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : "";
    let query;

    // Filter nodes by creator's id
    let creator_query = {}, kartaCreators = [];
    if (kartaCreatorIds && kartaCreatorIds.length > 0) {
      kartaCreatorIds.map(id => {
        kartaCreators.push(Kartanode.getDataSource().ObjectID(id));
      });
      creator_query = { "karta.userId" : { $in: kartaCreators } };
    }

    // Find shared or assigned nodes
    if (kpiType === "shared") query = { "sharedTo.userId": userId };
    else query = { "contributorId": Kartanode.getDataSource().ObjectID(userId) };

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
    if (targetTypes && targetTypes.length > 0) {
      query["target.0.frequency"] = { $in: targetTypes }
    }
    // Filter nodes by percentage
    let percentage_query = {};
    if (percentage && percentage.length > 0) {
      let percentageRange = [];
      percentage.forEach(item => {
        percentageRange.push({
          "target.0.percentage": { $gte: item.min, $lte: item.max }
        });
      });
      percentage_query = { $or: percentageRange };
    }

    // Sort nodes by date and percentage
    let SORT = { "assigned_date": -1 };
    if (sortBy === "oldest") SORT = { "assigned_date": 1 };
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
          },
          {
            'karta.name': {
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
        KARTA_LOOKUP,
        UNWIND_KARTA,
        SEARCH_MATCH,
        {
          $lookup: {
            from: "user",
            let: {
                user_id: "$karta.userId"
            },
            pipeline: [
              { 
                $match: { 
                  $expr: { $eq: ["$_id", "$$user_id"] }
                } 
              },
              {
                $project: { "fullName": 1, "email": 1 }
              }
            ],
            as: "karta.user"
          }
        },
        {
          $unwind: "$karta.user"
        },
        {
          $match: creator_query
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

  // Soft delete Karta Nodes
  Kartanode.deleteNodes = (nodeId, next) => {
    Kartanode.update( { "_id": nodeId } , { $set: { "is_deleted": true } }, (err) => {
      if (err) {
        console.log('error while soft deleting karta Nodes', err);
        return next(err);
      }
      else {
        Kartanode.find({ where: { "parentId": nodeId } }, (err, result) => {
          if (err) console.log('> error while finding child nodes', err);
          deleteChildNodes(result);
        });
        return next(null, "Node deleted successfully..!!");
      }
    })
  }


/* =============================REMOTE HOOKS=========================================================== */
  // Include childrens when fetching nodes by kartaId
  Kartanode.observe("access", (ctx, next) => {
    // if (!ctx.query.include) ctx.query.include = "children";
    if(!ctx.query.include){
      ctx.query.include = "children";
      // ctx.query.where = {
      //     $or: [ { "is_deleted": { $exists: false }} , { "is_deleted": false }]
      // }
      ctx.query.where.is_deleted = true;
    }
    next();
  });

  // Update assigned date when a contributor added in a given node
  Kartanode.afterRemote('prototype.patchAttributes', function(context, instance, next) {
    const req = context.req;
    if (req.body.contributorId) {
      Kartanode.update({ "_id": instance.id, $set: { "assigned_date": new Date() } }, (err, result) => {
        next(err, result);
      });
    } else next();
  });
};
