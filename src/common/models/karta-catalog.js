'use strict';

module.exports = function(Kartacatalog) {
  // Get all catalogs
  Kartacatalog.getAll = (userId, searchQuery, page, limit, nodeTypes, next) => {
    page = parseInt(page, 10) || 1;
    limit = parseInt(limit, 10) || 100;

    let search_query = searchQuery ? searchQuery.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : "";

    userId = Kartacatalog.getDataSource().ObjectID(userId);

    let query = { "userId": userId, "is_deleted": false };

    // Filter catalogs
    if (nodeTypes && nodeTypes.length > 0) {
        query["node_type"] = { $in: nodeTypes }
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

    Kartacatalog.getDataSource().connector.connect(function (err, db) {
      const KartaCatalogCollection = db.collection('karta_catalog');
      KartaCatalogCollection.aggregate([
        {
          $match: query
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

  // Get shared catalogs
  Kartacatalog.sharedAll = (email, searchQuery, page, limit, next) => {
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

    Kartacatalog.getDataSource().connector.connect(function (err, db) {
      const KartaCatalogCollection = db.collection('karta_catalog');
      KartaCatalogCollection.aggregate([
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

  // Share catalog to multiple users
  Kartacatalog.share = (catalog, emails, next) => {

    let catalogId = "";
    if (catalog.hasOwnProperty("id")) catalogId = karta.id;
    else catalogId = catalog._id ;

    // Check if any email has already been shared to the catalog or not
    let duplicateFlag = false;
    let alreadySharedList = catalog.sharedTo ? catalog.sharedTo.map(x => x.email) : [];
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

      Kartacatalog.update({ "_id": catalogId }, { $addToSet: { "sharedTo": { $each: data } } }, (err) => {
        if (err) console.log('> error while updating the catalog sharedTo property ', err);
        else {
          next(null, "Catalog shared successfully!");
          // Find existing users in the system
          Kartacatalog.app.models.user.find({ where: { "email": { inq: newEmails } } }, (err, users) => {
            if (err) console.log('> error while finding users with emails', err);
            else {
              // Prepare notification collection data
              let notificationData = [];
              users.forEach(item => {
                notificationData.push({
                  title: `${Kartacatalog.app.currentUser.fullName} shared the ${catalog.name}`,
                  type: "catalog_shared",
                  contentId: catalog._id,
                  userId: item.id
                });
              });
              // Insert data in notification collection
              Kartacatalog.app.models.notification.create(notificationData, (err, result) => {
                if (err) console.log('> error while inserting data in notification collection', err);
              });
            }
          });
        }
      });
    } else {
      if (duplicateFlag) {
        let error = new Error("Can't share a catalog twice to the same user!");
        error.status = 400;
        next(error);
      } else {
        let error = new Error("Please send an email array");
        error.status = 400;
        next(error);
      }
    }
  }

  // Delete
  Kartacatalog.delete = (catalogId, next) => {
    Kartacatalog.update( { "_id": catalogId } , { $set: { "is_deleted": true } }, (err) => {
      if (err) {
        console.log('error while soft deleting catalog', err);
        return next(err);
      }
      return next(null, "Catalog deleted successfully!");
    })
  }
};
