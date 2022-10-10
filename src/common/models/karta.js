'use strict';

const path = require('path');
const ejs = require('ejs');

module.exports = function(Karta) {
/* =============================CUSTOM METHODS=========================================================== */
  // Share karta to multiple users
  Karta.share = (karta, emails, next) => {

    if (emails.length > 0) {
      // Remove duplicate emails
      emails = [...new Set(emails)];
      // Prepare data for updating in the sharedTo field
      let data = [];
      for (let i = 0; i < emails.length; i++) {
        data.push({ email: emails[i] });
      }

      Karta.update({ "_id": karta.id }, { $addToSet: { "sharedTo": { $each: data } } }, (err) => {
        if (err) console.log('> error while updating the karta sharedTo property ', err);
        else {
          next(null, "Karta shared successfully!");
          // Find existing users in the system
          Karta.app.models.user.find({ where: { "email": { inq: emails } } }, (err, users) => {
            if (err) console.log('> error while finding users with emails', err);
            else {
              // Prepare notification collection data
              let notificationData = [];
              users.forEach(item => {
                notificationData.push({
                  title: `${Karta.app.currentUser.fullName} shared the ${karta.name}`,
                  type: "karta_shared",
                  contentId: karta.id,
                  userId: item.id
                });
              });
              // Insert data in notification collection
              Karta.app.models.notification.create(notificationData, (err, result) => {
                if (err) console.log('> error while inserting data in notification collection', err);
              });
              // Separate emails that are not existing in the system
              emails = emails.filter(email => !(users.some(item => item.email === email)));
              let kartaLink = `${process.env.WEB_URL}//karta/edit-karta/${karta.id}`;
              // Send email to users
              emails.forEach(email => {
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
      let error = new Error("Please send an email array");
      error.status = 400;
      next(error);
    }
  }

  // Get all kartas
  Karta.getKartas = (userId, page, limit, next) => {
    page = parseInt(page, 10) || 1;
    limit = parseInt(limit, 10) || 100;

    userId = Karta.getDataSource().ObjectID(userId);

    Karta.getDataSource().connector.connect(function (err, db) {
      const KartaCollection = db.collection('karta');
      KartaCollection.aggregate([
        {
          $match: { "userId": userId, "is_deleted": false }
        },
        {
          $sort: { "createdAt" : -1 }
        },
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
  Karta.sharedKartas = (email, page, limit, next) => {
    page = parseInt(page, 10) || 1;
    limit = parseInt(limit, 10) || 100;

    Karta.getDataSource().connector.connect(function (err, db) {
      const KartaCollection = db.collection('karta');
      KartaCollection.aggregate([
        {
          $match: { "sharedTo.email": email, $or: [ { "is_deleted": false }, { "is_deleted": { "$exists": false} } ] }
        },
        {
          $sort: { "createdAt" : -1 }
        },
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

  Karta.kartaCopy = async (kartaId, next) => {
    try {
      // Finding Karta details which will be copied
      let kartaData = await Karta.findOne({ where: {_id: kartaId } });

      if(kartaData){
        // Creating new Karta with old details
        let newObj = {
          name: kartaData.name ? kartaData.name : null,
          userId: kartaData.userId ? kartaData.userId : null,
          sharedTo: kartaData.sharedTo ? kartaData.sharedTo : null,
          status: kartaData.status ? kartaData.status : null,
          type: kartaData.type ? kartaData.type : null,
        }

        // New Carta details accessed in newKarta variable
        let newKarta = await Karta.create(newObj);

        // Initializing values Ids
        let oldKartaId = kartaData.id;
        let newKartaId = newKarta.id;
        let oldNodeId = null;
        let newNodeId = null;

        // Finding parent node with kartaId
        let NodeData = await Karta.app.models.karta_node.findOne({ where: {'kartaId': oldKartaId } });
        oldNodeId = NodeData.id;

        // Creating new Parent Node with old data
        let newNodeObj = {
          name: NodeData.name,
          font_style: NodeData.font_style,
          alignment: NodeData.alignment,
          text_color: NodeData.text_color,
          weightage: NodeData.weightage,
          kartaId: newKartaId,
          phaseId: NodeData.phaseId,
        };

        let newParentNode = await Karta.app.models.karta_node.create(newNodeObj);
        newNodeId = newParentNode.id;

        // Recursion function created below to create child nodes of the parent node
        async function createChildNodes(NodeIdOld, NodeIdNew){
          try{
            let ChildNodeData = await Karta.app.models.karta_node.find({ where: {'kartaDetailId': oldKartaId, 'parentId': NodeIdOld } });
            if(ChildNodeData.length > 0){
              for(let i = 0; i < ChildNodeData.length; i++){
                let newChildObj = {
                  name: ChildNodeData[i].name,
                  font_style: ChildNodeData[i].font_style,
                  alignment: ChildNodeData[i].alignment,
                  text_color: ChildNodeData[i].text_color,
                  weightage: ChildNodeData[i].weightage,
                  kartaDetailId: newKartaId,
                  phaseId: ChildNodeData[i].phaseId,
                  parentId: NodeIdNew
                }
  
                let newChildNode = await Karta.app.models.karta_node.create(newChildObj);
                if(newChildNode){
                  createChildNodes(ChildNodeData[i].id, newChildNode.id);
                }
              }
            }
            else {
              return;
            }
          }
          catch(er){
            console.log(er);
            return next(er);
          }
        }

        // Calling the above recursion function with ParentNode Id for new and old
        createChildNodes(oldNodeId, newNodeId);

        // Returning the response below
        return next(null, "A Copy of Karta has been created..");
      }
    }
    catch(err){
      console.log(err);
      return next(err);
    }
  }

/* =============================REMOTE HOOKS=========================================================== */
    // Karta.afterRemote('create', function(context, karta,  next) {
    //     // Find role
    //     Karta.app.models.karta_phase.findOne({ where:{ "name": "Goal" } }, (err, phase) => {
    //         if (err) {
    //             console.log('> error while finding karta phase', err);
    //             return next(err);
    //         } else {
    //             // Add default root node
    //             Karta.app.models.karta_node.create({ "name": karta.name, "kartaId": karta.id, "phaseId": phase.id }, {}, err => {
    //                 if (err) {
    //                     console.log('> error while creating karta node', err);
    //                     return next(err);
    //                 } else next();
    //             });
    //         }
    //     });
    // });
};