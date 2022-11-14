'use strict';

const path = require('path');
const ejs = require('ejs');

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
              let kartaLink = `${process.env.WEB_URL}//karta/edit-karta/${karta._id}`;
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
                await Karta.app.models.karta_node.update( { "id": finalHistoryData[j].kartaNodeId }, finalHistoryData[j].event_options.updated );
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

      return "Karta copy created successfully..!!";
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