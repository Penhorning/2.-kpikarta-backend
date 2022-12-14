'use strict';

const moment = require('moment');

module.exports = function (Kartanode) {
  /* QUERY VARIABLES
    ----------------*/
  // Karta lookup
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
  // Facet
  const FACET = (page, limit) => {
    return {
      $facet: {
        metadata: [{ $count: "total" }, { $addFields: { 'page': page } }],
        data: [{ $skip: (limit * page) - limit }, { $limit: limit }]
      }
    }
  }

  // Convert string id to bson
  const convertIdToBSON = (id) => {
    return Kartanode.getDataSource().ObjectID(id);
  } 

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

  // Create node
  const createNode = async (kartaId, node, parent, phase) => {
    let data = {
      name: node.name,
      font_style: node.font_style,
      alignment: node.alignment,
      text_color: node.text_color,
      weightage: node.weightage,
      phaseId: phase.id
    }
    if (phase.name === "Goal") data.kartaId = kartaId;
    if (phase.name !== "Goal" && parent) {
      data.parentId = parent.id;
      data.kartaDetailId = kartaId;
    }

    if (phase.name === "KPI") {
      data.target = node.target;
      data.achieved_value = 0;
      data.is_achieved_modified = false;
      data.days_to_calculate = node.days_to_calculate;
      data.alert_type = node.alert_type || "";
      data.alert_frequency = node.alert_frequency || "";
      data.kpi_calc_period = node.kpi_calc_period;
      data.notifyUserId = node.notifyUserId || "";
    }
    return await Kartanode.create(data);
  }



/* =============================CUSTOM METHODS=========================================================== */

  // Add node by inventory
  Kartanode.addNodeByInventory = async (kartaId, node, parent, nodeType, next) => {
    
    // Get all phases
    const phases = await Kartanode.app.models.karta_phase.find({});
    // Find phase index
    const findIndex = (phaseId) => {
      return phases.map(item => item.id.toString()).indexOf(phaseId.toString());
    }

    const setCreateNodeParam = async (nodeData, parentData, phaseId) => {
      let index = 0;
      if (parentData) index = 1; 
      const phase = phases[findIndex(phaseId) + index];
      const result = await createNode(kartaId, nodeData, parentData, phase);
      // Assign divided weightage to all the nodes of that phase of current karta
      // await Kartanode.updateAll({ "kartaDetailId": kartaId, phaseId: phase.id, "is_deleted": false }, { weightage });
      if (nodeData.children && nodeData.children.length > 0) {
        for (let i = 0; i < nodeData.children.length; i++) {
          await setCreateNodeParam(nodeData.children[i], result, phase.id);
        }
      } else return;
    }

    if (nodeType === "branch" && parent) setCreateNodeParam(node, parent, parent.phaseId);
    else {
      const phase = phases[findIndex(parent.phaseId) + 1];
      await createNode(kartaId, node, parent, phase);
    }
  }

  // Share karta node to multiple users
  Kartanode.share = (nodeId, userIds, next) => {
    if (userIds.length > 0) {
      Kartanode.update({ "_id": nodeId }, { $addToSet: { "sharedTo": { $each: userIds } } }, (err) => {
        if (err) {
          console.log('> error while updating the node sharedTo property ', err);
          next(err);
        } else next(null, "Node shared successfully!");
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
        FACET(page, limit)
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

  // Calculate percentage according to kpi calculation
  Kartanode.calculationPeriod = async (nodeId, type, next) => {
    try {

      function findTarget(type) {
        return element.target.find((item) => item.frequency === type);
      }

      if ( type == "month-to-date" ) {
        // Month To Date Calculation
        const totalDays = moment().daysInMonth();
        const todayDate = moment().date();
        const kartaNodeDetails = await Kartanode.findOne({ where: { "id": nodeId }});
        if ( kartaNodeDetails ) {
          let element = kartaNodeDetails;
          let targetValue;
          if (findTarget('monthly')) targetValue = findTarget('monthly').value;
          else if (findTarget('annually')) targetValue = findTarget('annually').value * 12;
          else if (findTarget('quarterly')) targetValue = findTarget('quarterly').value * 3;
          else if (findTarget('weekly')) targetValue = findTarget('weekly').value * 4;

          // target value per day
          targetValue = todayDate * (targetValue / totalDays);
          let current_percentage= (element.achieved_value/targetValue) * 100;
          element.percentage = Math.round(current_percentage);
          element.percentage = element.percentage === Infinity ? 0 : Math.round(current_percentage);
          return { message: "Percentage calculated..!!", percentage: element.percentage };
        }
        else {
          return { message: "Karta Node not found..!!", percentage: null };
        }
      }
      else if ( type == "year-to-date" ) { 
        // Year To Date Calculation
        const currentYear = moment().year();
        const totalDays = moment([currentYear]).isLeapYear() ? 366 : 365;
        const todayDate = moment().dayOfYear();
        const kartaNodeDetails = await Kartanode.findOne({ where: { "id": nodeId }});
        if ( kartaNodeDetails ) {
          let element = kartaNodeDetails;
          let targetValue;
          if (findTarget('annually')) targetValue = findTarget('annually').value;
          else if (findTarget('monthly')) targetValue = findTarget('monthly').value * 12;
          else if (findTarget('quarterly')) targetValue = findTarget('quarterly').value * 4;
          else if (findTarget('weekly')) targetValue = findTarget('weekly').value * 52;

          // target value per day
          targetValue = todayDate * (targetValue / totalDays);
          let current_percentage= (element.achieved_value/targetValue) * 100;
          element.percentage = Math.round(current_percentage);
          element.percentage = element.percentage === Infinity ? 0 : Math.round(current_percentage);
          return { message: "Percentage calculated..!!", percentage: element.percentage };
        }
        else {
          return { message: "Karta Node not found..!!", percentage: null };
        }
      }
      else if ( type == "month-over-month" || type == "year-over-year" ) { 
        // Month Over Month and Year Over Year Calculation

        const currentYear = moment().year();
        const currentMonth = moment().month() + 1;
        const todayDate = moment().date();
        const previousMonth = currentMonth == 1 ? currentMonth : currentMonth - 1;
        const lastMonthLastDate = moment(`${currentYear-previousMonth}`, "YYYY-MM").daysInMonth();
        let currentMonthQuery;
        let previousMonthQuery;

        if ( type == "month-over-month" ) {
          currentMonthQuery = {
            event: "node_updated",
            kartaNodeId: nodeId,
            and: [
              { "createdAt": { gte: new Date(new Date(`${currentYear}-${currentMonth}-01`).setUTCHours(0,0,0,0)) } },
              { "createdAt": { lte: new Date(new Date(`${currentYear}-${currentMonth}-${todayDate}`).setUTCHours(23,59,59,999)) } }
            ]
          };
  
          previousMonthQuery = {
            event: "node_updated",
            kartaNodeId: nodeId,
            and: [
              { "createdAt": { gte: new Date(new Date(`${currentYear}-${previousMonth}-01`).setUTCHours(0,0,0,0)), } },
              { "createdAt": { lte: new Date(new Date(`${currentYear}-${previousMonth}-${lastMonthLastDate}`).setUTCHours(23,59,59,999)) } }
            ]
          };
        } else if ( type == "year-over-year" ) {
          currentMonthQuery = {
            event: "node_updated",
            kartaNodeId: nodeId,
            and: [
              { "createdAt": { gte: new Date(new Date(`${currentYear-1}-01-01`).setUTCHours(0,0,0,0)) } },
              { "createdAt": { lte: new Date(new Date(`${currentYear-1}-12-31`).setUTCHours(23,59,59,999)) } }
            ]
          };
  
          previousMonthQuery = {
            event: "node_updated",
            kartaNodeId: nodeId,
            and: [
              { "createdAt": { gte: new Date(new Date(`${currentYear}-01-01`).setUTCHours(0,0,0,0)), } },
              { "createdAt": { lte: new Date(new Date(`${currentYear}-12-${todayDate}`).setUTCHours(23,59,59,999)) } }
            ]
          };
        }

        const currentMonthHistoryDetails = await Kartanode.app.models.karta_history.find({ where: currentMonthQuery });
        let currentMonthData = null;

        const previousMonthhistoryDetails = await Kartanode.app.models.karta_history.find({ where: previousMonthQuery });
        let previousMonthData = null;

        if ( currentMonthHistoryDetails.length > 0 && previousMonthhistoryDetails.length > 0 ) {
          // 1. If Data found for previous month and current month

          // Filtering out the values for target values only from the history
          const currentSortedHistory = currentMonthHistoryDetails.filter(x => x.event_options.updated.hasOwnProperty("target"));
          const previousSortedHistory = previousMonthhistoryDetails.filter(x => x.event_options.updated.hasOwnProperty("target"));

          // If target values were found then returning the latest updated value from the history
          if ( currentSortedHistory.length > 0 ) {
            currentMonthData = currentSortedHistory[currentSortedHistory.length - 1];
          }
          if ( previousSortedHistory.length > 0 ) {
            previousMonthData = previousSortedHistory[previousSortedHistory.length - 1];
          }

          // Different conditions to check if target values were found or not 
          if (currentMonthData && previousMonthData) {
            // If both were found then simply returning the percentage
            let percentage = currentMonthData.event_options.updated.target[0].percentage - previousMonthData.event_options.updated.target[0].percentage;
            if ( type == "month-over-month" ) {
              return { message: "Data found for month over month..!!", percentage };
            } else {
              return { message: "Data found for year over year..!!", percentage };
            }

          } else if (currentMonthData && !previousMonthData) {
            // If only data found in current month
            let percentage = currentMonthData.event_options.updated.target[0].percentage;
            if ( type == "month-over-month" ) {
              return { message: "Data found for month over month..!!", percentage };
            } else {
              return { message: "Data found for year over year..!!", percentage };
            }
            
          } else if (!currentMonthData && previousMonthData) {
            // If only data found in previous month
            let percentage = previousMonthData.event_options.updated.target[0].percentage;
            if ( type == "month-over-month" ) {
              return { message: "Data found for month over month..!!", percentage };
            } else {
              return { message: "Data found for year over year..!!", percentage };
            }

          } else if (!currentMonthData && !previousMonthData) {
            let nodeHistory = { event: "node_created", kartaNodeId: nodeId };
            let nodeDetails = await Kartanode.app.models.karta_history.findOne({ where : nodeHistory });
            if (nodeDetails) {
              let percentage = nodeDetails.event_options.updated.target[0].percentage;
              if ( type == "month-over-month" ) {
                return { message: "Data found for month over month..!!", percentage };
              } else {
                return { message: "Data found for year over year..!!", percentage };
              }
            } else {
              return { message: "Something went wrong in history data..!!", percentage: null };
            }
          }

        } else if ( currentMonthHistoryDetails.length > 0 && previousMonthhistoryDetails.length == 0 ) {
          // 2. If Data found for only current month

          // Filtering out the values for target values only from the history
          const currentSortedHistory = currentMonthHistoryDetails.filter(x => x.event_options.updated.hasOwnProperty("target"));

          // If target values were found then returning the latest updated value from the history
          if ( currentSortedHistory.length > 0 ) {
            currentMonthData = currentSortedHistory[currentSortedHistory.length - 1];
          }

          // Different conditions to check if target values were found or not 
          if ( currentMonthData ) {
            // If data found in current month
            let percentage = currentMonthData.event_options.updated.target[0].percentage;
            if ( type == "month-over-month" ) {
              return { message: "Data found for month over month..!!", percentage };
            } else {
              return { message: "Data found for year over year..!!", percentage };
            }

          } else {
            let nodeHistory = { event: "node_created", kartaNodeId: nodeId };
            let nodeDetails = await Kartanode.app.models.karta_history.findOne({ where : nodeHistory });
            if (nodeDetails) {
              let percentage = nodeDetails.event_options.updated.target[0].percentage;
              if ( type == "month-over-month" ) {
                return { message: "Data found for month over month..!!", percentage };
              } else {
                return { message: "Data found for year over year..!!", percentage };
              }
            } else {
              return { message: "Something went wrong in history data..!!", percentage: null };
            }
          }

        } else if ( currentMonthHistoryDetails.length == 0 && previousMonthhistoryDetails.length > 0 ) {
          // 3. If Data found for only previous month

          // Filtering out the values for target values only from the history
          const previousSortedHistory = previousMonthhistoryDetails.filter(x => x.event_options.updated.hasOwnProperty("target"));

          // If target values were found then returning the latest updated value from the history
          if ( previousSortedHistory.length > 0 ) {
            previousMonthData = previousSortedHistory[previousSortedHistory.length - 1];
          }

          // Different conditions to check if target values were found or not 
          if ( previousMonthData ) {
            // If data found in previous month
            let percentage = previousMonthData.event_options.updated.target[0].percentage;
            if ( type == "month-over-month" ) {
              return { message: "Data found for month over month..!!", percentage };
            } else {
              return { message: "Data found for year over year..!!", percentage };
            }

          } else {
            let nodeHistory = { event: "node_created", kartaNodeId: nodeId };
            let nodeDetails = await Kartanode.app.models.karta_history.findOne({ where : nodeHistory });
            if (nodeDetails) {
              let percentage = nodeDetails.event_options.updated.target[0].percentage;
              if ( type == "month-over-month" ) {
                return { message: "Data found for month over month..!!", percentage };
              } else {
                return { message: "Data found for year over year..!!", percentage };
              }
            } else {
              return { message: "Something went wrong in history data..!!", percentage: null };
            }
          }

        } else if ( currentMonthHistoryDetails.length == 0 && previousMonthhistoryDetails.length == 0 ) {
          // 4. If Data not found for both current and previous month

          let nodeHistory = { event: "node_created", kartaNodeId: nodeId };
          let nodeDetails = await Kartanode.app.models.karta_history.findOne({ where : nodeHistory });
          if (nodeDetails) {
            let percentage = nodeDetails.event_options.updated.target[0].percentage;
            if ( type == "month-over-month" ) {
              return { message: "Data found for month over month..!!", percentage };
            } else {
              return { message: "Data found for year over year..!!", percentage };
            }
          } else {
            return { message: "Something went wrong in history data..!!", percentage: null };
          }

        }
      }
    }
    catch(err) {
      console.log(err);
    }
  }

/* =============================REMOTE HOOKS=========================================================== */

  // Add node and update weightage of other nodes
  Kartanode.afterRemote('create', function(context, node, next) {
    const kartaId = node.kartaDetailId;
    const currentNodeId = node.id;
    const phaseId = node.phaseId;
    const nextPhaseId = context.req.body.nextPhaseId;

    if (kartaId) {
      // Find version of current karta
      Kartanode.app.models.karta.findOne({ where: { "_id": kartaId } }, {}, (err, karta) => {
        if (err) return next(err);
        let created_node = {
          ...node.__data,
        };
        created_node["id"] ? delete created_node["id"] : null;
        // Prepare history data
        let history_data = {
          event: "node_created",
          kartaNodeId: currentNodeId,
          userId: Kartanode.app.currentUser.id,
          versionId: karta.versionId,
          kartaId: kartaId,
          parentNodeId: node.parentId,
          historyType: 'main',
          event_options: {
            created: created_node,
            updated: null,
            removed: null,
          }
        }
        // Create history of current node
        Kartanode.app.models.karta_history.create(history_data, {}, (err, response) => {
          Kartanode.app.models.karta.update({ "id": kartaId }, { "historyId": response.id }, () => {});
        });
        
        /* Adjust weight of current node
        */
        // Find children of current karta
        Kartanode.find({ where: { "_id": { ne: currentNodeId }, "kartaDetailId": kartaId, phaseId, "is_deleted": false } }, (err, nodes) => {
          if (err) next(err);
          // Check if children exists
          else if (nodes.length > 0) {
            let nodeIds = [];
            nodes.forEach(element => nodeIds.push(element.id));
            // Find if we have nested children
            Kartanode.findOne({ where: { "parentId": { inq: nodeIds }, "kartaDetailId": kartaId, "phaseId": nextPhaseId, "is_deleted": false } }, (err, result) => {
              if (err) next(err);
              else if (!result) {
                // Divide weightage, if we not have nested children
                let weightage = + (100 / (nodes.length + 1)).toFixed(2);
                // Assign divided weightage to all the nodes of that phase of current karta
                Kartanode.updateAll({ "kartaDetailId": kartaId, phaseId, "is_deleted": false }, { weightage }, (err, result2) => {
                  next(err, result2);
                  // Make history of updated nodes
                  nodes.forEach(item => {
                    // Prepare history data
                    let history_data = {
                      event: "node_updated",
                      kartaNodeId: item.id,
                      userId: Kartanode.app.currentUser.id,
                      versionId: karta.versionId,
                      kartaId: kartaId,
                      parentNodeId: item.parentId,
                      historyType: 'main',
                      event_options: {
                        created: null,
                        updated: { weightage },
                        removed: null,
                      },
                      old_options: { weightage: item.weightage }
                    }
                    // Create history of current node
                    Kartanode.app.models.karta_history.create(history_data, {}, (err, response) => {
                      Kartanode.app.models.karta.update({ "id": kartaId }, { "historyId": response.id }, () => {});
                    });
                  });

                  let history_data = {
                    event: "node_updated",
                    kartaNodeId: node.id,
                    userId: Kartanode.app.currentUser.id,
                    versionId: karta.versionId,
                    kartaId: kartaId,
                    parentNodeId: node.parentId,
                    historyType: 'main',
                    event_options: {
                      created: null,
                      updated: { weightage },
                      removed: null,
                    },
                    old_options: { weightage: node.weightage }
                  }
                  // Create history of current node
                  Kartanode.app.models.karta_history.create(history_data, {}, (err, response) => {
                    Kartanode.app.models.karta.update({ "id": kartaId }, { "historyId": response.id }, () => {});
                  });
                });
              } else {
                Kartanode.update({ "_id": currentNodeId, "kartaDetailId": kartaId }, { "weightage": 0 }, (err, result3) => {
                  next(err, result3);
                });
              }
            });
          } else next();
        });
      });
    } else next();
  });

  // Include childrens when fetching nodes by kartaId
  Kartanode.observe("access", (ctx, next) => {
    if (!ctx.query.include && ctx.query.where) {
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
