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