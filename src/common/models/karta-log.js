'use strict';

const moment = require('moment-timezone');

module.exports = function(Kartalog) {
    /* QUERY VARIABLES
    ----------------*/
    // Karta lookup
    const KARTA_LOOKUP = {
        $lookup: {
            from: 'karta',
            let: { karta_id: "$kartaId" },
            pipeline: [
                { 
                    $match: {
                        $expr: {
                            $and: [
                                { $eq: ["$_id", "$$karta_id"] },
                                { $eq: ["$is_deleted", false] }
                            ]
                        }
                    }
                },
                {
                    $project: {
                        "name": 1,
                        "userId": 1,
                        "versionId": 1
                    }
                }
            ],
            as: 'karta'
        }
    }
    const UNWIND_KARTA = {
        $unwind: {
            path: "$karta"
        }
    }
    // User lookup
    const USER_LOOKUP = {
        $lookup: {
            from: "user",
            let: { user_id: "$userId" },
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
    const UNWIND_USER = {
        $unwind: {
            path: "$user",
            preserveNullAndEmptyArrays: true
        }
    }
    // Facet
    const FACET = (page, limit) => {
        return {
            $facet: {
                metadata: [{ $count: "total" }, { $addFields: { "page": page } }],
                data: [{ $skip: (limit * page) - limit }, { $limit: limit }]
            }
        }
    }

    // Convert string id to bson
    const convertIdToBSON = (id) => {
        return Kartalog.getDataSource().ObjectID(id);
    }



/* =============================CUSTOM METHODS=========================================================== */

    // Create karta history
    Kartalog.createKartalog = (event, eventValue, oldValue, kartaNodeId, versionId, userId, kartaId, parentNodeId, historyType, randomKey, next) => {
        const event_object = {
            "node_created": "created",
            "phase_created": "created",
            "node_updated": "updated",
            "phase_updated": "updated",
            "node_removed": "removed",
            "phase_removed": "removed",
            "node_update_key_remove": "updated",
        }

        const event_options_obj = {
            created: null,
            updated: null,
            removed: null,
        }

        let history_data = {
            event,
            kartaNodeId,
            versionId,
            userId,
            kartaId,
            parentNodeId,
            historyType,
            randomKey: randomKey ? randomKey.toString() : new Date().getTime().toString()
        };

        event_options_obj[event_object[event]] = eventValue;
        history_data["event_options"] = event_options_obj;
        oldValue ? history_data["old_options"] = oldValue : null;

        Kartalog.create( history_data, {}, (err, response) => {
            if (err) {
                console.log('> error while creating karta history', err);
                return next(err);
            }
            Kartalog.app.models.karta.update({ "id": kartaId }, { "historyId": response.id }, (err, result) => {
                if (err) {
                    console.log('> error while updating karta', err);
                    return next(err);
                }   
                return next(null, "Karta History added successfully..!!");
            });
        });

    }

    // Get logs by nodeId for audit trail
    Kartalog.getByNodeId = (page, limit, nodeId, next) => {
        page = parseInt(page, 10) || 1;
        limit = parseInt(limit, 10) || 100;

        // Fetching KartaNode Details
        Kartalog.app.models.karta_node.findOne({ where: { "id": nodeId }}, (err, data) => {
            let kartaNodeDetails = JSON.parse(JSON.stringify(data));

            let query = {
                "kartaNodeId": convertIdToBSON(nodeId),
                "event": "node_updated",
                "event_options.achieved_value": { $exists: true },
                "createdAt": {
                    $gte: moment().set('month', moment(kartaNodeDetails.createdAt).month()).startOf('month').toDate(),
                    $lte: moment().endOf('month').toDate()
                }
            };
            
            Kartalog.getDataSource().connector.connect((err, db) => {
                const KartalogCollection = db.collection('karta_log');
                KartalogCollection.aggregate([
                    {
                        $match: query
                    },
                    KARTA_LOOKUP,
                    UNWIND_KARTA,
                    USER_LOOKUP,
                    UNWIND_USER,
                    {
                        $sort: { "createdAt": -1 }
                    },
                    FACET(page, limit)
                ]).toArray((err, result) => {
                    if (result && result[0].data.length > 0) result[0].metadata[0].count = result[0].data.length;
                    next(err, result);
                });
            });
        });
    }

};
