'use strict';

module.exports = function(Notification) {
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
    // Get all notifications
    Notification.getNotifications = (userId, page, limit, next) => {
        page = parseInt(page, 10) || 1;
        limit = parseInt(limit, 10) || 100;

        userId = Notification.getDataSource().ObjectID(userId);

        Notification.getDataSource().connector.connect(function (err, db) {
            const NotificationCollection = db.collection('notification');
            NotificationCollection.aggregate([
                {
                    $match: { "userId": userId }
                },
                USER_LOOKUP(userId),
                UNWIND_USER,
                SORT,
                FACET(page, limit)
            ]).toArray((err, result) => {
                if (result) result[0].data.length > 0 ? result[0].metadata[0].count = result[0].data.length : 0;
                next(err, result);
            });
        });
    }

    Notification.updateNotificationStatus = (userId, next) => {
        Notification.updateAll( { userId }, {is_read: true}, (err, response) => {
            if(err) next(err);
            else next(null, "All notifications are read..!!");
        });
    }
};
