'use strict';

const path = require('path');
const ejs = require('ejs');
const moment = require('moment');

module.exports = function(Karta) {
/* =============================CUSTOM METHODS=========================================================== */
  // Share karta to multiple users
  Karta.share = (karta, emails, next) => {

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
                  type: "karta_shared",
                  contentId: karta._id,
                  userId: item.id
                });
              });
              // Insert data in notification collection
              Karta.app.models.notification.create(notificationData, (err, result) => {
                if (err) console.log('> error while inserting data in notification collection', err);
              });
              // Separate emails that are not existing in the system
              newEmails = newEmails.filter(email => !(users.some(item => item.email === email)));
              let kartaLink = `${process.env.WEB_URL}//karta/edit/${karta._id}`;
              // Send email to users
              newEmails.forEach(email => {
                ejs.renderFile(path.resolve('templates/share-karta.ejs'),
                { user: Karta.app.currentUser, kartaLink }, {}, function(err, html) {
                  Karta.app.models.Email.send({
                    to: email,
                    from: Karta.app.dataSources.email.settings.transports[0].auth.user,
                    subject: `${Karta.app.currentUser.fullName} has shared a karta with you`,
                    html
                  }, function(err) {
                    console.log('> sending karta sharing email to:', email);
                    if (err) {
                      console.log('> error while sending karta sharing email', err);
                    }
                  });
                });
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
  Karta.getKartas = (userId, searchQuery, page, limit, next) => {
    page = parseInt(page, 10) || 1;
    limit = parseInt(limit, 10) || 100;

    let search_query = searchQuery ? searchQuery.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : "";

    userId = Karta.getDataSource().ObjectID(userId);

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
          $match: { "userId": userId, "is_deleted": false }
        },
        {
          $sort: { "createdAt" : -1 }
        },
        SEARCH_MATCH,
        {
          $lookup: {
            from: "user",
            let: {
                user_id: userId
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
            as: "user"
          }
        },
        {
          $unwind: "$user"
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

  // Get shared kartas
  Karta.sharedKartas = (email, searchQuery, page, limit, next) => {
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

    Karta.getDataSource().connector.connect(function (err, db) {
      const KartaCollection = db.collection('karta');
      KartaCollection.aggregate([
        {
          $match: { "sharedTo.email": email, $or: [ { "is_deleted": false }, { "is_deleted": { "$exists": false} } ] }
        },
        {
          $sort: { "createdAt" : -1 }
        },
        SEARCH_MATCH,
        {
          $lookup: {
            from: "user",
            let: {
                user_email: email
            },
            pipeline: [
              { 
                $match: { 
                  $expr: { $eq: ["$email", "$$user_email"] }
                } 
              },
              {
                $project: { "fullName": 1, "email": 1 }
              }
            ],
            as: "user"
          }
        },
        {
          $unwind: "$user"
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

  // Soft delete Karta
  Karta.softDelete = (kartaId, next) => {
    Karta.update( { "_id": kartaId } , { $set: { "is_deleted": true } }, (err) => {
      if(err){
        console.log('error while soft deleting karta', err);
        return next(err);
      }
      else {
        Karta.app.models.karta_node.update({ or: [ { "kartaId": kartaId }, { "kartaDetailId": kartaId } ] }, { $set: { "is_deleted": true }}, (err, result) => {
            if (err) console.log('> error while deleting karta', err);
            next(null, "Karta deleted successfully..!!");
        });
      }
    })
  }

  // Create Karta Copy
  Karta.copy = async (kartaId, next) => {
    try {
       const kartaDetails = await Karta.findOne({ where: { "id": kartaId }});
       let newObj = {
        name: kartaDetails.name ? kartaDetails.selfCopyCount == 0 ? kartaDetails.name + " - Copy" : `${kartaDetails.name} - Copy (${kartaDetails.selfCopyCount + 1})` : null,
        userId: kartaDetails.userId ? kartaDetails.userId : null,
        status: kartaDetails.status ? kartaDetails.status : null,
        type: kartaDetails.type ? kartaDetails.type : null
       }
       const newKarta = await Karta.create(newObj);
       const versionDetails = await Karta.app.models.karta_version.find({ where: { kartaId: kartaDetails.id }});
       let lastHistoryOfKartaVersion = "";
       let finalVersionId = "";

       for ( let i = 0; i < versionDetails.length; i++ ) {
        const currentVersion = versionDetails[i];
        const newVersion = await Karta.app.models.karta_version.create({ "name" : currentVersion.name, "kartaId": newKarta.id });

        const oldVersionHistory = await Karta.app.models.karta_history.find({ where: { versionId: currentVersion.id, kartaId }});

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

        await Karta.app.models.karta_node.remove({ or: [{ kartaId: newKarta.id }, { kartaDetailId: newKarta.id }] });

        let tempHistoryData = await Karta.app.models.karta_history.find({ where: { versionId: newVersion.id , kartaId: newKarta.id , historyType: 'temp', "undoCheck" : false }}); 
        let mainHistoryData = await Karta.app.models.karta_history.find({ where: { versionId: newVersion.id , kartaId: newKarta.id , historyType: 'main', "undoCheck" : false }});
        let finalHistoryData = tempHistoryData.concat(mainHistoryData);
        
        for( let j = 0; j < finalHistoryData.length; j++ ) {
            if( finalHistoryData[j].event == "node_created" ) {
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
                if(finalHistoryData[j].event_options.updated.parentId){
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
                  if(!finalHistoryData[j].event_options.updated.hasOwnProperty("contributorId") && !finalHistoryData[j].event_options.updated.hasOwnProperty("achieved_value")){
                    await Karta.app.models.karta_node.update( { "id": finalHistoryData[j].kartaNodeId }, finalHistoryData[j].event_options.updated );
                  }
                }
            }
            else if ( finalHistoryData[j].event == "node_removed" ) {
                await Karta.app.models.karta_node.remove( { "id": finalHistoryData[j].kartaNodeId } );
            }
            // else if ( finalHistoryData[j].event == "node_update_key_remove" ) {
            // }

            if( j == finalHistoryData.length - 1 ){
                lastHistoryOfKartaVersion = finalHistoryData[j].id;
                finalVersionId = finalHistoryData[j].versionId;
            }
        }
      }

      await Karta.update( { "id": newKarta.id }, { versionId: finalVersionId, historyId: lastHistoryOfKartaVersion } );
      await Karta.update( { "id": kartaDetails.id }, { selfCopyCount: parseInt(kartaDetails.selfCopyCount) + 1 } );

      return "Karta copy created successfully..!!";
    }
    catch(err) {
      console.log(err);
    }
  }

  // View Previous month karta
  Karta.viewKartaDetails = async (type, number, kartaId, kartaData, next) => {
    try {
      // Find the latest Karta version history ----
      const kartaDetails = await Karta.findOne({ where: { "id": kartaId } });
      const latestVersionHistory = await Karta.app.models.karta_history.find({ where: { kartaId, versionId: kartaDetails.versionId } });

      // Find the requested Karta version history ----
      // Search Query
      const searchQuery = { kartaId };
      if ( type == "quarter" ) {
        searchQuery["createdAt"] = { lte: moment().quarter(number).endOf('quarter') }
      } else if ( type == "month" ) {
        searchQuery["createdAt"] = { lte: moment().month(number-1).endOf('month') }
      } else if ( type == "week" ) {
        // Need more research on this
        var weekOfMonth = moment().isoWeek() - moment().subtract('days', 29 - 1).isoWeek() + 1;
        console.log(moment().isoWeek(48).startOf('week'), 'weekOfMonth');
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

              Object.keys(lastHistoryObject.old_options).forEach(key => {
                if ( newObj.hasOwnProperty(key) && newObj[key] == lastHistoryObject.old_options[key] ) {
                  flagCheck = true;
                } else {
                  flagCheck = false;
                }
              });

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
          // console.log(currentHistoryObj, 'currentHistoryObj', i);
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
          if( data.children ) {
            data.children = data.children.filter( x => x!== null );
            if ( data.children.length > 0 ) {
              for(let i = 0; i < data.children.length; i++) {
                nullRemover(data.children[i]);
              }
            }
          } else return;
        }
        nullRemover(kartaNode);

        return { message: "Karta data found..!!", date: kartaNode };
      } else {
        return { message: "Karta was not created before the requested timeframe..!!", date: null };
      }
    }
    catch(err) {
      console.log(err);
    }
  }

/* =============================REMOTE HOOKS=========================================================== */
    Karta.afterRemote('create', function(context, karta, next) {
      // Create Version
      Karta.app.models.karta_version.create({ "name" : "1", "kartaId": karta.id }, {} , (err, result) => {
        if (err) {
          console.log('> error while creating karta version', err);
          return next(err);
        } else {
          Karta.update({ "id" : karta.id }, { "versionId" : result.id, selfCopyCount: 0, sharedCopyCount: 0 }, (err, data) => {
            if (err) {
              console.log('> error while updating newly crated karta', err);
              return next(err);
            } else next();
          });
        }
      });
    });
};