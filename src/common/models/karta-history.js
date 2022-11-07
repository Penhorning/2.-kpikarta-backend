'use strict';

module.exports = function(Kartahistory) {
    Kartahistory.createKartaHistory = (event, eventValue, kartaNodeId, versionId, userId, kartaId, parentNodeId, next) => {
        const event_object = {
            "node_created": "created",
            "node_updated": "updated",
            "node_removed": "removed",
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
            parentNodeId
        };

        event_options_obj[event_object[event]] = eventValue;
        history_data["event_options"] = event_options_obj;

        Kartahistory.create( history_data, {}, (err, response) => {
            if (err) {
                console.log('> error while creating karta history', err);
                return next(err);
            }
            return next(null, "Karta History added successfully..!!");
        });

    }

    Kartahistory.versionControlChange = async (versionId, kartaId) => {
        try {
            await Kartahistory.app.models.karta_node.remove({ kartaId })
            const kartaVersionDetails = await Kartahistory.app.models.karta_version.findOne({ where: { "id": versionId }});
            let versionNumber = kartaVersionDetails.name.split(".")[0];
            versionNumber = Number(versionNumber);

            for ( let i = 1; i <= versionNumber; i++ ) {
                let versionName = i+".0.0";
                const currentVersionDetails = await Kartahistory.app.models.karta_version.findOne({ where: { "name": versionName }});
                const kartaHitoryDetails = await Kartahistory.find({ where: { versionId: currentVersionDetails.id, kartaId } });

                for( let j = 0; j < kartaHitoryDetails.length; j++ ) {
                    if( kartaHitoryDetails[j].event == "node_created" ) {
                        // Needs rechecking
                        if( kartaHitoryDetails[j].parentNodeId ) {
                            let newObj = {
                                ...kartaHitoryDetails[j].event_options.created,
                                parentId: kartaHitoryDetails[j].parentNodeId
                            };
                            let newKartaNode = await Kartahistory.app.models.karta_node.create( newObj );
                            await Kartahistory.app.models.karta_history.update({ parentNodeId: kartaHitoryDetails[j].kartaNodeId }, { parentNodeId: newKartaNode.id });
                            await Kartahistory.app.models.karta_history.update({ kartaNodeId: kartaHitoryDetails[j].kartaNodeId }, { kartaNodeId: newKartaNode.id });
                        }
                        else {
                            let newKartaNode = await Kartahistory.app.models.karta_node.create( kartaHitoryDetails[j].event_options.created );
                            await Kartahistory.app.models.karta_history.update({ parentNodeId: kartaHitoryDetails[j].kartaNodeId }, { parentNodeId: newKartaNode.id });
                            await Kartahistory.app.models.karta_history.update({ kartaNodeId: kartaHitoryDetails[j].kartaNodeId }, { kartaNodeId: newKartaNode.id });
                        }
                    }
                    else if ( kartaHitoryDetails[j].event == "node_updated" ) {
                        await Kartahistory.app.models.karta_node.update( { "id": kartaHitoryDetails[j].kartaNodeId }, kartaHitoryDetails[j].event_options.updated );
                    }
                    else if ( kartaHitoryDetails[j].event == "node_removed" ) {
                        await Kartahistory.app.models.karta_node.remove( { "id": kartaHitoryDetails[j].kartaNodeId } );
                    }
                    // else if ( kartaHitoryDetails[j].event == "node_update_key_remove" ) {
                    // }
                }
            }

            return {"data": "Adding and Removing Done"};
        }
        catch(err){
            console.log(err);
        }
    }
};
