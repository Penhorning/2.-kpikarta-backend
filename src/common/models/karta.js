'use strict';

const path = require('path');
const ejs = require('ejs');

module.exports = function(Karta) {
/* =============================CUSTOM METHODS=========================================================== */
  // Share karta to multiple users
  Karta.share = (karta, email, next) => {

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

  Karta.sharedKartas = (email, page, limit, next) => {
    page = parseInt(page, 10) || 1;
    limit = parseInt(limit, 10) || 100;

    Karta.getDataSource().connector.connect(function (err, db) {
      const KartaCollection = db.collection('karta');
      let data = KartaCollection.aggregate([
        {
          $match: { "sharedTo.email": email }
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
            as: "karta.user"
          }
        },
        {
          $unwind: "$karta.user"
        },
        {
          $facet: {
            metadata: [{ $count: "total" }, { $addFields: { 'page': page } }],
            data: [{ $skip: (limit * page) - limit }, { $limit: limit }]
          }
        }
      ]);

      data.toArray((err, result) => {
        if (result) result[0].data.length > 0 ? result[0].metadata[0].count = result[0].data.length : 0;
        next(err, result);
      });
    });
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
    Karta.observe('after delete', function(ctx, next) {
        next();
        Karta.app.models.karta_node.destroyAll({ or: [ {"kartaId": ctx.where.id}, {"kartaDetailId": ctx.where.id} ] }, (err, result) => {
            if (err) console.log('> error while deleting karta nodes', err);
        });
        // Karta.app.models.karta_sub_phase.destroyAll({ "kartaId": ctx.where.id }, (err, result) => {
        //     if (err) console.log('> error while deleting karta sub phases', err);
        // });
    });
};