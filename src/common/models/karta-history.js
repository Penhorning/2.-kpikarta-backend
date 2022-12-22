'use strict';

module.exports = function(Kartahistory) {
    // Generic functions 
    async function findChildNodes(nodeId, type) {
        let boolValue = type == "remove" ? true : false;
        await Kartahistory.app.models.karta_node.update({ "id": nodeId, "is_deleted": boolValue }, { "is_deleted": !boolValue });
        const children = await Kartahistory.app.models.karta_node.find({ where: { "parentId": nodeId, "is_deleted": boolValue }});
        if (children && children.length > 0) {
            for ( let i = 0; i < children.length; i++ ) {
                await findChildNodes(children[i].id, type);
            }
        }
    }

    Kartahistory.createKartaHistory = (event, eventValue, oldValue, kartaNodeId, versionId, userId, kartaId, parentNodeId, historyType, next) => {
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
            parentNodeId,
            historyType
        };

        event_options_obj[event_object[event]] = eventValue;
        history_data["event_options"] = event_options_obj;
        oldValue ? history_data["old_options"] = oldValue : null;

        Kartahistory.create( history_data, {}, (err, response) => {
            if (err) {
                console.log('> error while creating karta history', err);
                return next(err);
            }
            Kartahistory.app.models.karta.update({ "id": kartaId }, { "historyId": response.id }, (err, result) => {
                if (err) {
                    console.log('> error while updating karta', err);
                    return next(err);
                }   
                return next(null, "Karta History added successfully..!!");
            });
        });

    }

    Kartahistory.versionControlChange = async (versionId, kartaId) => {
        try {
            await Kartahistory.app.models.karta_node.updateAll( { }, { "is_deleted": true } );

            let tempHistoryData = await Kartahistory.find({ where: { versionId, kartaId, historyType: 'temp', "undoCheck" : false }}); 
            let mainHistoryData = await Kartahistory.find({ where: { versionId, kartaId, historyType: 'main', "undoCheck" : false }});
            let finalHistoryData = tempHistoryData.concat(mainHistoryData);
            let lastHistoryOfKartaVersion = "";
            let nodeIds = {};
            
            for ( let j = 0; j < finalHistoryData.length; j++ ) {
                nodeIds[finalHistoryData[j].kartaNodeId] = finalHistoryData[j].kartaNodeId;
                if( j == finalHistoryData.length - 1 ){
                    lastHistoryOfKartaVersion = finalHistoryData[j].id;
                }
            }

            Object.keys(nodeIds).forEach(async node => {
                await Kartahistory.app.models.karta_node.update( { "id": nodeIds[node], "is_deleted": true }, { "is_deleted": false } );
            });

            await Kartahistory.app.models.karta.update( { "id": kartaId }, { versionId, historyId: lastHistoryOfKartaVersion } );
            return "Version updated successfully..!!";
        }
        catch(err){
            console.log(err);
        }
    }

    Kartahistory.undoKartaToVersion = async ( versionId, kartaId ) => {
        try {
            let kartaDetails = await Kartahistory.app.models.karta.findOne({ where: { "id": kartaId }});
            let mainHistoryData = await Kartahistory.find({ where: { versionId, kartaId, historyType: 'main' }});
            let finalHistoryData = mainHistoryData;
            let toSetIndex = finalHistoryData.findIndex( x => JSON.stringify(x.id) == JSON.stringify(kartaDetails.historyId) );

            if ( toSetIndex != -1 ) {
                if( finalHistoryData[toSetIndex].event == "node_created" ) {
                    if ( toSetIndex > 0 ) {
                        await Kartahistory.update({ "id": finalHistoryData[toSetIndex].id }, { "undoCheck" : true });
                        // await Kartahistory.app.models.karta_node.update({ "id": finalHistoryData[toSetIndex].kartaNodeId }, { "is_deleted": true });
                        await findChildNodes(finalHistoryData[toSetIndex].kartaNodeId, "create");
                    }
                    let nextHistoryIndex = toSetIndex - 1;
                    if ( nextHistoryIndex >= 0 ) {
                        await Kartahistory.app.models.karta.update({ "id": kartaId }, { "historyId": finalHistoryData[nextHistoryIndex].id });
                        return { "message": "done", "data": finalHistoryData[toSetIndex] };
                    }
                    else {
                        return { "message": "final", "data": null };
                    }
                }
                else if ( finalHistoryData[toSetIndex].event == "node_updated" ) {
                    await Kartahistory.update({ "id": finalHistoryData[toSetIndex].id }, { "undoCheck" : true });
                    let nextHistoryIndex = toSetIndex - 1;
                    if ( nextHistoryIndex >= 0 ) {
                        await Kartahistory.app.models.karta.update({ "id": kartaId }, { "historyId": finalHistoryData[nextHistoryIndex].id });
                        await Kartahistory.app.models.karta_node.update({ "id": finalHistoryData[toSetIndex].kartaNodeId }, finalHistoryData[toSetIndex].old_options );
                        return { "message": "done", "data": finalHistoryData[toSetIndex] };
                    }
                    else {
                        return { "message": "final", "data": null };
                    }
                }
                else if ( finalHistoryData[toSetIndex].event == "node_removed" ) {
                    let nextHistoryIndex = toSetIndex - 1;
                    if ( nextHistoryIndex >= 0 ) {
                        await Kartahistory.update({ "id": finalHistoryData[toSetIndex].id }, { "undoCheck" : true });
                        await Kartahistory.app.models.karta.update({ "id": kartaId }, { "historyId": finalHistoryData[nextHistoryIndex].id });
                        // await Kartahistory.app.models.karta_node.update({ "id": finalHistoryData[toSetIndex].kartaNodeId, "is_deleted": true }, { "is_deleted": false });
                        await findChildNodes(finalHistoryData[toSetIndex].kartaNodeId, "remove");
                        finalHistoryData = await Kartahistory.find({ where: { versionId, kartaId, historyType: 'main' }});
                        return { "message": "done", "data": finalHistoryData[toSetIndex] };
                    }
                    else {
                        return { "message": "final", "data": null };
                    }
                }
            } else {
                return { "message": "nothing", "data": null };
            }
        }
        catch(err) {
            console.log(err);
        }
    }

    Kartahistory.redoKartaToVersion = async ( versionId, kartaId ) => {
        try {
            let kartaDetails = await Kartahistory.app.models.karta.findOne({ where: { "id": kartaId }});
            let historyData = await Kartahistory.find({ where: { versionId, kartaId, historyType: 'main' }});
            let toSetIndex = historyData.findIndex( x => JSON.stringify(x.id) == JSON.stringify(kartaDetails.historyId) );

            if ( toSetIndex != -1 ) {
                let nextIndex = toSetIndex + 1;
                if ( nextIndex < historyData.length ) {
                    if ( historyData[nextIndex].event == "node_created" ) {
                        await Kartahistory.update({ "id": historyData[nextIndex].id }, { "undoCheck" : false });
                        await Kartahistory.app.models.karta.update({ "id": kartaId }, { "historyId": historyData[nextIndex].id });
                        // await Kartahistory.app.models.karta_node.update({ "id": historyData[toSetIndex].kartaNodeId }, { "is_deleted": false });
                        await findChildNodes(historyData[nextIndex].kartaNodeId, "remove");
                        historyData = await Kartahistory.find({ where: { versionId, kartaId, historyType: 'main' }});
                        return { "message": "done", "data": historyData[nextIndex] };
                    } 
                    else if ( historyData[nextIndex].event == "node_updated" ) {
                        await Kartahistory.update({ "id": historyData[nextIndex].id }, { "undoCheck" : false });
                        await Kartahistory.app.models.karta.update({ "id": kartaId }, { "historyId": historyData[nextIndex].id });
                        await Kartahistory.app.models.karta_node.update({ "id": historyData[nextIndex].kartaNodeId }, historyData[nextIndex].event_options.updated );
                        return { "message": "done", "data": historyData[nextIndex] };
                    }
                    else if ( historyData[nextIndex].event == "node_removed" ) {
                        await Kartahistory.update({ "id": historyData[nextIndex].id }, { "undoCheck" : false });
                        // await Kartahistory.app.models.karta_node.update({ "id": historyData[nextIndex].kartaNodeId }, { "is_deleted": true });
                        await findChildNodes(historyData[nextIndex].kartaNodeId, "create");
                        await Kartahistory.app.models.karta.update({ "id": kartaId }, { "historyId": historyData[nextIndex].id });
                        return { "message": "done", "data": historyData[nextIndex] };
                    }
                }
                else if (nextIndex >= historyData.length){
                    return { "message": "final", "data": null };
                }
            } else {
                return { "message": "nothing", "data": null };
            }
        }
        catch(err) {
            console.log(err);
        }
    }

    Kartahistory.syncKartaHistory = async (versionId, kartaId) => {
        try {
            await Kartahistory.remove({ kartaId, versionId, undoCheck: true });
            return "Karta history is in sync..!!"
        }
        catch(err) {
            console.log(err);
        }
    }
};
