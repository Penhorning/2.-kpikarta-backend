'use strict';

module.exports = function(Kartacatalog) {
    /* QUERY VARIABLES
    ----------------*/
    // Sort
    const SORT = {
        $sort: { createdAt: -1 }
    }
    // User lookup
    const USER_LOOKUP = (userId) => {
        return {
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
  // Get all catalogs
  Kartacatalog.getAll = (userId, searchQuery, type, accessType, page, limit, nodeTypes, next) => {
    page = parseInt(page, 10) || 1;
    limit = parseInt(limit, 10) || 100;

    let search_query = searchQuery ? searchQuery.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : "";

    let objectUserId = Kartacatalog.getDataSource().ObjectID(userId);

    let query = { "userId": objectUserId, "is_deleted": false };
    if (type === "shared") query = { "sharedTo.userId": userId, "is_deleted": false }
    // Fetch catalog with access type like public or private
    if (accessType) query.type = accessType;

    // Filter catalogs
    if (nodeTypes && nodeTypes.length > 0) {
        query["node_type"] = { $in: nodeTypes }
    }

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

    Kartacatalog.getDataSource().connector.connect(function (err, db) {
      const KartaCatalogCollection = db.collection('karta_catalog');
      KartaCatalogCollection.aggregate([
        {
          $match: query
        },
        SEARCH_MATCH,
        USER_LOOKUP(objectUserId),
        UNWIND_USER,
        SORT,
        {
          $project: {
            "name": 1,
            "node": 1,
            "node_type": 1,
            "type": 1,
            "user": 1
          }
        },
        FACET(page, limit)
      ]).toArray((err, result) => {
        if (result) result[0].data.length > 0 ? result[0].metadata[0].count = result[0].data.length : 0;
        next(err, result);
      });
    });
  }

  // Get all public catalogs
  Kartacatalog.getAllPublic = (searchQuery, page, limit, nodeTypes, next) => {
    page = parseInt(page, 10) || 1;
    limit = parseInt(limit, 10) || 100;

    let search_query = searchQuery ? searchQuery.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : "";

    let query = { "type": "public", "is_deleted": false }

    // Filter catalogs
    if (nodeTypes && nodeTypes.length > 0) {
        query["node_type"] = { $in: nodeTypes }
    }

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

    Kartacatalog.getDataSource().connector.connect(function (err, db) {
      const KartaCatalogCollection = db.collection('karta_catalog');
      KartaCatalogCollection.aggregate([
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

  // Share karta catalog to multiple users
  Kartacatalog.share = (catalogId, userIds, next) => {

    // Check if catalog is already shared with user or not
    Kartacatalog.findOne({ where: { "_id": catalogId } }, (err, catalog) => {
      if (err) next(err);
      else {
        let duplicateFlag = false;
        let alreadySharedList = catalog.sharedTo ? catalog.sharedTo.map(x => x.userId) : [];
        let ids = userIds.map(item => item.userId);
        let newIds = ids.filter(id => {
          if (alreadySharedList.includes(id)) {
            duplicateFlag = true;
            return null;
          } else return id;
        });

        if (newIds.length > 0) {
          Kartacatalog.update({ "_id": catalogId }, { $addToSet: { "sharedTo": { $each: userIds } } }, (err, result) => {
            next(err, "Catalog shared successfully!");
          });
        } else {
          if (duplicateFlag) {
            let error = new Error("Can't share a catalog twice to the same user!");
            error.status = 400;
            next(error);
          } else {
            let error = new Error("Please send an userId array");
            error.status = 400;
            next(error);
          }
        }
      }
    });
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
}
