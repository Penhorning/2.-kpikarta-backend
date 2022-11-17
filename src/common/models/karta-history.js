'use strict';

module.exports = function(Kartahistory) {
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
            await Kartahistory.app.models.karta_node.remove({ or: [{ kartaId }, { kartaDetailId: kartaId }] });

            let tempHistoryData = await Kartahistory.find({ where: { versionId, kartaId, historyType: 'temp', "undoCheck" : false }}); 
            let mainHistoryData = await Kartahistory.find({ where: { versionId, kartaId, historyType: 'main', "undoCheck" : false }});
            let finalHistoryData = tempHistoryData.concat(mainHistoryData);
            let lastHistoryOfKartaVersion = "";
            
            for( let j = 0; j < finalHistoryData.length; j++ ) {
                if( finalHistoryData[j].event == "node_created" ) {
                    if( finalHistoryData[j].parentNodeId ) {
                        let newObj = {
                            ...finalHistoryData[j].event_options.created,
                            parentId: finalHistoryData[j].parentNodeId
                        }
                        let newKartaNodeChild = await Kartahistory.app.models.karta_node.create( newObj );
                        await Kartahistory.app.models.karta_history.update({ "parentNodeId": finalHistoryData[j].kartaNodeId, kartaId, versionId }, { "parentNodeId": newKartaNodeChild.id });
                        await Kartahistory.app.models.karta_history.update({ "kartaNodeId": finalHistoryData[j].kartaNodeId, kartaId, versionId }, { "kartaNodeId": newKartaNodeChild.id });
                        await Kartahistory.app.models.karta_history.update({ "id": finalHistoryData[j].id, kartaId, versionId }, { event_options: { "created": newObj, "updated": null, "removed": null } });
                        let tempHistoryData = await Kartahistory.find({ where: { versionId, kartaId, historyType: 'temp', "undoCheck" : false }}); 
                        let mainHistoryData = await Kartahistory.find({ where: { versionId, kartaId, historyType: 'main', "undoCheck" : false }});
                        finalHistoryData = tempHistoryData.concat(mainHistoryData);
                    }
                    else {
                        let newKartaNode = await Kartahistory.app.models.karta_node.create( finalHistoryData[j].event_options.created );
                        await Kartahistory.app.models.karta_history.update({ "parentNodeId": finalHistoryData[j].kartaNodeId, kartaId, versionId }, { parentNodeId: newKartaNode.id });
                        await Kartahistory.app.models.karta_history.update({ "kartaNodeId": finalHistoryData[j].kartaNodeId, kartaId, versionId }, { kartaNodeId: newKartaNode.id });
                        let tempHistoryData = await Kartahistory.find({ where: { versionId, kartaId, historyType: 'temp', "undoCheck" : false }}); 
                        let mainHistoryData = await Kartahistory.find({ where: { versionId, kartaId, historyType: 'main', "undoCheck" : false }});
                        finalHistoryData = tempHistoryData.concat(mainHistoryData);
                    }
                }
                else if ( finalHistoryData[j].event == "node_updated" ) {
                    if(finalHistoryData[j].event_options.updated.parentId){
                        let newObj = {
                            ...finalHistoryData[j].event_options.updated,
                            parentId: finalHistoryData[j].parentNodeId,
                        };
                        await Kartahistory.app.models.karta_history.update( { "id": finalHistoryData[j].id }, { event_options: { "created": null, "updated": newObj, "removed": null } } );
                        let tempHistoryData = await Kartahistory.find({ where: { versionId, kartaId, historyType: 'temp', "undoCheck" : false }}); 
                        let mainHistoryData = await Kartahistory.find({ where: { versionId, kartaId, historyType: 'main', "undoCheck" : false }});
                        finalHistoryData = tempHistoryData.concat(mainHistoryData);
                        await Kartahistory.app.models.karta_node.update( { "id": finalHistoryData[j].kartaNodeId }, finalHistoryData[j].event_options.updated );
                    } else {
                        await Kartahistory.app.models.karta_node.update( { "id": finalHistoryData[j].kartaNodeId }, finalHistoryData[j].event_options.updated );
                    }
                } else if ( finalHistoryData[j].event == "node_removed" ) {
                    await Kartahistory.app.models.karta_node.remove( { "id": finalHistoryData[j].kartaNodeId } );
                }
                // else if ( finalHistoryData[j].event == "node_update_key_remove" ) {
                // }

                if( j == finalHistoryData.length - 1 ){
                    lastHistoryOfKartaVersion = finalHistoryData[j].id;
                }
            }

            await Kartahistory.app.models.karta.update( { "id": kartaId }, { versionId, historyId: lastHistoryOfKartaVersion } );

            return "Version updated successfully..!!";
        }
        catch(err){
            console.log(err);
        }
    }

    Kartahistory.undoFunctionality = async ( versionId, kartaId ) => {
        try {
            let kartaDetails = await Kartahistory.app.models.karta.findOne({ where: { "id": kartaId }});
            let mainHistoryData = await Kartahistory.find({ where: { versionId, kartaId, historyType: 'main' }});
            let finalHistoryData = mainHistoryData;
            let toSetIndex = finalHistoryData.findIndex( x => JSON.stringify(x.id) == JSON.stringify(kartaDetails.historyId) );

            if ( toSetIndex != -1 ) {
                if( finalHistoryData[toSetIndex].event == "node_created" ){
                    if ( toSetIndex > 0 ) {
                        await Kartahistory.update({ "id": finalHistoryData[toSetIndex].id }, { "undoCheck" : true });
                        await Kartahistory.app.models.karta_node.remove({ "id": finalHistoryData[toSetIndex].kartaNodeId });
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

    Kartahistory.redoFunctionality = async ( versionId, kartaId ) => {
        try {
            let kartaDetails = await Kartahistory.app.models.karta.findOne({ where: { "id": kartaId }});
            let mainHistoryData = await Kartahistory.find({ where: { versionId, kartaId, historyType: 'main' }});
            let finalHistoryData = mainHistoryData;
            let toSetIndex = finalHistoryData.findIndex( x => JSON.stringify(x.id) == JSON.stringify(kartaDetails.historyId) );

            if ( toSetIndex != -1 ) {
                if ( toSetIndex+1 < finalHistoryData.length ) {
                    await Kartahistory.update({ "id": finalHistoryData[toSetIndex+1].id }, { "undoCheck" : false });
                    await Kartahistory.app.models.karta.update({ "id": kartaId }, { "historyId": finalHistoryData[toSetIndex+1].id });
                    return { "message": "done", "data": finalHistoryData[toSetIndex+1] };
                }
                else if (toSetIndex+1 == finalHistoryData.length){
                    return { "message": "final", "data": null };
                } else {
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
