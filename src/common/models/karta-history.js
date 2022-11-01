'use strict';

module.exports = function(Kartahistory) {
    Kartahistory.createKartaHistory = (event, eventValue, kartaNodeId, versionId, userId, next) => {
        Object.keys(eventValue).map(value => {
            let history_data = {
              event,
              event_key: value,
              event_value: eventValue[value],
              kartaNodeId,
              versionId,
              userId
            };
            Kartahistory.create( history_data, {}, (err, response) => {
                if (err) {
                    console.log('> error while creating karta history', err);
                    return next(err);
                }
            });
        });

        return next(null, "Karta History added successfully..!!");
    }
};
