'use strict';

const moment = require('moment');
const { sendEmail } = require('../../helper/sendEmail');

module.exports = function(Karta) {
  /* QUERY VARIABLES
    ----------------*/
    // Sort
    const SORT = {
      $sort: { createdAt: -1 }
    }
  // User lookup with id or email
  const USER_LOOKUP = (findBy, type) => {
    let column = "_id";
    if (type === "shared") column = "email";

      return {
          $lookup: {
              from: "user",
              let: {
                  find_by: findBy
              },
              pipeline: [
                { 
                  $match: { 
                    $expr: { $eq: ["$" + column, "$$find_by"] }
                  } 
                },
                {
                  $project: { "fullName": 1, "email": 1 }
                }
              ],
              as: "user"
          }
      }
  }
  const ALL_USER_LOOKUP = {
    $lookup: {
      from: 'user',
      localField: 'userId',
      foreignField: '_id',
      as: 'user'
    }
  }
  const UNWIND_USER = {
      $unwind: "$user"
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



/* =============================CUSTOM METHODS=========================================================== */
  // Copy Karta Functions Starts----------------
  // Might face issue while copying because phase is not updating while creating this new history - Debug event_options
  async function createCopyKartaHistory(oldVersionHistory, newVersion, newKarta) {
    for ( let k = 0; k < oldVersionHistory.length; k++ ) {
      let history_data = {
        event: oldVersionHistory[k].event,
        event_options: oldVersionHistory[k].event_options,
        kartaNodeId: oldVersionHistory[k].kartaNodeId,
        versionId: newVersion.id,
        userId: oldVersionHistory[k].userId,
        kartaId: newKarta.id,
        historyType: oldVersionHistory[k].historyType,
      };
      oldVersionHistory[k].parentNodeId ? history_data["parentNodeId"] = oldVersionHistory[k].parentNodeId : null;
      await Karta.app.models.karta_history.create(history_data);
    }
  }

  async function createCopyKartaNodes(newVersion, newKarta, phaseMapping) {
    await Karta.app.models.karta_node.remove({ or: [{ kartaId: newKarta.id }, { kartaDetailId: newKarta.id }] });

    // Retrieving history of the newly created karta for particular version
    let tempHistoryData = await Karta.app.models.karta_history.find({ where: { versionId: newVersion.id , kartaId: newKarta.id , historyType: 'temp', "undoCheck" : false }}); 
    let mainHistoryData = await Karta.app.models.karta_history.find({ where: { versionId: newVersion.id , kartaId: newKarta.id , historyType: 'main', "undoCheck" : false }});
    let finalHistoryData = tempHistoryData.concat(mainHistoryData);
    
    // Looping through history to create Karta Nodes
    for( let j = 0; j < finalHistoryData.length; j++ ) {
      if( finalHistoryData[j].event == "node_created" ) {
        // Node created working functionality based on history event
        if( finalHistoryData[j].parentNodeId ) {
          let newObj = {
              ...finalHistoryData[j].event_options.created,
              parentId: finalHistoryData[j].parentNodeId,
              kartaDetailId: newKarta.id,
          };
          let newKartaNodeChild = await Karta.app.models.karta_node.create( newObj );
          await Karta.app.models.karta_history.update({ "parentNodeId": finalHistoryData[j].kartaNodeId, kartaId: newKarta.id, versionId: newVersion.id }, { "parentNodeId": newKartaNodeChild.id });
          await Karta.app.models.karta_history.update({ "kartaNodeId": finalHistoryData[j].kartaNodeId, kartaId: newKarta.id, versionId: newVersion.id }, { "kartaNodeId": newKartaNodeChild.id });
          await Karta.app.models.karta_history.update({ "id": finalHistoryData[j].id, kartaId: newKarta.id, versionId: newVersion.id }, { event_options: { "created": newObj, "updated": null, "removed": null } });
          let tempHistoryData = await Karta.app.models.karta_history.find({ where: { versionId: newVersion.id, kartaId: newKarta.id, historyType: 'temp', "undoCheck" : false }}); 
          let mainHistoryData = await Karta.app.models.karta_history.find({ where: { versionId: newVersion.id, kartaId: newKarta.id, historyType: 'main', "undoCheck" : false }});
          finalHistoryData = tempHistoryData.concat(mainHistoryData);
        }
        else {
          let newObj = {
            ...finalHistoryData[j].event_options.created,
            kartaId: newKarta.id,
          };
          let newKartaNode = await Karta.app.models.karta_node.create( newObj );
          await Karta.app.models.karta_history.update({ "parentNodeId": finalHistoryData[j].kartaNodeId, kartaId: newKarta.id, versionId: newVersion.id }, { parentNodeId: newKartaNode.id });
          await Karta.app.models.karta_history.update({ "kartaNodeId": finalHistoryData[j].kartaNodeId, kartaId: newKarta.id, versionId: newVersion.id }, { kartaNodeId: newKartaNode.id });
          await Karta.app.models.karta_history.update({ "id": finalHistoryData[j].id, kartaId: newKarta.id, versionId: newVersion.id }, { event_options: { "created": newObj, "updated": null, "removed": null } });
          let tempHistoryData = await Karta.app.models.karta_history.find({ where: { versionId: newVersion.id, kartaId: newKarta.id, historyType: 'temp', "undoCheck" : false }}); 
          let mainHistoryData = await Karta.app.models.karta_history.find({ where: { versionId: newVersion.id, kartaId: newKarta.id, historyType: 'main', "undoCheck" : false }});
          finalHistoryData = tempHistoryData.concat(mainHistoryData);
        }
      }
      else if ( finalHistoryData[j].event == "node_updated" ) {
        // Node Updated working functionality based on history event
        if( finalHistoryData[j].event_options.updated.parentId ) {
          let newObj = {
            ...finalHistoryData[j].event_options.updated,
            parentId: finalHistoryData[j].parentNodeId,
          };
          await Karta.app.models.karta_history.update( { "id": finalHistoryData[j].id }, { event_options: { "created": null, "updated": newObj, "removed": null } } );
          let tempHistoryData = await Karta.app.models.karta_history.find({ where: { versionId: newVersion.id, kartaId: newKarta.id, historyType: 'temp', "undoCheck" : false }}); 
          let mainHistoryData = await Karta.app.models.karta_history.find({ where: { versionId: newVersion.id, kartaId: newKarta.id, historyType: 'main', "undoCheck" : false }});
          finalHistoryData = tempHistoryData.concat(mainHistoryData);
          await Karta.app.models.karta_node.update( { "id": finalHistoryData[j].kartaNodeId }, finalHistoryData[j].event_options.updated );
        } else {
          if(!finalHistoryData[j].event_options.updated.hasOwnProperty("contributorId") && !finalHistoryData[j].event_options.updated.hasOwnProperty("achieved_value") && !finalHistoryData[j].event_options.updated.hasOwnProperty("notifyUserId")){
            await Karta.app.models.karta_node.update( { "id": finalHistoryData[j].kartaNodeId }, finalHistoryData[j].event_options.updated );
          }
        }
      }
      else if ( finalHistoryData[j].event == "node_removed" ) {
        // Node Removed working functionality based on history event
        await Karta.app.models.karta_node.remove( { "id": finalHistoryData[j].kartaNodeId } );
      }

      if( j == finalHistoryData.length - 1 ){
        return [finalHistoryData[j].id, finalHistoryData[j].versionId];
      }
    }
  }

  // Copy Karta Functions Ends----------------

  // Share karta to multiple users
  Karta.share = (karta, emails, accessType, next) => {

    let kartaId = "";
    if (karta.hasOwnProperty("id")) kartaId = karta.id;
    else kartaId = karta._id ;

    // Check if any email has already been shared to the karta or not
    let duplicateFlag = false;
    let alreadySharedList = karta.sharedTo ? karta.sharedTo.map(x => x.email) : [];
    let newEmails = emails.filter(email => {
      if (alreadySharedList.includes(email)) {
        duplicateFlag = true;
        return null;
      } else return email;
    });

    if (newEmails.length > 0) {
      // Remove duplicate emails
      newEmails = [...new Set(newEmails)];
      // Prepare data for updating in the sharedTo field
      let data = [];
      for (let i = 0; i < newEmails.length; i++) {
        data.push({ email: newEmails[i], accessType });
      }

      Karta.update({ "_id": kartaId }, { $addToSet: { "sharedTo": { $each: data } } }, (err) => {
        if (err) console.log('> error while updating the karta sharedTo property ', err);
        else {
          next(null, "Karta shared successfully!");
          // Find existing users in the system
          Karta.app.models.user.find({ where: { "email": { inq: newEmails } } }, (err, users) => {
            if (err) console.log('> error while finding users with emails', err);
            else {
              // Prepare notification collection data
              let notificationData = [];
              users.forEach(item => {
                notificationData.push({
                  title: `${Karta.app.currentUser.fullName} shared the ${karta.name}`,
                  click_type: accessType,
                  type: "karta_shared",
                  contentId: karta._id,
                  userId: item.id
                });
              });
              // Insert data in notification collection
              Karta.app.models.notification.create(notificationData, err => {
                if (err) console.log('> error while inserting data in notification collection', err);
              });
              // Separate emails that are not existing in the system
              newEmails = newEmails.filter(email => !(users.some(item => item.email === email)));
              let kartaLink = `${process.env.WEB_URL}/karta/${accessType}/${karta._id}`;
              // Send email to users
              newEmails.forEach(email => {
                const data = {
                  subject: `${Karta.app.currentUser.fullName} has shared a karta with you`,
                  template: "share-karta.ejs",
                  email: email,

                  user: Karta.app.currentUser,
                  kartaLink
                }
                sendEmail(Karta.app, data, () => { });
              });
            }
          });
        }
      });
    } else {
      if (duplicateFlag) {
        let error = new Error("Can't share a karta twice to the same user!");
        error.status = 400;
        next(error);
      } else {
        let error = new Error("Please send an email array");
        error.status = 400;
        next(error);
      }
    }
  }

  // Get all kartas
  Karta.getAll = (findBy, searchQuery, type, findType, page, limit, next) => {
    page = parseInt(page, 10) || 1;
    limit = parseInt(limit, 10) || 100;

    let search_query = searchQuery ? searchQuery.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : "";
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

    // Find for champions only
    if (findType === "contributor") {
      Karta.app.models.karta_node.find({ where: { "contributorId": findBy, "is_deleted": false } }, (err, result) => {
        if (err) next(err);
        else {
          let kartaIds = result.map(item => item.kartaDetailId);
          Karta.getDataSource().connector.connect(function (err, db) {
            const KartaCollection = db.collection('karta');
            KartaCollection.aggregate([
              {
                $match: { "_id": { $in: kartaIds } }
              },
              SEARCH_MATCH,
              ALL_USER_LOOKUP,
              UNWIND_USER,
              SORT,
              FACET(page, limit)
            ]).toArray((err, result) => {
              if (result) result[0].data.length > 0 ? result[0].metadata[0].count = result[0].data.length : 0;
              next(err, result);
            });
          });
        }
      });
    }
    // Find for Creators only
    else {
      let query = {};
      if (type === "shared") query = { "sharedTo.email": findBy, "is_deleted": false }
      else {
        findBy = Karta.getDataSource().ObjectID(findBy);
        query = { "userId": findBy, "is_deleted": false }
      }
  
      Karta.getDataSource().connector.connect(function (err, db) {
        const KartaCollection = db.collection('karta');
        KartaCollection.aggregate([
          {
            $match: query
          },
          SEARCH_MATCH,
          USER_LOOKUP(findBy, type),
          UNWIND_USER,
          SORT,
          FACET(page, limit)
        ]).toArray((err, result) => {
          if (result) result[0].data.length > 0 ? result[0].metadata[0].count = result[0].data.length : 0;
          next(err, result);
        });
      });
    }
  }

  // Get all public kartas
  Karta.getAllPublic = (searchQuery, page, limit, next) => {
    page = parseInt(page, 10) || 1;
    limit = parseInt(limit, 10) || 100;

    let search_query = searchQuery ? searchQuery.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : "";

    let query = { "type": "public", "is_deleted": false }

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

    Karta.getDataSource().connector.connect(function (err, db) {
      const KartaCollection = db.collection('karta');
      KartaCollection.aggregate([
        {
          $match: query
        },
        SEARCH_MATCH,
        ALL_USER_LOOKUP,
        UNWIND_USER,
        SORT,
        FACET(page, limit)
      ]).toArray((err, result) => {
        if (result) result[0].data.length > 0 ? result[0].metadata[0].count = result[0].data.length : 0;
        next(err, result);
      });
    });
  }

  // Delete
  Karta.delete = (kartaId, next) => {
    Karta.update( { "_id": kartaId } , { $set: { "is_deleted": true } }, (err) => {
      if(err){
        console.log('error while soft deleting karta', err);
        return next(err);
      }
      else {
        // Delete nodes
        Karta.app.models.karta_node.update({ or: [ { "kartaId": kartaId }, { "kartaDetailId": kartaId } ] }, { $set: { "is_deleted": true }}, (err, result) => {
            if (err) {
              console.log('> error while deleting karta', err);
              next(err);
            }
            // Delete phases
            Karta.app.models.karta_phase.update( { "kartaId": kartaId } , { $set: { "is_deleted": true } }, (err) => {
              if (err) {
                console.log('> error while deleting phase', err);
                return next(err);
              }
            });
            
            Karta.getDataSource().connector.connect(function (err, db) {
              const KartaNodeCollection = db.collection('karta_node');
              KartaNodeCollection.aggregate([
                {
                  $match: {
                    "kartaDetailId": Karta.getDataSource().ObjectID(kartaId),
                    "contributorId": { $exists: true }
                  }
                }
              ]).toArray((err, result) => {
                if(err) {
                  console.log('> error while finding karta contributors', err);
                  next(err);
                }
                Karta.findOne({ where: { id: kartaId }}, (err, karta) => {
                  if (err) {
                    console.log('> error while finding karta details', err);
                    next(err);
                  }

                  if(result.length > 0) {
                    // Prepare notification collection data
                    let notificationData = [];
                    for(let i = 0; i < result.length; i++) {
                      if(Karta.app.currentUser.id.toString() !== result[i].contributorId.toString()) {
                        let notificationObj = {
                          title: `${Karta.app.currentUser.fullName} has deleted the karta ${karta.name}`,
                          type: "karta_deleted",
                          contentId: kartaId,
                          userId: result[i].contributorId
                        };
                        notificationData.push(notificationObj);
                      }
                    };
                    // Insert data in notification collection
                    Karta.app.models.notification.create(notificationData, err => {
                      if (err) console.log('> error while inserting data in notification collection', err);
                    });

                    next(null, "Karta deleted successfully..!!");
                  } else {
                    next(null, "Karta deleted successfully..!!");
                  }
                });
              });
            });
        });
      }
    })
  }

  // Create Karta Copy
  Karta.copy = async (kartaId, next) => {
    try {
        // Fetching Karta Details and creating a new Karta
       const kartaDetails = await Karta.findOne({ where: { "id": kartaId }});
       let newObj = {
        name: kartaDetails.name ? kartaDetails.selfCopyCount == 0 ? kartaDetails.name + " - Copy" : `${kartaDetails.name} - Copy (${kartaDetails.selfCopyCount + 1})` : null,
        userId: kartaDetails.userId ? kartaDetails.userId : null,
        status: kartaDetails.status ? kartaDetails.status : null,
        type: kartaDetails.type ? kartaDetails.type : null
       }
       const newKarta = await Karta.create(newObj);

       //Creating new Phases for new karta
       let phaseMapping = {};
       const getPhases = await Karta.app.models.karta_phase.find({ where: { kartaId }});
       if (getPhases.length > 0) {
        for ( let x = 0; x < getPhases.length; x++ ) {
          let currentPhase = {
            ...getPhases[x].__data,
            kartaId: newKarta.id,
          };
          delete currentPhase.id;
          currentPhase["parentId"] ? currentPhase["parentId"] = phaseMapping[currentPhase["parentId"]] : null;
          const newPhase = await Karta.app.models.karta_phase.create(currentPhase);
          phaseMapping[getPhases[x].id] = newPhase.id;
        }
       }

       // Creating a new Version for new Karta 
       const newVersion = await Karta.app.models.karta_version.create({ "name" : "1", "kartaId": newKarta.id });
       await Karta.update({ "id": newKarta.id }, { versionId: newVersion.id });

       // Creating Copy of Karta Nodes
       const kartaNodeMapping = {};
       const kartaNodes = await Karta.app.models.karta_node.find({ where: { or: [{ "kartaId": kartaId }, { "kartaDetailId": kartaId } ], is_deleted: false } });
       if ( kartaNodes.length > 0 ) {
        for( let i = 0; i < kartaNodes.length; i++ ) {
          let currentNode = kartaNodes[i].__data;
          let newKartaNode = {
            ...currentNode,
            phaseId: phaseMapping[currentNode.phaseId],
            versionId: newVersion.id,
          };
          delete newKartaNode.id;
          delete newKartaNode.children;
          delete newKartaNode.phase;
          newKartaNode["contributorId"] ? delete newKartaNode["contributorId"] : null;
          newKartaNode["notify_type"] ? delete newKartaNode["notify_type"] : null;
          newKartaNode["notifyUserId"] ? delete newKartaNode["notifyUserId"] : null;
          newKartaNode["kartaId"] ? newKartaNode["kartaId"] = newKarta.id : newKartaNode["kartaDetailId"] = newKarta.id;
          const newNode = await Karta.app.models.karta_node.create(newKartaNode);
          kartaNodeMapping[currentNode.id.toString()] = newNode.id.toString();
        }

        for (let j = 0; j < kartaNodes.length; j++ ) {
          let currentNode = kartaNodes[j].__data;
          if(currentNode["parentId"]) {
            await Karta.app.models.karta_node.update({"id": kartaNodeMapping[currentNode.id]}, {"parentId": kartaNodeMapping[currentNode.parentId]});
          }
        }
       }
      
      await Karta.update( { "id": kartaDetails.id }, { selfCopyCount: parseInt(kartaDetails.selfCopyCount) + 1 } );
      return "Karta copy created successfully..!!";
    }
    catch(err) {
      console.log(err);
    }
  }

  // View previous month karta new
  Karta.viewKartaDetailsNew = async (type, number, kartaId, versionId) => {
    try {

    } catch (err) {
      console.log(err);
      throw Error(err);
    }
  }

  // View Previous month karta
  Karta.viewKartaDetails = async (type, number, kartaId, next) => {
    try {
      // Find the whole karta information including all nodes
      const kartaInfo = await Karta.find({ where: { "id": kartaId }, include: ["node"]});
      // Formatting data
      let kartaData = JSON.parse(JSON.stringify(kartaInfo[0]));
      // Find all the history of the current karta with current version id
      const latestKartaHistory = await Karta.app.models.karta_history.find({ where: { kartaId, "versionId": kartaData.versionId } });

      // Prepare query according to requested parameters
      const query = { kartaId };
      if (type == "quarter" ) {
        query["createdAt"] = { lte: moment().quarter(number).endOf('quarter') }
      } else if (type == "month" ) {
        query["createdAt"] = { lte: moment().month(number).endOf('month') }
      } else if (type == "week" ) {
        // let cur_week_num = moment().isoWeek() - moment().subtract(moment().date() - 1, 'days').isoWeek() + 1;
        // let total_weeks = ( moment().week() - ( moment().month() * 4 ));
        // let week = cur_week_num - number;
        // week = week < 0 ? -week : week;
        // var queryDate = moment().add(week, 'weeks').endOf('week')
        console.log(moment().startOf('month'))
        var queryDate = moment().startOf('month').add(number, 'weeks').endOf('week')
        query["createdAt"] = { lte: queryDate }
      }

      // Find all versions which was created before the requested time
      const versionDetails = await Karta.app.models.karta_version.find({ where: query });
      if (versionDetails.length > 0) {
        // Getting last version from that
        const requestedVersion = versionDetails[versionDetails.length - 1];
        // Setting deleted flag for all child phases of current karta
        // await Karta.app.models.karta_phase.updateAll( { kartaId, "is_child": true }, { "is_deleted": true } );

        // Finding requested karta history before the requested time
        const requestedKartaHistory = await Karta.app.models.karta_history.find({ where: { ...query, "versionId": requestedVersion.id } });
        // Getting last history event object from that
        const lastHistoryObject = JSON.parse(JSON.stringify(requestedKartaHistory[requestedKartaHistory.length - 1]));

        // Comparing Latest Karta History with Requested Karta History
        const historyIndex = latestKartaHistory.findIndex(x => {
          // Find index of the last history object from the latest karta history
          if (x.event === lastHistoryObject.event && x.kartaNodeId.toString() === lastHistoryObject.kartaNodeId.toString()) {
            // Return index of that directly, if node is created or removed
            if (x.event == "node_created" || x.event == "node_removed" || x.event == "phase_created" || x.event == "phase_removed") {
              return x;
            }
            // If node is updated, then return the last updated history index
            else if (x.event === "node_updated") {
              const newObj = JSON.parse(JSON.stringify(x.old_options));
              let flagCheck = false;

              if (Object.keys(lastHistoryObject.old_options).length === Object.keys(x.old_options).length) {
                Object.keys(lastHistoryObject.old_options).forEach(key => {
                  if (newObj.hasOwnProperty(key)) {
                    if (typeof lastHistoryObject.old_options[key] === 'string' || typeof lastHistoryObject.old_options[key] === 'number' || typeof lastHistoryObject.old_options[key] === 'boolean') {
                      newObj[key] === lastHistoryObject.old_options[key] ? flagCheck = true : flagCheck = false;
                    } else if (typeof lastHistoryObject.old_options[key] === 'object') {
                      Object.keys(newObj[key]).length === Object.keys(lastHistoryObject.old_options[key]).length ? flagCheck = true : flagCheck = false; 
                    } else {
                      newObj[key].length == lastHistoryObject.old_options[key].length ? flagCheck = true : flagCheck = false;
                    }
                  } else flagCheck = false;
                });
              } else flagCheck = false;
              if (flagCheck) return x;
            }
            // If phase is updated, then return the last updated history index
            else if (x.event === "phase_updated") {
              let flagCheck = false;
              if (Object.keys(lastHistoryObject.old_options).length === Object.keys(x.old_options).length) {
                if (lastHistoryObject.old_options.name === x.old_options.name) flagCheck = true;
                else flagCheck = false;
              } else flagCheck = false;
              if (flagCheck) return x;
            }
          }
        });

        // Latest Karta History - Requested Karta History = History to Undo from main karta data 
        const filteredHistory = latestKartaHistory.slice(historyIndex + 1, latestKartaHistory.length);
        
        // Performing Undo functionality on main kartaData
        let kartaNode = kartaData.node;
        let phaseIds = [];
        let updatedPhaseIds = {};
        for (let i = filteredHistory.length - 1; i >= 0; i--) {
          let currentHistoryObj = filteredHistory[i];
          // CHECKING FOR NODES
          if (currentHistoryObj.event == "node_created") {
            function updateData(data) {
              if (data && data.id.toString() === currentHistoryObj.kartaNodeId.toString()) {
                return true;
              } else if (data && data.children && data.children.length > 0) {
                for (let j = 0; j < data.children.length; j++) {
                  let value = updateData(data.children[j]);
                  if (value) {
                    let tempChildren = data.children[j].children;
                    delete data.children[j];
                    data.children = [...tempChildren, data.children[j]];
                    break;
                  }
                }
              }
            }
            updateData(kartaNode);
          } else if (currentHistoryObj.event == "node_updated") {
            function updateData(data) {
              if (data && data.id.toString() === currentHistoryObj.kartaNodeId.toString()) {
                Object.keys(currentHistoryObj.old_options).map(x => {
                  data[x] = JSON.parse(JSON.stringify(currentHistoryObj.old_options[x]));
                });
              } else if (data && data.children && data.children.length > 0) {
                for (let j = 0; j < data.children.length; j++) {
                  updateData(data.children[j]);
                }
              }
            }
            updateData(kartaNode);
          } else if (currentHistoryObj.event == "node_removed") {
            function updateData(data) {
              if (data && data.id.toString() === currentHistoryObj.parentNodeId.toString()) {
                let tempNode = {
                  ...currentHistoryObj.event_options.removed,
                  id: currentHistoryObj.kartaNodeId
                }
                return data.children && data.children.length > 0 ? data.children.push(tempNode) : data['children'] = [tempNode];
              } else if (data && data.children && data.children.length > 0) {
                for(let j = 0; j < data.children.length; j++) {
                  updateData(data.children[j]);
                  break;
                }
              }
            }
            updateData(kartaNode);
          }
          // CHECKING FOR PHASES
          if (currentHistoryObj.event === "phase_created") {
            phaseIds.push(currentHistoryObj.kartaNodeId.toString());
          } else if (currentHistoryObj.event == "phase_updated") {
            updatedPhaseIds[i] = {
              key: filteredHistory[i].kartaNodeId,
              value: filteredHistory[i].old_options
            }
            // phaseIds.push(currentHistoryObj.kartaNodeId.toString());
          } else if (currentHistoryObj.event == "phase_removed") {
            phaseIds = phaseIds.filter(item => item !== filteredHistory[i].kartaNodeId);
          }
        }

        // Getting phases
        let phases = await Karta.app.models.karta_phase.find({ where: { kartaId, or: [ { "id": { nin: phaseIds } }, { "is_child": false } ] } });
        // Updating phases properties
        phases = phases.map(item => {
          Object.values(updatedPhaseIds).forEach(el => {
            if (el.key.toString() === item.id.toString()) item.name = el.value.name;
          });
          return item;
        });

        // Remove null from children arrays
        function nullRemover(data) {
          if (data && data.children) {
            data.children = data.children.filter( x => (x !== null && x !== undefined) );
            if (data.children.length > 0) {
              for (let i = 0; i < data.children.length; i++) {
                nullRemover(data.children[i]);
              }
            }
          } else return;
        }
        nullRemover(kartaNode);
        kartaData["node"] = kartaNode;

        return { message: "Karta data found..!!", karta: { kartaData, phases } };
      } else {
        return { message: "Karta was not created before the requested timeframe..!!", data: null };
      }
    }
    catch(err) {
      console.log(err);
    }
  }

/* =============================REMOTE HOOKS=========================================================== */
    Karta.afterRemote('create', function(context, karta, next) {
      // Create Version
      Karta.app.models.karta_version.create({ "name" : "1", "kartaId": karta.id }, {} , (versionErr, versionResult) => {
        if (versionErr) {
          console.log('> error while creating karta version', versionErr);
          return next(err);
        } else {
          Karta.update({ "id" : karta.id }, { "versionId" : versionResult.id, selfCopyCount: 0, sharedCopyCount: 0 }, (kartaErr, kartaResult) => {
            if (kartaErr) {
              console.log('> error while updating newly crated karta', kartaErr);
              return next(err);
            } else {
              // Get all phases
              Karta.app.models.karta_phase.find({ where: { "userId" : { "exists" : false }, "kartaId" : { "exists" : false } } }, (phaseErr, phaseResult) => {
                if (phaseErr) {
                  console.log('> error while fetching all global phases', phaseErr);
                  return next(err);
                } else {
                  let phases = [];
                  phaseResult.forEach(element => {
                    phases.push({
                      "name": element.name,
                      "global_name": element.name,
                      "is_global": true,
                      "phaseId": element.id,
                      "kartaId": karta.id,
                      "userId": karta.userId
                    });
                  });
                  // Create a copy of global phases for current karta
                  Karta.app.models.karta_phase.create(phases, (phaseErr2, phaseResult2) => {
                    if (phaseErr2) {
                      console.log('> error while creating all global phases', phaseErr2);
                      return next(err);
                    } else next();
                  });
                }
              });
            }
          });
        }
      });
    });
};