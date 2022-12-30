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
    if (type === "shared")  column = "email";

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

  async function createCopyKartaNodes(newVersion, newKarta) {
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
        data.push({ email: newEmails[i] });
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
  Karta.getAll = (findBy, searchQuery, type, page, limit, next) => {
    page = parseInt(page, 10) || 1;
    limit = parseInt(limit, 10) || 100;

    let search_query = searchQuery ? searchQuery.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : "";

    let query = {};
    if (type === "shared") query = { "sharedTo.email": findBy, "is_deleted": false }
    else {
      findBy = Karta.getDataSource().ObjectID(findBy);
      query = { "userId": findBy, "is_deleted": false }
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

  // Delete
  Karta.delete = (kartaId, next) => {
    Karta.update( { "_id": kartaId } , { $set: { "is_deleted": true } }, (err) => {
      if(err){
        console.log('error while soft deleting karta', err);
        return next(err);
      }
      else {
        Karta.app.models.karta_node.update({ or: [ { "kartaId": kartaId }, { "kartaDetailId": kartaId } ] }, { $set: { "is_deleted": true }}, async (err, result) => {
            if (err) console.log('> error while deleting karta', err);
            const kartaDetails = await Karta.findOne({ where: { "id": kartaId } });
            const userDetails = await Karta.app.models.user.findOne({ where: {"id": kartaDetails.userId }});
            sales_update_user({ sforceId: userDetails.sforceId }, { deleteKarta: kartaDetails.name, kartaLastUpdate: kartaDetails.updatedAt })
            next(null, "Karta deleted successfully..!!");
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

       // Fetching version details of that karta
       const versionDetails = await Karta.app.models.karta_version.find({ where: { kartaId: kartaDetails.id, id: kartaDetails.versionId }});
       let lastHistoryOfKartaVersion = "";
       let finalVersionId = "";

       // Looping through each version of that karta till latest version 
       for ( let i = 0; i < versionDetails.length; i++ ) {
        const currentVersion = versionDetails[i];
        const newVersion = await Karta.app.models.karta_version.create({ "name" : "1", "kartaId": newKarta.id });
        const oldVersionHistory = await Karta.app.models.karta_history.find({ where: { versionId: currentVersion.id, kartaId }});

        // Creating Karta History for new Karta
        await createCopyKartaHistory(oldVersionHistory, newVersion, newKarta);

        // Creating Karta Nodes for new karta based on history
        let data = await createCopyKartaNodes(newVersion, newKarta);
        if ( data.length > 0 ) {
          lastHistoryOfKartaVersion = data[0];
          finalVersionId = data[1];
        }

        await Karta.app.models.karta_history.remove({ kartaId: newKarta.id, versionId: newVersion.id })
      }

      if ( lastHistoryOfKartaVersion && finalVersionId ) {
        await Karta.update( { "id": newKarta.id }, { versionId: finalVersionId, historyId: lastHistoryOfKartaVersion } );
        await Karta.update( { "id": kartaDetails.id }, { selfCopyCount: parseInt(kartaDetails.selfCopyCount) + 1 } );
      }

      return "Karta copy created successfully..!!";
    }
    catch(err) {
      console.log(err);
    }
  }

  // View Previous month karta
  Karta.viewKartaDetails = async (type, number, kartaId, next) => {
    try {
      // Find the latest Karta version history ----
      let GetKartaInfo = await Karta.find({ where: { "id": kartaId }, include: ["node"]});
      let kartaData = JSON.parse(JSON.stringify(GetKartaInfo[0]));
      const latestVersionHistory = await Karta.app.models.karta_history.find({ where: { kartaId, versionId: kartaData.versionId } });

      // Find the requested Karta version history ----
      // Search Query
      const searchQuery = { kartaId };
      if ( type == "quarter" ) {
        searchQuery["createdAt"] = { lte: moment().quarter(number).endOf('quarter') }
      } else if ( type == "month" ) {
        searchQuery["createdAt"] = { lte: moment().month(number-1).endOf('month') }
      } else if ( type == "week" ) {
        let cur_week_num = moment().isoWeek() - moment().subtract('days', moment().date() - 1).isoWeek() + 1;
        let total_weeks = ( moment().week() - ( moment().month() * 4 ));
        let week = cur_week_num - number;
        week = week < 0 ? -week : week;
        var queryDate = moment().add(week, 'weeks').endOf('week')
        searchQuery["createdAt"] = { lte: queryDate }
      }

      // Finding version which was created before the requested time
      const versionDetails = await Karta.app.models.karta_version.find({ where: searchQuery });
      if ( versionDetails.length > 0 ) {
        const requestedVersion = versionDetails[versionDetails.length - 1];

        // Finding requested karta history before the requested time 
        const requestedVersionHistory = await Karta.app.models.karta_history.find({ where: { ...searchQuery, versionId: requestedVersion.id } });
        const lastHistoryObject = requestedVersionHistory[requestedVersionHistory.length - 1];

        // Comparing Latest Karta History with Requested Karta History
        const historyIndex = latestVersionHistory.findIndex(x => {
          if ( x.event == lastHistoryObject.event && JSON.stringify(x.kartaNodeId) == JSON.stringify(lastHistoryObject.kartaNodeId) ) {
            if ( x.event == "node_created" || x.event == "node_removed" ) {
              return x;
            } else {
              let newObj = {};
              let flagCheck = false;
              Object.keys(x.old_options).forEach(key => {
                newObj[key] = x.old_options[key];
              });

              if (Object.keys(lastHistoryObject.old_options).length == Object.keys(x.old_options).length) {
                Object.keys(lastHistoryObject.old_options).forEach(key => {
                  if ( newObj.hasOwnProperty(key) ) {
                    if( typeof lastHistoryObject.old_options[key] == 'string' || typeof lastHistoryObject.old_options[key] == 'number' || typeof lastHistoryObject.old_options[key] == 'boolean'){
                      newObj[key] == lastHistoryObject.old_options[key] ? flagCheck = true : flagCheck = false;
                    } else if ( typeof lastHistoryObject.old_options[key] == 'object' ) {
                      Object.keys(newObj[key]).length == Object.keys(lastHistoryObject.old_options[key]).length ? flagCheck = true : flagCheck = false; 
                    } else {
                      newObj[key].length == lastHistoryObject.old_options[key].length ? flagCheck = true : flagCheck = false;
                    }
                  } else {
                    flagCheck = false;
                  }
                });
              } else {
                flagCheck = false;
              }

              if( flagCheck ){
                return x;
              }
            }
          }
        });

        // Latest Karta History - Requested Karta History = History to Undo from main karta data 
        const filteredHistory = latestVersionHistory.slice(historyIndex+1, latestVersionHistory.length);
        
        // Performing Undo functionality on main kartaData
        let kartaNode = kartaData.node;
        for ( let i = filteredHistory.length - 1; i >= 0; i-- ) {
          let currentHistoryObj = filteredHistory[i];
          if ( currentHistoryObj.event == "node_created" ) {
            function updateData(data) {
              if ( data && JSON.stringify(data.id) == JSON.stringify(currentHistoryObj.kartaNodeId) ) {
                return true;
              }
              else {
                  if ( data && data.children && data.children.length > 0 ) {
                    for(let j = 0; j < data.children.length; j++) {
                      let value = updateData(data.children[j]);
                      if (value) {
                          delete data.children[j];
                          break;
                      }
                    }
                  }
              }
            }
            updateData(kartaNode);
          } else if ( currentHistoryObj.event == "node_updated" ) {
            function updateData(data) {
              if ( data && JSON.stringify( data.id ) == JSON.stringify( currentHistoryObj.kartaNodeId ) ) {
                Object.keys(currentHistoryObj.old_options).map(x => {
                  data[x] = currentHistoryObj.old_options[x];
                });
              }
              else {
                  if ( data && data.children && data.children.length > 0 ) {
                    for( let j = 0; j < data.children.length; j++ ) {
                      updateData(data.children[j]);
                      break;
                    }
                  }
              }
            }
            updateData(kartaNode);
          } else if ( currentHistoryObj.event == "node_removed" ) {
            function updateData(data) {
              if (JSON.stringify(data.id) == JSON.stringify(currentHistoryObj.parentNodeId) ) {
                let tempNode = {
                  ...currentHistoryObj.event_options.removed,
                  id: currentHistoryObj.kartaNodeId
                };
                return data.children && data.children.length > 0 ? data.children.push(tempNode) : data['children'] = [tempNode];
              }
              else {
                  if ( data && data.children && data.children.length > 0 ) {
                    for(let j = 0; j < data.children.length; j++) {
                      updateData(data.children[j]);
                      break;
                    }
                  }
              }
            }
            updateData(kartaNode);
          }
        }

        // Remove null from children arrays
        function nullRemover( data ) {
          if( data && data.children ) {
            data.children = data.children.filter( x => x!== null );
            if ( data.children.length > 0 ) {
              for(let i = 0; i < data.children.length; i++) {
                nullRemover(data.children[i]);
              }
            }
          } else return;
        }
        nullRemover(kartaNode);
        kartaData["node"] = kartaNode;

        return { message: "Karta data found..!!", data: kartaData };
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
      Karta.app.models.karta_version.create({ "name" : "1", "kartaId": karta.id }, {} , async (err, result) => {
        if (err) {
          console.log('> error while creating karta version', err);
          return next(err);
        } else {
          const userDetails = await Karta.app.models.user.findOne({ where: { "id": karta.userId }});
          if (userDetails) {
            await sales_update_user({ sforceId: userDetails.sforceId }, { activeKarta: karta.name, kartaLastUpdate: karta.updatedAt });
          }
          Karta.update({ "id" : karta.id }, { "versionId" : result.id, "selfCopyCount": 0, "sharedCopyCount": 0 }, (err, data) => {
            if (err) {
              console.log('> error while updating newly crated karta', err);
              return next(err);
            } else next();
          });
        }
      });
    });

    Karta.afterRemote('prototype.patchAttributes', function(context, instance, next) {
      const req = context.req;
      if (req.body.updatedAt) {
        sales_update_user({ sforceId: instance.karta_sforceId }, { activeKarta: instance.name, kartaLastUpdate: instance.updatedAt });
        next();
      } else next();
    });
};