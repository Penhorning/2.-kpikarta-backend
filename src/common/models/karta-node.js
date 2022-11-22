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
  // Share karta node to multiple users
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
    userId = Kartanode.getDataSource().ObjectID(userId);
    let completedQuery = { "contributorId": userId, "is_deleted": false, $expr: { $lte: [ { "$arrayElemAt": ["$target.value", 0] }, "$achieved_value" ] } };
    let inCompletedQuery = { "contributorId": userId, "is_deleted": false, $expr: { $gt: [ { "$arrayElemAt": ["$target.value", 0] }, "$achieved_value" ] } };

    Kartanode.count(completedQuery, (err, result) => {
      if (err) {
        console.log('> error while fetching Completed nodes', err);
        let error = err;
        error.status = 500;
        return next(error);
      }
      Kartanode.count(inCompletedQuery, (err2, result2) => {
        if (err2) {
          console.log('> error while fetching Incompleted nodes', err);
          let error = err2;
          error.status = 500;
          return next(error);
        }
        Kartanode.count({ "contributorId": userId }, (err3, result3) => {
          if (err3) {
            console.log('> error while fetching Inprogress nodes', err);
            let error = err3;
            error.status = 500;
            return next(error);
          }
          let data = {
            "All": result3 || 0,
            "InProgress": result2 || 0,
            "Completed": result || 0
          }
          next(null, data);
        });
      });
    });
  }

  // Get kpi nodes by contributorId
  Kartanode.kpiNodes = (page, limit, searchQuery, userId, statusType, kartaCreatorIds, kpiType, sortBy, percentage, targetTypes, startUpdatedDate, endUpdatedDate, startDueDate, endDueDate, next) => {
    page = parseInt(page, 10) || 1;
    limit = parseInt(limit, 10) || 100;

    let search_query = searchQuery ? searchQuery.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : "";
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

    // Filter nodes by completed, in-progress and all
    let status_query = {};
    if (statusType) {
      if (statusType === "completed") {
        status_query = { $expr: { $lte: [ { "$arrayElemAt": ["$target.value", 0] }, "$achieved_value" ] } }
      } else if (statusType === "in_progress") {
        status_query = { $expr: { $gt: [ { "$arrayElemAt": ["$target.value", 0] }, "$achieved_value" ] } }
      }
    }
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
          $match: { "target.0.value": { $gt: 0 }, "is_deleted": false }
        },
        {
          $match: status_query
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

  Kartanode.calculationPeriod = async (nodeId, type, next) => {
    try {
      if ( type == "month-to-date" ) {
        // Month To Date Calculation
        const totalDays = moment().daysInMonth();
        const todayDate = moment().date();
        const kartaNodeDetails = await Kartanode.findOne({ where: { "id": nodeId }});
        if ( kartaNodeDetails ) {
          let element = kartaNodeDetails;
          let targetValue = element.target[0].value;
          targetValue = todayDate * (targetValue / totalDays); // target value per day
          let current_percentage= (element.achieved_value/targetValue) * 100;
          element.percentage = Math.round(current_percentage);
          element.percentage = element.percentage === Infinity ? 0 : Math.round(current_percentage);
          return { message: "Percentage calculated..!!", data: element.percentage };
        }
        else {
          return { message: "Karta Node not found..!!", data: null };
        }
      }
      else if ( type == "year-to-date" ) { 
        // Year To Date Calculation
        const currentYear = moment().year();
        const totalDays = moment([currentYear]).isLeapYear() ? 366 : 365;
        const todayDate = moment().date();
        const kartaNodeDetails = await Kartanode.findOne({ where: { "id": nodeId }});
        if ( kartaNodeDetails ) {
          let element = kartaNodeDetails;
          let targetValue = element.target.find((item) => item.frequency === 'annually').value;
          targetValue = todayDate * (targetValue / totalDays);  // target value per day
          let current_percentage= (element.achieved_value/targetValue) * 100;
          element.percentage = Math.round(current_percentage);
          element.percentage = element.percentage === Infinity ? 0 : Math.round(current_percentage);
          return { message: "Percentage calculated..!!", data: element.percentage };
        }
        else {
          return { message: "Karta Node not found..!!", data: null };
        }
      }
      else if ( type == "month-over-month" ) { 
        // Month Over Month Calculation

        const currentYear = moment().year();
        const currentMonth = moment().month() + 1;
        const todayDate = moment().date();
        const previousMonth = currentMonth == 1 ? currentMonth : currentMonth - 1;
        const lastMonthLastDate = moment(`${currentYear-previousMonth}`, "YYYY-MM").daysInMonth();
        
        let currentMonthQuery = {
          event: "node_updated",
          kartaNodeId: nodeId,
          and: [
            { "createdAt": { gte: new Date(new Date(`${currentYear}-${currentMonth}-01`).setUTCHours(0,0,0,0)) } },
            { "createdAt": { lte: new Date(new Date(`${currentYear}-${currentMonth}-${todayDate}`).setUTCHours(23,59,59,999)) } }
          ]
        };

        let previousMonthQuery = {
          event: "node_updated",
          kartaNodeId: nodeId,
          and: [
            { "createdAt": { gte: new Date(new Date(`${currentYear}-${previousMonth}-01`).setUTCHours(0,0,0,0)), } },
            { "createdAt": { lte: new Date(new Date(`${currentYear}-${previousMonth}-${lastMonthLastDate}`).setUTCHours(23,59,59,999)) } }
          ]
        };

        const currentMonthHistoryDetails = await Kartanode.app.models.karta_history.find({ where: currentMonthQuery });
        let currentMonthData = {};

        const previousMonthhistoryDetails = await Kartanode.app.models.karta_history.find({ where: previousMonthQuery });
        let previousMonthData = {};

        if ( currentMonthHistoryDetails.length > 0 ) {
          const sortedHistory = currentMonthHistoryDetails.filter(x => x.event_options.updated.hasOwnProperty("target"));
          currentMonthData = sortedHistory[sortedHistory.length - 1];
        }
        else {
          currentMonthQuery["event"] = "node_created";
        }
        
        return { message: "Karta Node not found..!!", data: null };
        // --------------- Algorithm-------------
        // 1. Find current month and previous month
        // 2. Find latest target value of previous month and current month using history
        // 3. Find the difference between last month percentage minus current month percentage
        // 4. return value
      }
      else if ( type == "year-over-year" ) { 
        // Year Over Year Calculation

        // --------------- Algorithm-------------
        // 1. Find current year and previous month
        // 2. Find latest target value of previous month and current month using history
        // 3. Find the difference between last month value minus current month value
        // 4. return value
      }
    }
    catch(err) {
      console.log(err);
    }
  }

/* =============================REMOTE HOOKS=========================================================== */
  // Include childrens when fetching nodes by kartaId
  Kartanode.observe("access", (ctx, next) => {
    if(!ctx.query.include){
      ctx.query.include = ["children", "phase"];
      ctx.query.where.is_deleted = false;
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
