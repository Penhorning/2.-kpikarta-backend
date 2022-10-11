'use strict';

module.exports = function(Notification) {
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
};
