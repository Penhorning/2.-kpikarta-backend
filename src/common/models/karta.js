'use strict';

const moment = require('moment');
const { sales_update_user } = require('../../helper/salesforce');
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
                  title: `${Karta.app.currentUser.fullName} shared the Karta - ${karta.name} with you.`,
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
  Karta.getAll = (findBy, searchQuery, type, page, limit, next) => {
    page = parseInt(page, 10) || 1;
    limit = parseInt(limit, 10) || 100;

    let search_query = searchQuery ? searchQuery.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : "";
    const SEARCH_MATCH = {
      $match: {
        $or: [
          {
            'name': {
              $regex: '^' + search_query,
              $options: 'i'
            }
          }
        ]
      }
    }

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
              $regex: '^' + search_query,
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
  Karta.delete = (kartaId, userId, next) => {
    Karta.findOne({ where: { "id": kartaId } }, (err, kartaDetails) => {
      if(err){
        console.log('error while while finding karta', err);
        return next(err);
      }
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
  
              // Delete version
              Karta.app.models.karta_version.update( { "kartaId": kartaId } , { $set: { "is_deleted": true } }, (err) => {
                if (err) {
                  console.log('> error while deleting phase', err);
                  return next(err);
                }
              });
  
              // Delete history
              Karta.app.models.karta_history.update( { "kartaId": kartaId } , { $set: { "is_deleted": true } }, (err) => {
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
                ]).toArray(async (err, result) => {
                  if(err) {
                    console.log('> error while finding karta contributors', err);
                    next(err);
                  }
  
                  if(result.length > 0) {
                    // Prepare notification collection data
                    let notificationData = [];
                    for(let i = 0; i < result.length; i++) {
                      if(result[i].contributorId && userId !== result[i].contributorId.toString()) {
                        let notificationObj = {
                          title: `${Karta.app.currentUser.fullName} has deleted the karta ${kartaDetails.name}`,
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

                    const userDetails = await Karta.app.models.user.findOne({ where: {"id": kartaDetails.userId }});
                    if (userDetails && userDetails.sforceId) {
                      sales_update_user({ sforceId: userDetails.sforceId }, { deleteKarta: kartaDetails.name, kartaLastUpdate: kartaDetails.updatedAt });
                    }
                    next(null, "Karta deleted successfully..!!");
                  } else {
                    const userDetails = await Karta.app.models.user.findOne({ where: {"id": kartaDetails.userId }});
                    if (userDetails && userDetails.sforceId) {
                      sales_update_user({ sforceId: userDetails.sforceId }, { deleteKarta: kartaDetails.name, kartaLastUpdate: kartaDetails.updatedAt });
                    }
                    next(null, "Karta deleted successfully..!!");
                  }

                });
              });
          });
        }
      })
    });
  }

  // Create Karta Copy
  Karta.oldCopy = async (kartaId, next) => {
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

  // Create Karta Copy based on History
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

      // Phase and Node Mappers
      let phaseMapping = {};
      let phaseDataMapping = {};
      let mapper = {};
      
      //Creating new Phases for new karta
      const getPhases = await Karta.app.models.karta_phase.find({ where: { kartaId, "is_child": false }});
      // const getPhases = await Karta.app.models.karta_phase.find({ where: { kartaId }});
      if (getPhases.length > 0) {
       for ( let x = 0; x < getPhases.length; x++ ) {
         let currentPhase = JSON.parse(JSON.stringify(getPhases[x])); 
         let phaseData = {
           ...currentPhase,
           kartaId: newKarta.id,
         };
         delete phaseData.id;
         phaseData["parentId"] ? phaseData["parentId"] = phaseMapping[phaseData["parentId"]] : null;
         let newPhase = await Karta.app.models.karta_phase.create(phaseData);
         newPhase = JSON.parse(JSON.stringify(newPhase));
         phaseMapping[currentPhase.id] = newPhase.id;
         phaseDataMapping[currentPhase.id] = newPhase;
       }
      }

      // Fetching karta versions
      const kartaVersions = await Karta.app.models.karta_version.find({ where: { "kartaId": kartaId }, order: "createdAt ASC"});
      let newVersionId = "";
      let lastHistoryId = "";

      // Looping through each version
      for (let i = 0; i < kartaVersions.length; i++) {
        let currentVersion = JSON.parse(JSON.stringify(kartaVersions[i]));

        // Creating new version
        let versionData = {
          name: currentVersion.name,
          kartaId: newKarta.id
        };
        (i < kartaVersions.length - 1) ? versionData["is_copied"] = true : null;
        const newVersion = await Karta.app.models.karta_version.create(versionData);

        // Fetching history of current version
        let currentVersionHistory = await Karta.app.models.karta_history.find({ where: { "kartaId": kartaId, versionId: currentVersion.id }, order: "createdAt ASC" });
        currentVersionHistory = JSON.parse(JSON.stringify(currentVersionHistory));

        // Looping through each current version history
        for (let j = 0; j < currentVersionHistory.length; j++) {
          let currentHistory = currentVersionHistory[j];
          
          if( currentHistory.event == "node_created" ) {
            let nodeData = JSON.parse(JSON.stringify({...currentHistory.event_options.created}));

            delete nodeData.children;
            delete nodeData.phase;
            nodeData["contributorId"] ? delete nodeData["contributorId"] : null;
            nodeData["notify_type"] ? delete nodeData["notify_type"] : null;
            nodeData["notifyUserId"] ? delete nodeData["notifyUserId"] : null;
            nodeData["kartaId"] ? nodeData["kartaId"] = newKarta.id : nodeData["kartaDetailId"] = newKarta.id;
            nodeData["parentId"] ? nodeData["parentId"] = mapper[nodeData.parentId] : null;
            nodeData["phaseId"] ? nodeData["phaseId"] = phaseMapping[nodeData.phaseId] : null;

            let newNode = "";
            if (i == kartaVersions.length - 1) {
              nodeData["id"] ? delete nodeData["id"] : null;
              newNode = await Karta.app.models.karta_node.create(nodeData);
              mapper[currentHistory.kartaNodeId] = newNode.id;
            } else {
              mapper[currentHistory.kartaNodeId] = currentHistory.kartaNodeId;
            }

            // Creating History
            let newHistory = {
              ...currentHistory,
              kartaId: newKarta.id,
              versionId: newVersion.id,
              kartaNodeId: newNode.id || mapper[currentHistory.kartaNodeId],
              event_options: {
                ...currentHistory.event_options,
                created: JSON.parse(JSON.stringify(newNode)) || JSON.parse(JSON.stringify(nodeData))
              },
              is_copied: true
            }

            newHistory["id"] ? delete newHistory["id"] : null;
            currentHistory.parentNodeId ? newHistory["parentNodeId"] = mapper[currentHistory.parentNodeId] : null;
            let history = await Karta.app.models.karta_history.create(newHistory);
            if(j == currentVersionHistory.length - 1) lastHistoryId = history.id;
          } else if ( currentHistory.event == "node_updated" ) {
            let newData = {
              ...currentHistory.event_options.updated
            };

            delete newData.children;
            delete newData.phase;
            newData["contributorId"] ? delete newData["contributorId"] : null;
            newData["notify_type"] ? delete newData["notify_type"] : null;
            newData["notifyUserId"] ? delete newData["notifyUserId"] : null;
            newData["parentId"] ? newData["parentId"] = mapper[newData["parentId"].toString()] : null;
            newData["phaseId"] ? newData["phaseId"] = phaseMapping[newData["phaseId"].toString()] : null;
            if (newData["target"] && newData["target"].length > 0) {
              newData["target"][0].percentage = 0;
            }
            newData["achieved_value"] ? newData["achieved_value"] = 0 : null;
            if (newData["node_formula"]) {
              newData["node_formula"]["fields"] = newData["node_formula"]["fields"].map(x => {
                return {
                  ...x,
                  fieldValue: 0
                }
              });
            }
            if (i == kartaVersions.length - 1) {
              await Karta.app.models.karta_node.update({ "id": mapper[currentHistory.kartaNodeId] }, newData );
            }

            // Creating History
            let newHistory = {
              ...currentHistory,
              kartaId: newKarta.id,
              versionId: newVersion.id,
              kartaNodeId: mapper[currentHistory.kartaNodeId],
              parentNodeId: mapper[currentHistory.parentNodeId],
              is_copied: true
            }

            newHistory["id"] ? delete newHistory["id"] : null;
            newHistory.event_options.updated["contributorId"] ? delete newHistory.event_options.updated["contributorId"] : null;
            newHistory.event_options.updated["notify_type"] ? delete newHistory.event_options.updated["notify_type"] : null;
            newHistory.event_options.updated["notifyUserId"] ? delete newHistory.event_options.updated["notifyUserId"] : null;
            currentHistory.parentNodeId ? newHistory["parentNodeId"] = mapper[currentHistory.parentNodeId] : null;
            currentHistory.event_options.updated["parentId"] ? newHistory.event_options.updated["parentId"] = mapper[currentHistory.event_options.updated["parentId"]] : null;
            currentHistory.event_options.updated["phaseId"] ? newHistory.event_options.updated["phaseId"] = phaseMapping[currentHistory.event_options.updated["phaseId"]] : null;
            currentHistory.event_options.updated["achieved_value"] ? currentHistory.event_options.updated["achieved_value"] = 0 : null;
            if (currentHistory.event_options.updated["node_formula"]) {
              currentHistory.event_options.updated["node_formula"]["fields"] = currentHistory.event_options.updated["node_formula"]["fields"].map(x => {
                return {
                  ...x,
                  fieldValue: 0
                }
              });
            }
            let history = await Karta.app.models.karta_history.create(newHistory);
            if(j == currentVersionHistory.length - 1) lastHistoryId = history.id;
          } else if ( currentHistory.event == "node_removed" ) {
            if (i == kartaVersions.length - 1) {
              await Karta.app.models.karta_node.update({ "id": mapper[currentHistory.kartaNodeId] }, { "is_deleted": true } );
            }

            // Creating History
            let newHistory = {
              ...currentHistory,
              kartaId: newKarta.id,
              versionId: newVersion.id,
              kartaNodeId: mapper[currentHistory.kartaNodeId],
              is_copied: true
            }

            newHistory["id"] ? delete newHistory["id"] : null;
            currentHistory.parentNodeId ? newHistory["parentNodeId"] = mapper[currentHistory.parentNodeId] : null;
            let history = await Karta.app.models.karta_history.create(newHistory);
            if(j == currentVersionHistory.length - 1) lastHistoryId = history.id;
          } else if ( currentHistory.event == "phase_created" ) {
            let phaseData = currentHistory.event_options.created;
            if (phaseData.__data) {
              phaseData = JSON.parse(JSON.stringify(phaseData.__data));
            }
            delete phaseData["id"];
            phaseData["parentId"] ? phaseData["parentId"] = phaseMapping[phaseData.parentId] : null;
            phaseData["kartaId"] ? phaseData["kartaId"] = newKarta.id : null;
            // await Karta.app.models.karta_phase.update({ "id": phaseMapping[currentHistory.kartaNodeId], "is_deleted": true }, { "is_deleted": false } );
            // await Karta.app.models.karta_phase.update({ "id": phaseMapping[currentHistory.kartaNodeId] }, phaseData );
            if (!phaseDataMapping[currentHistory.kartaNodeId]) {
              let newPhase = await Karta.app.models.karta_phase.create(phaseData);
              phaseMapping[currentHistory.kartaNodeId] = newPhase.id;
              phaseDataMapping[currentHistory.kartaNodeId] = newPhase;
            }

            // Creating History
            let newHistory = {
              ...currentHistory,
              kartaId: newKarta.id,
              versionId: newVersion.id,
              kartaNodeId: phaseMapping[currentHistory.kartaNodeId],
              is_copied: true
            }

            newHistory["id"] ? delete newHistory["id"] : null;
            phaseDataMapping[currentHistory.kartaNodeId] ? phaseDataMapping[currentHistory.kartaNodeId] = newHistory["event_options"] = {
              created: phaseDataMapping[currentHistory.kartaNodeId],
              updated: null,
              removed: null
            } : null;
            currentHistory.parentNodeId ? newHistory["parentNodeId"] = phaseMapping[currentHistory.parentNodeId] : null;
            let history = await Karta.app.models.karta_history.create(newHistory);
            if(j == currentVersionHistory.length - 1) lastHistoryId = history.id;
          } else if ( currentHistory.event == "phase_updated" ) {
            currentHistory.event_options.updated["parentId"] ? currentHistory.event_options.updated["parentId"] = phaseMapping[currentHistory.event_options.updated["parentId"]] : null;
            currentHistory.event_options.updated["phaseId"] ? currentHistory.event_options.updated["phaseId"] = phaseMapping[currentHistory.event_options.updated["phaseId"]] : null;
            await Karta.app.models.karta_phase.update({ "id": phaseMapping[currentHistory.kartaNodeId] }, currentHistory.event_options.updated );

            // Creating History
            let newHistory = {
              ...currentHistory,
              kartaId: newKarta.id,
              versionId: newVersion.id,
              kartaNodeId: phaseMapping[currentHistory.kartaNodeId],
              is_copied: true
            }

            newHistory["id"] ? delete newHistory["id"] : null;
            currentHistory.parentNodeId ? newHistory["parentNodeId"] = phaseMapping[currentHistory.parentNodeId] : null;
            let history = await Karta.app.models.karta_history.create(newHistory);
            if(j == currentVersionHistory.length - 1) lastHistoryId = history.id;
          } else if ( currentHistory.event == "phase_removed" ) {
            await Karta.app.models.karta_phase.update({ "id": phaseMapping[currentHistory.kartaNodeId] }, { "is_deleted": true } );

            // Creating History
            let newHistory = {
              ...currentHistory,
              kartaId: newKarta.id,
              versionId: newVersion.id,
              kartaNodeId: phaseMapping[currentHistory.kartaNodeId],
              event_options: {
                created: null,
                updated: null,
                removed: phaseDataMapping[currentHistory.kartaNodeId],
              },
              is_copied: true
            }

            newHistory["id"] ? delete newHistory["id"] : null;
            currentHistory.parentNodeId ? newHistory["parentNodeId"] = phaseMapping[currentHistory.parentNodeId] : null;
            let history = await Karta.app.models.karta_history.create(newHistory);
            if(j == currentVersionHistory.length - 1) lastHistoryId = history.id;
          }
        }

        if (i == kartaVersions.length - 1) {
          newVersionId = newVersion.id;
        }
      }

      await Karta.update( { "id": kartaDetails.id }, { selfCopyCount: parseInt(kartaDetails.selfCopyCount) + 1 } );
      await Karta.update( { "id": newKarta.id }, { versionId: newVersionId, historyId: lastHistoryId } );
      return "Karta copy created successfully..!!";
    } catch(err) {
      console.log(err);
    }
  }

  // View Previous karta
  Karta.viewKartaDetails = async (type, duration, kartaId, next) => {
    try {
      // Find the whole karta information including all nodes
      const kartaInfo = await Karta.find({ where: { "id": kartaId }, include: ["node"]});
      // Formatting data
      let kartaData = JSON.parse(JSON.stringify(kartaInfo[0]));

      // Getting the latest version of the karta
      const latestVersion = await Karta.app.models.karta_version.find({ where: { kartaId }, order: "createdAt DESC" });

      // Find all the history of the current karta with current version id
      const wholeKartaHistory = await Karta.app.models.karta_history.find({ where: { kartaId, "versionId": latestVersion[0].id }, order: "createdAt DESC" });

      // Prepare query according to requested parameters
      let query = { kartaId };
      if (type == "quarter") {
        query["createdAt"] = { lte: moment().quarter(duration).endOf('quarter') }
      } else if (type == "month") {
        query["createdAt"] = { lte: moment().month(duration).endOf('month') }
      } else if (type == "week") {
        var queryDate = moment().startOf('month').startOf('week').add(duration, 'weeks');
        query["createdAt"] = { lte: queryDate }
      }

      // Find all versions which was created before the requested time
      const versions = await Karta.app.models.karta_version.find({ where: query });
      if (versions.length > 0) {
        // Getting lastest versions from that
        const latestVersion = versions[versions.length - 1];

        // Finding latest version karta history before the requested time
        const requestedKartaHistory = await Karta.app.models.karta_history.find({ where: { ...query, "versionId": latestVersion.id } });
        // Getting last history event object from that
        const lastHistoryObject = JSON.parse(JSON.stringify(requestedKartaHistory[requestedKartaHistory.length - 1]));

        // Finding the index of the last object of the requested karta history in the whole karta history
        const historyIndex = wholeKartaHistory.findIndex(x => {
          // Find index of the last history object from the latest karta history
          if (x.event === lastHistoryObject.event && x.kartaNodeId.toString() === lastHistoryObject.kartaNodeId.toString()) {
            // Return the index directly if node, phase is created or removed
            if (x.event == "node_created" || x.event == "node_removed" || x.event == "phase_created" || x.event == "phase_removed") {
              return x;
            }
            // If node is updated, then return the last updated history index
            else if (x.event === "node_updated") {
              const currentOldOptions = JSON.parse(JSON.stringify(x.old_options));
              let flagCheck = false;

              // First check, for comparing the length of the keys between both objects
              if (Object.keys(lastHistoryObject.old_options).length === Object.keys(currentOldOptions).length) {

                // Second check, for comparing the key's names between both objects
                Object.keys(lastHistoryObject.old_options).forEach(key => {
                  if (currentOldOptions.hasOwnProperty(key)) {
                    // Third check, to compare the type of values
                    if (typeof lastHistoryObject.old_options[key] === 'string' || typeof lastHistoryObject.old_options[key] === 'number' || typeof lastHistoryObject.old_options[key] === 'boolean') {
                      currentOldOptions[key] === lastHistoryObject.old_options[key] ? flagCheck = true : flagCheck = false;
                    } else if (typeof lastHistoryObject.old_options[key] === 'object') {
                      Object.keys(currentOldOptions[key]).length === Object.keys(lastHistoryObject.old_options[key]).length ? flagCheck = true : flagCheck = false; 
                    } else {
                      currentOldOptions[key].length == lastHistoryObject.old_options[key].length ? flagCheck = true : flagCheck = false;
                    }
                  } else return flagCheck = false;
                });
              } else return flagCheck = false;

              if (flagCheck) return x;
              else return -1;
            }
            // If phase is updated, then return the last updated history index
            else if (x.event === "phase_updated") {
              let flagCheck = false;
              if (Object.keys(lastHistoryObject.old_options).length === Object.keys(x.old_options).length) {
                if (lastHistoryObject.old_options.name === x.old_options.name) flagCheck = true;
                else return flagCheck = false;
              } else return flagCheck = false;
              if (flagCheck) return x;
              else return -1;
            }
          }
        });

        // Whole Karta History - Requested Karta History = History to Undo from main karta data 
        const filteredHistory = historyIndex > -1 ? wholeKartaHistory.slice(0, historyIndex) : [];
        
        // Performing Undo functionality on main kartaData
        let kartaNode = kartaData.node;
        let phaseIds = [];
        let updatedPhaseIds = {};
        // for (let i = filteredHistory.length - 1; i >= 0; i--) {
        for (let i = 0; i < filteredHistory.length; i++) {
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
                    let tempChildren = data.children[j].children || [];
                    if (tempChildren.length > 0) {
                      tempChildren = tempChildren.filter(item => item !== undefined);
                    }
                    delete data.children[j];
                    if (tempChildren.length > 0) data.children = [...tempChildren, data.children[j]];
                    else data.children = [data.children[j]];
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
        let phases = await Karta.app.models.karta_phase.find({ where: { kartaId, "is_deleted": false, or: [ { "id": { nin: phaseIds } }, { "is_child": false } ] } });
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
          Karta.update({ "id" : karta.id }, { "versionId" : versionResult.id, selfCopyCount: 0, sharedCopyCount: 0 }, async (kartaErr, kartaResult) => {
            if (kartaErr) {
              console.log('> error while updating newly crated karta', kartaErr);
              return next(err);
            } else {
              const userDetails = await Karta.app.models.user.findOne({ where: { "id": karta.userId }});
              if (userDetails && userDetails.sforceId) {
                await sales_update_user({ sforceId: userDetails.sforceId }, { activeKarta: karta.name, kartaLastUpdate: karta.updatedAt });
              }
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

    Karta.afterRemote('prototype.patchAttributes', function(context, instance, next) {
      const req = context.req;
      if (req.body.updatedAt) {
        Karta.app.models.user.findOne({ where: { "id": instance.userId }}, (err, userData) => {
          if (err) {
            next(err);
          } else if (userData.sforceId) {
            sales_update_user({ sforceId: userData.sforceId }, { activeKarta: instance.name, kartaLastUpdate: instance.updatedAt });
          }
          next();
        });
      } else next();
    });
};