'use strict';

const moment = require('moment');
const { sales_update_user } = require('../../helper/salesforce');

module.exports = function (Kartanode) {
  /* QUERY VARIABLES
    ----------------*/
  // Karta lookup
  const KARTA_LOOKUP = {
    $lookup: {
      from: 'karta',
      let: {
        karta_id: "$kartaDetailId"
      },
      pipeline: [
        { 
          $match: { 
            $expr: { $eq: ["$_id", "$$karta_id"] }
          } 
        },
        {
          $project: { "name": 1, "userId": 1, "versionId": 1 }
        }
      ],
      as: 'karta'
    }
  }
  const UNWIND_KARTA = {
    $unwind: {
      path: "$karta"
    }
  }
  // Kata user lookup
  const KARTA_USER_LOOKUP = {
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
  }
  const UNWIND_KARTA_USER = {
    $unwind: "$karta.user"
  }
  // Kpi contributor lookup
  const KPI_CONTRIBUTOR_LOOKUP = {
    $lookup: {
      from: "user",
      let: {
          user_id: "$contributorId"
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
      as: "contributor"
    }
  }
  const UNWIND_KPI_CONTRIBUTOR = {
    $unwind: {
      path: "$contributor",
      preserveNullAndEmptyArrays: true
    }
  }
  // Facet
  const FACET = (page, limit) => {
    return {
      $facet: {
        metadata: [{ $count: "total" }, { $addFields: { "page": page } }],
        data: [{ $skip: (limit * page) - limit }, { $limit: limit }]
      }
    }
  }

  // Convert string id to bson
  const convertIdToBSON = (id) => {
    return Kartanode.getDataSource().ObjectID(id);
  }

  // Get all phases of karta
  const getAllPhases = async (kartaId) => {
    let sortedPhases = [];
    const phases = await Kartanode.app.models.karta_phase.find({ where: { kartaId, "is_deleted": false } });
    // Find sub phase
    const findSubPhase = (phaseArray, phaseId) => {
      let childPhase = phaseArray.find(item => {
        if (item.parentId) return item.parentId.toString() === phaseId.toString();
      });
      if (childPhase) {
        sortedPhases.push(childPhase);
        phaseArray.splice(phaseArray.findIndex(item => item.id.toString() === childPhase.id.toString()) , 1);
        findSubPhase(phaseArray, childPhase.id);
      }
    }
    // Iterate phases
    for (let phase of phases) {
      sortedPhases.push(phase);
      findSubPhase(phases, phase.id);
    }
    return sortedPhases;
  }

  // Find phase index
  const findPhaseIndex = (phaseArray, phaseId) => {
    for (let i=0; i<phaseArray.length; i++) {
      if (phaseArray[i].id.toString() === phaseId.toString()) return i;
    }
  }

  // Delete child nodes
  const deleteChildNodes = (params, randomKey, userId = null) => {
    try {
      if (params.length > 0) {
        params.forEach(async item => {
          let childrens = await Kartanode.find({ where: { "parentId": item.id } });
          await createHistory(item.kartaDetailId, item, item, randomKey, "node_removed");
          await Kartanode.updateAll({ "_id": item.id }, { $set: { "is_deleted": true } });
          if (childrens.length > 0) deleteChildNodes(childrens, randomKey);
        });
      }
    } catch (err) {
      console.log('> error while deleting child nodes', err);
    }
  }

  // Create history
  const createHistory = async (kartaId, node, updatedData, randomKey, event = "node_updated") => {
    const userIdValue = Kartanode.app.currentUser.id;
    Kartanode.app.models.karta.findOne({ where: { "_id": kartaId } }, {}, (err, karta) => {
      // Prepare history data
      let history_data = {
        event,
        kartaNodeId: node.id,
        userId: userIdValue,
        versionId: karta.versionId,
        kartaId: kartaId,
        parentNodeId: node.parentId,
        historyType: 'main',
        randomKey
      }
      event == "node_removed" ? history_data["event_options"] = {
        created: null,
        updated: null,
        removed: updatedData
      } : event == "node_updated" ? history_data["event_options"] = {
        created: null,
        updated: updatedData,
        removed: null
      } : history_data["event_options"] = {
        created: updatedData,
        updated: null,
        removed: null
      }
      if (event == "node_updated") {
        let oldOptions = {};
        Object.keys(updatedData).forEach(el => oldOptions[el] = node[el]);
        history_data["old_options"] = oldOptions;
      }
      // Create history of current node
      Kartanode.app.models.karta_history.create(history_data, {}, (err, response) => {
        if (err) console.log(err, 'err');
        Kartanode.app.models.karta.update({ "id": kartaId }, { "historyId": response.id }, () => {});
      });
    });
  }

  // Adjust weightage
  const reAdjustWeightage = async (kartaId, parentId, phaseId, randomKey) => {
    // Find children of current karta
    const childrens = await Kartanode.find({ where: { "kartaDetailId": kartaId, parentId, phaseId, "is_deleted": false } });
    // Assign divided weightage to all the nodes of that phase of current karta
    if (childrens.length > 0) {
      // Divide weightage
      const weightage = + (100 / childrens.length).toFixed(2);
      await Kartanode.updateAll({ "kartaDetailId": kartaId, parentId, phaseId, "is_deleted": false }, { weightage });
      // Create new history
      for (let children of childrens) createHistory(kartaId, children, { weightage }, randomKey);
    }
  }

  // Create node
  const createNode = async (kartaId, node, parent, phase, randomKey) => {
    let data = {
      name: node.name,
      font_style: node.font_style,
      alignment: node.alignment,
      text_color: node.text_color,
      weightage: node.weightage,
      phaseId: phase.id
    }

    if (phase.global_name === "Goal") data.kartaId = kartaId;
    if (phase.global_name !== "Goal" && parent) {
      data.parentId = parent.id;
      data.kartaDetailId = kartaId;
    }
    if (phase.global_name === "KPI") {
      data.node_type = node.node_type || "measure";
      if (node.node_type === "metrics") {
        data.node_formula = {
          fields: [],
          formula: ""
        }
        for (let i=0; i<node.node_formula.fields.length; i++) {
          data.node_formula.fields.push({ "fieldName": node.node_formula.fields[i].fieldName, "fieldValue": 0 });
        }
        data.node_formula.formula = node.node_formula.formula;
      }
      data.target = node.target || [{ frequency: 'monthly', value: 0, percentage: 0 }];
      data.achieved_value = 0;
      data.is_achieved_modified = false;
      data.days_to_calculate = node.days_to_calculate;
      data.alert_type = node.alert_type || "";
      data.alert_frequency = node.alert_frequency || "";
      data.kpi_calc_period = node.kpi_calc_period;
      data.notifyUserId = node.notifyUserId || "";
    }
    let nodeData = await Kartanode.create(data);

    // Create history of current node
    let kartaDetails = await Kartanode.app.models.karta.findOne({where: { id: kartaId }});
    let created_node = nodeData.__data;
    created_node["id"] ? delete created_node["id"] : null;
    let history_data = {
      event: "node_created",
      kartaNodeId: nodeData.id,
      userId: Kartanode.app.currentUser.id,
      versionId: kartaDetails.versionId,
      kartaId: kartaId,
      parentNodeId: nodeData.parentId,
      historyType: 'main',
      event_options: {
        created: created_node,
        updated: null,
        removed: null,
      },
      randomKey
    }
    const history = await Kartanode.app.models.karta_history.create(history_data);
    await Kartanode.app.models.karta.update({ "id": kartaId }, { "historyId": history.id });

    return nodeData;
  }



/* =============================CUSTOM METHODS=========================================================== */

  // Add node by inventory
  Kartanode.addNodeByInventory = async (kartaId, node, parent, nodeType, next) => {

    // Get all phases
    const phases = await getAllPhases(kartaId);
    const randomKey = new Date().getTime();
    
    const setCreateNodeParam = async (nodeData, parentData, phaseId) => {
      let index = 0;
      if (parentData) index = 1;
      const phase = phases[findPhaseIndex(phases, phaseId) + index];
      // Create node
      const result = await createNode(kartaId, nodeData, parentData, phase, randomKey);
      // Adjust weightage
      if (parentData) await reAdjustWeightage(kartaId, parentData.id, phase.id, randomKey);
      // Create further children nodes
      if (nodeData.children && nodeData.children.length > 0) {
        for (let i = 0; i < nodeData.children.length; i++) {
          await setCreateNodeParam(nodeData.children[i], result, phase.id);
        }
      } else return;
    }

    // Branch is dropping on existing karta, which have some nodes
    if (nodeType === "branch" && parent) await setCreateNodeParam(node, parent, parent.phaseId);
    // Branch is dropping on blank karta, no nodes exits yet, so parent is null.
    else if (nodeType === "branch" && !parent) await setCreateNodeParam(node, null, phases[0].id);
    else {
      // Measue or metrix node is dropping on existing karta on the last action phase
      const phase = phases[findPhaseIndex(phases, parent.phaseId) + 1];
      await createNode(kartaId, node, parent, phase, randomKey);
      // Adjust weightage
      await reAdjustWeightage(kartaId, parent.id, phase.id, randomKey);
    }
  }

  // Get unique creators by contributorId
  Kartanode.kpiCreators = (userId, next) => {

    userId = convertIdToBSON(userId);
    
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
    userId = convertIdToBSON(userId);
    let completedQuery = { "contributorId": userId, "target.0.value": { $gt: 0 }, "is_deleted": false, $expr: { $lte: [ { "$arrayElemAt": ["$target.value", 0] }, "$achieved_value" ] } };
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


  // Get last saved karta version history
  Kartanode.lastSavedKarta = (kartaId, next) => {
    Kartanode.app.models.karta_version.find({ where: { kartaId, "is_deleted": false } }, (err, result) => {
      next(err, result[result.length-1]);
    });
  }
  // Get last updated karta history
  Kartanode.lastUpdatedKarta = (kartaId, next) => {
    Kartanode.app.models.karta_history.find({ where: { kartaId, "is_deleted": false } }, (err, result) => {
      next(err, result[result.length-1]);
    });
  }

  function prepareQuery(userId) {
    return new Promise(function(resolve, reject) {
      // Find current user details
      Kartanode.app.models.user.findOne({ where: { "_id": userId, "is_deleted": false } }, async (err, user) => {
        if (err) reject(err);
        else {
          // Find the creator license
          await Kartanode.app.models.license.findOne({ where: { "name": "Creator" } }, async (err, license) => {
            if (err) reject(err);
            else {
              // Find all creator users of the current user's company
              await Kartanode.app.models.user.find({ where: { "companyId": user.companyId, "licenseId": license.id, "is_deleted": false } }, (err, creators) => {
                if (err) reject(err);
                else {
                  let creatorUsers = creators.map(item => convertIdToBSON(item.id));
                  resolve({ "karta.userId": { $in: creatorUsers }, $or: [{ "node_type" : "measure" }, { "node_type" : "metrics" }] });
                }
              });
            }
          });
        }
      });
    });
  }

  function executeKPINodeQuery(page, limit, query, SEARCH_MATCH, status_query, percentage_query, SORT, creator_query, all_kpi_query, next) {
    Kartanode.getDataSource().connector.connect((err, db) => {
      const kartaNodeCollection = db.collection('karta_node');
      kartaNodeCollection.aggregate([
        {
          $match: query
        },
        {
          $match: { "is_deleted": false }
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
        KARTA_USER_LOOKUP,
        UNWIND_KARTA_USER,
        KPI_CONTRIBUTOR_LOOKUP,
        UNWIND_KPI_CONTRIBUTOR,
        {
          $match: creator_query
        },
        {
          $match: all_kpi_query
        },
        FACET(page, limit)
      ]).toArray((err, result) => {
        if (result) result[0].data.length > 0 ? result[0].metadata[0].count = result[0].data.length : 0;
        next(err, result);
      });
    });
  }

  // Get kpi nodes by contributorId
  Kartanode.kpiNodes = (page, limit, searchQuery, userId, statusType, kartaCreatorIds, kpiType, sortBy, percentage, targetTypes, startUpdatedDate, endUpdatedDate, startDueDate, endDueDate, next) => {
    page = parseInt(page, 10) || 1;
    limit = parseInt(limit, 10) || 100;

    let search_query = searchQuery ? searchQuery.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : "";
    let query = { "contributorId": convertIdToBSON(userId) };

    // Filter nodes by creator's id
    let creator_query = {};
    if (kartaCreatorIds && kartaCreatorIds.length > 0) {
      kartaCreatorIds = kartaCreatorIds.map(id => convertIdToBSON(id));
      creator_query = { "karta.userId" : { $in: kartaCreatorIds } };
    }

    // Filter nodes by completed, in-progress and all
    let status_query = {};
    if (statusType) {
      if (statusType === "completed") {
        status_query = { "target.0.value": { $gt: 0 }, $expr: { $lte: [ { "$arrayElemAt": ["$target.value", 0] }, "$achieved_value" ] } }
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
              $regex: '^' + search_query,
              $options: 'i'
            }
          },
          {
            'karta.name': {
              $regex: '^' + search_query,
              $options: 'i'
            }
          }
        ]
      }
    }

    // Fetch all kpis of creator
    let all_kpi_query = {};
    if (kpiType === "all") {
      query = {};
      // Find current user details
      Kartanode.app.models.user.findOne({ where: { "_id": userId, "is_deleted": false } }, (err, user) => {
        Kartanode.app.models.license.findOne({ where: { "name": "Creator" } }, (err, license) => {
          Kartanode.app.models.user.find({ where: { "companyId": user.companyId, "licenseId": license.id, "is_deleted": false } }, (err, creators) => {
            let creatorUsers = creators.map(item => convertIdToBSON(item.id));
            all_kpi_query = { "karta.userId": { $in: creatorUsers}, $or: [{ "node_type" : "measure" }, { "node_type" : "metrics" }]};
            executeKPINodeQuery(page, limit, query, SEARCH_MATCH, status_query, percentage_query, SORT, creator_query, all_kpi_query, next);
          })
        });
      });
    }
    else executeKPINodeQuery(page, limit, query, SEARCH_MATCH, status_query, percentage_query, SORT, creator_query, all_kpi_query, next);
  }

  // View previous kpi nodes by month
  Kartanode.viewPreviousKpisByMonth = (page, limit, contributorId, month, next) => {
    page = parseInt(page, 10) || 1;
    limit = parseInt(limit, 10) || 100;
    
    contributorId = convertIdToBSON(contributorId);

    const karta_node_query = {
      "contributorId": contributorId,
      "is_deleted": false
    }

    const karta_history_query = {
      "kartaNodeId": "$node_id",
      "event": "node_updated",
      "old_options.achieved_value": { $exists: true }
    }

    const date_query = {
      "createdAt": {
        $gte: moment().month(month).startOf('month').toDate(),
        $lte: moment().month(month).endOf('month').toDate()
      }
    }
  
    Kartanode.getDataSource().connector.connect(function (err, db) {
      const kartaNodeCollection = db.collection('karta_node');
      kartaNodeCollection.aggregate([
        {
          $match: karta_node_query
        },
        {
          $match: date_query
        },
        KARTA_LOOKUP,
        UNWIND_KARTA,
        KARTA_USER_LOOKUP,
        UNWIND_KARTA_USER,
        {
          $lookup: {
            from: 'karta_history',
            let: {
              node_id: "$_id"
            },
            pipeline: [
              { 
                $match: karta_history_query
              },
              { 
                $match: date_query
              },
              {
                $sort: {
                  "createdAt": -1
                }
              },
              {
                $limit: 1
              }
            ],
            as: 'node'
          }
        },
        {
          $unwind: {
            path: "$node",
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $project: {
            "name": 1,
            "target": 1,
            "kpi_calc_period": 1,
            "karta": 1,
            "assigned_date": 1,
            "start_date": 1,
            "node_type": 1,
            "due_date": 1,
            "updatedAt": 1,
            "achieved_value": {
              $cond: [ "$node.event_options.updated.achieved_value", "$node.event_options.updated.achieved_value", "$achieved_value" ]
            }
          }
        },
        FACET(page, limit)
      ]).toArray((err, result) => {
        if (result) result[0].data.length > 0 ? result[0].metadata[0].count = result[0].data.length : 0;
        next(err, result);
      });
    });
  }

  // View previous kpi nodes by year
  Kartanode.viewPreviousKpisByYear = (page, limit, contributorId, nodeIds, year, next) => {
    page = parseInt(page, 10) || 1;
    limit = parseInt(limit, 10) || 100;
    
    contributorId = convertIdToBSON(contributorId);

    const karta_node_query = {
      "contributorId": contributorId,
      "is_deleted": false,
      "createdAt": {
        $gte: moment().year(year).startOf('year').toDate(),
        $lte: moment().year(year).endOf('year').toDate()
      }
    }
    // query for selected nodes only
    if (nodeIds && nodeIds.length > 0) {
      nodeIds = nodeIds.map(item => convertIdToBSON(item));
      karta_node_query["_id"] = { $in: nodeIds }
    }
  
    Kartanode.getDataSource().connector.connect(function (err, db) {
      const kartaNodeCollection = db.collection('karta_node');
      kartaNodeCollection.aggregate([
        {
          $match: karta_node_query
        },
        KARTA_LOOKUP,
        UNWIND_KARTA,
        KARTA_USER_LOOKUP,
        UNWIND_KARTA_USER,
        FACET(page, limit)
      ]).toArray(async (err, result) => {
        if (result) {
          result[0].data.length > 0 ? result[0].metadata[0].count = result[0].data.length : 0;
          // Fetch whole year history month wise
          for (let item of result[0].data) {
            item["nodes"] = [];
            const karta_history_query = {
              "kartaNodeId": item._id,
              "event": "node_updated",
              "old_options.achieved_value": { exists: true }
            }
            // if year is less than current year
            // const currentYear = moment().year();
            // const currentMonth = moment().month();
            // let totalMonths = 11;
            // if (year >= currentYear) totalMonths = currentMonth;
            for (let i=0; i<=11; i++) {
              karta_history_query["and"] = [
                { "createdAt": { gte: moment().month(i).startOf('month').toDate() } },
                { "createdAt": { lte: moment().month(i).endOf('month').toDate() } }
              ]
              const achievedHistory = await Kartanode.app.models.karta_history.find({ where: karta_history_query, "order": "createdAt DESC", "limit": 1 });
              if (achievedHistory.length > 0 && achievedHistory[0].randomKey) {
                const target_query = {
                  "kartaNodeId": item._id,
                  "randomKey": achievedHistory[0].randomKey,
                  "event": "node_updated",
                  "old_options.target": { exists: true }
                }
                const targetHistory = await Kartanode.app.models.karta_history.findOne({ where: target_query });
                if (targetHistory && targetHistory.randomKey) {
                  const formula_query = {
                    "kartaNodeId": item._id,
                    "randomKey": targetHistory.randomKey,
                    "event": "node_updated",
                    "old_options.node_formula": { exists: true }
                  }
                  const formulaHistory = await Kartanode.app.models.karta_history.findOne({ where: formula_query });
                  item.nodes[i] = {
                    achieved: JSON.parse(JSON.stringify(achievedHistory[0])),
                    target: JSON.parse(JSON.stringify(targetHistory)),
                    formula: JSON.parse(JSON.stringify(formulaHistory))
                  }
                } else {
                  item.nodes[i] = {
                    achieved: null,
                    target: null,
                    formula: null
                  }
                }
              } else {
                item.nodes[i] = {
                  achieved: null,
                  target: null,
                  formula: null
                }
              }
            }
          }
        }
        next(err, result);
      });
    });
  }

  // Update kpi nodes by CSV
  Kartanode.updateKpiNodes = (nodes, next) => {
    if (nodes.length > 0) {
      nodes = nodes.filter(item => item !== null);
      nodes.forEach(async (node, index) => {
        // Find node details
        const nodeData = await Kartanode.findOne({ where: { "_id": node.id, "contributorId": Kartanode.app.currentUser.id } });

        // Prepare history params
        let randomKey = new Date().getTime().toString();
        let updatingParameters = [
          { "achieved_value": node.achieved_value },
          { "target": nodeData.target }
        ];

        // Prepare updating query
        let updateQuery = { "achieved_value": node.achieved_value, "target.0.percentage": node.percentage };
        // If node has formula
        if (node.hasOwnProperty("node_formula")) {
          updatingParameters.push({ "node_formula": nodeData.node_formula.__data });
          // Assign it's original formula
          updateQuery["node_formula"] = nodeData.node_formula.__data;
          // Update only fields values
          updateQuery["node_formula"]["fields"] = node.node_formula.fields;
        }
        Kartanode.update({ "_id": node.id, "contributorId": Kartanode.app.currentUser.id }, { $set: updateQuery }, (err, result) => {
          if (err) {
            console.log('error while update kpi nodes', err);
            next(err);
          }
          // Creating history
          for (let param of updatingParameters) createHistory(nodeData.kartaDetailId, nodeData, param, randomKey);
          if (index === nodes.length-1) next(null, "Kpi nodes updated successfully!");
        });
      });
    } else {
      let error = new Error("Please send nodes array");
      error.status = 400;
      next(error);
    }
  }

  // Get nodes details
  Kartanode.getNodesDetails = (nodeIds, next) => {
    if (nodeIds.length > 0) {
      Kartanode.find({ where: { "_id": { $in: nodeIds } } }, (err, result) => {
        next(err, result);
      });
    } else {
      let error = new Error("Please send nodeIds array");
      error.status = 400;
      next(error);
    }
  }
  
  // Update nodes and adjust weightage of all the other child nodes
  async function updateNodeAndAssignWeightage (kartaId, nodeData, randomKey, previousPhaseId = 0, previousParentId = 0) {
    await Kartanode.update({ "_id": nodeData.id } , { $set: { "parentId": convertIdToBSON(nodeData.parentId), "phaseId": convertIdToBSON(nodeData.phaseId) } });
    await reAdjustWeightage(kartaId, nodeData.parentId, nodeData.phaseId, randomKey);
    // Create new history
    if (previousPhaseId && previousParentId) {
      let old_data = {
        "id": nodeData.id,
        "parentId": convertIdToBSON(previousParentId),
        "phaseId": convertIdToBSON(previousPhaseId)
      }
      let updated_data = {
        "parentId": convertIdToBSON(nodeData.parentId),
        "phaseId": convertIdToBSON(nodeData.phaseId)
      }
      await createHistory(kartaId, old_data, updated_data, randomKey);
    }
    // Check if children exists or not
    const node_children = nodeData.children || nodeData._children;
    if (node_children && node_children.length > 0) {
      for (let children of node_children) {
        // Get all phases
        const phases = await getAllPhases(kartaId);
        const phaseId = phases[findPhaseIndex(phases, nodeData.phaseId) + 1].id;
        // Previous phase id
        let previousChildrenPhaseId = children.phaseId;
        let previousChildrenParentId = children.parentId;
        // Changing phase id
        children.phaseId = phaseId;
        if (children.hasOwnProperty("node_type")) {
          let updateQuery = { "contributorId": null, "target": null, "node_type": null };
          await createHistory(kartaId, children, updateQuery, randomKey);
          await Kartanode.update({ "_id": children.id }, updateQuery);
        }
        await updateNodeAndAssignWeightage(kartaId, children, randomKey, previousChildrenPhaseId, previousChildrenParentId);
      }
    }
  }

  // Drag and drop node
  Kartanode.updateNodeAndWeightage = async (kartaId, draggingNode, previousDraggedParentId, previousDraggedPhaseId, next) => {
    try {
      const randomKey = new Date().getTime();
      await updateNodeAndAssignWeightage(kartaId, draggingNode, randomKey, previousDraggedPhaseId, previousDraggedParentId );
      // Readjust the weightage of previous parent's children
      await reAdjustWeightage(kartaId, previousDraggedParentId, previousDraggedPhaseId, randomKey);
      return "Node updated successfully!";
    } catch (err) {
      console.log("===>>> Error in updateNode ", err);
      return err;
    }
  }

  // Soft delete Karta Nodes
  Kartanode.deleteNodes = (kartaId, nodeId, phaseId, parentId, next) => {
    // Creating a random key for history event
    const randomKey = new Date().getTime();
    // Finding the node to delete it
    Kartanode.findOne({ where: { "_id": nodeId } }, (err, node) => {
      if (node) {
        // Creating history of the node which will be deleted
        createHistory(kartaId, JSON.parse(JSON.stringify(node)), JSON.parse(JSON.stringify(node)), randomKey, "node_removed");
        // Deleting the node
        Kartanode.update( { "_id": nodeId } , { $set: { "is_deleted": true } }, async (err) => {
          if (err) {
            console.log('error while soft deleting karta Nodes', err);
            return next(err);
          } else {
            // Finding the child nodes of the deleted node
            Kartanode.find({ where: { "parentId": nodeId, is_deleted: false } }, (err, result) => {
              if (err) console.log('> error while finding child nodes', err);
              // Deleting the nested child nodes
              else if (result.length > 0) deleteChildNodes(result, randomKey);
            });
            reAdjustWeightage(kartaId, parentId, phaseId, randomKey);
            return next(null, "Node deleted successfully..!!");
          }
        });
      }
    });
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
        const currentMonthStartDate = moment().startOf('month');
        const currentMonthEndDate = moment().endOf('month');
        const previousMonthStartDate = moment().subtract(1, 'months').startOf('month');
        const previousMonthEndDate = moment().subtract(1, 'months').endOf('month');

        const currentYearStartDate = moment().startOf('year');
        const currentYearEndDate = moment().endOf('year');
        const previousYearStartDate = moment().subtract(1, 'years').startOf('year');
        const previousYearEndDate = moment().subtract(1, 'years').endOf('year');
        let currentMonthQuery;
        let previousMonthQuery;

        if ( type == "month-over-month" ) {
          currentMonthQuery = {
            event: "node_updated",
            kartaNodeId: nodeId,
            and: [
              { "createdAt": { gte: currentMonthStartDate } },
              { "createdAt": { lte: currentMonthEndDate } }
            ]
          };
  
          previousMonthQuery = {
            event: "node_updated",
            kartaNodeId: nodeId,
            and: [
              { "createdAt": { gte: previousMonthStartDate } },
              { "createdAt": { lte: previousMonthEndDate } }
            ]
          };
        } else if ( type == "year-over-year" ) {
          currentMonthQuery = {
            event: "node_updated",
            kartaNodeId: nodeId,
            and: [
              { "createdAt": { gte: currentYearStartDate } },
              { "createdAt": { lte: currentYearEndDate } }
            ]
          };
  
          previousMonthQuery = {
            event: "node_updated",
            kartaNodeId: nodeId,
            and: [
              { "createdAt": { gte: previousYearStartDate } },
              { "createdAt": { lte: previousYearEndDate } }
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
  Kartanode.afterRemote('create', async function (context, node, next) {
    const kartaId = node.kartaDetailId;
    const currentNodeId = node.id;
    const phaseId = node.phaseId;
    const parentId = node.parentId;
    const nextPhaseId = context.req.body.nextPhaseId;
    const randomKey = new Date().getTime();

    if (kartaId) {
      // Find details of current karta
      const karta = await Kartanode.app.models.karta.findOne({ where: { "_id": kartaId } });
      // Find sibling nodes of current node
      const childrens = await Kartanode.find({ where: { "_id": { ne: currentNodeId }, "kartaDetailId": kartaId, parentId, phaseId, "is_deleted": false } });
      // If children exists
      if (childrens.length > 0) {
        // Prepare nodeIds list
        let nodeIds = [];
        childrens.forEach(element => nodeIds.push(element.id));
        // Find if we have nested children
        const nestedChildrens = await Kartanode.findOne({ where: { "parentId": { inq: nodeIds }, "kartaDetailId": kartaId, "phaseId": nextPhaseId, "is_deleted": false } });
        // Divide weightage, if we not have nested children
        if (!nestedChildrens) {
          const weightage = + (100 / (childrens.length + 1)).toFixed(2);
          // Assign divided weightage to all the nodes of that phase of current karta
          await Kartanode.updateAll({ "kartaDetailId": kartaId, parentId, phaseId, "is_deleted": false }, { weightage });
          // Make history of updated nodes
          childrens.forEach(async item => {
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
              old_options: { weightage: item.weightage },
              randomKey
            }
            // Create history of updated node
            const history = await Kartanode.app.models.karta_history.create(history_data);
            await Kartanode.app.models.karta.update({ "id": kartaId }, { "historyId": history.id });
          });
        }
      }
      // Create history of current node
      let created_node = { ...node.__data }
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
        },
        randomKey
      }
      // Create history of current node
      const history = await Kartanode.app.models.karta_history.create(history_data);
      await Kartanode.app.models.karta.update({ "id": kartaId }, { "historyId": history.id });
    }
  });

  // Include childrens when fetching nodes by kartaId
  Kartanode.observe("access", (ctx, next) => {
    if (!ctx.query.include && ctx.query.where) {
      ctx.query.include = ["children", "phase"];
      if (!ctx.query.where.is_deleted) ctx.query.where.is_deleted = false;
    }
    next();
  });

  // Update assigned date when a contributor added in a given node
  Kartanode.afterRemote('prototype.patchAttributes', function(context, instance, next) {
    const req = context.req;
    if (req.body.contributorId) {
      Kartanode.update({ "_id": instance.id, $set: { "assigned_date": new Date() } }, (err, result) => {
        if (err) {
          console.log('> error while updating the node data ', err);
          next(err);
        }   

        if (Kartanode.app.currentUser.id.toString() !== req.body.contributorId.toString()) {
          // Prepare notification collection data
          let notificationObj = {
            title: `${Kartanode.app.currentUser.fullName} has added you as contributor for node ${instance.name}`,
            type: "contributor_added",
            contentId: instance.id,
            userId: req.body.contributorId
          };
  
          // Insert data in notification collection
          Kartanode.app.models.notification.create(notificationObj, err => {
            if (err) {
              console.log('> error while inserting data in notification collection', err);
              next(err);
            }
          });
        }
        next(null, result);
      });
    };
    let kartaId = instance.kartaId || instance.kartaDetailId;
    Kartanode.app.models.karta.findOne({ where: { "id": kartaId }}, (err, karta) => {
      if (err) {
        next(err);
      }
      Kartanode.app.models.user.findOne({ where: { "id": karta.userId }}, (err, userData) => {
        if (err) {
          next(err);
        }
        Kartanode.app.models.karta.update( { "id": kartaId }, { updatedAt: instance.updatedAt }, (err, result) => {
          if (err) {
            next(err);
          } else if (userData.sforceId) {
            sales_update_user({ sforceId: userData.sforceId }, { activeKarta: karta.name, kartaLastUpdate: instance.updatedAt });
          }
          if (!req.body.contributorId) next();
        });
      });
    });
  });
};
