'use strict';

module.exports = function(Kartahistory) {

    Kartahistory.createKartaHistory = (event, eventValue, oldValue, kartaNodeId, versionId, userId, kartaId, parentNodeId, historyType, randomKey, next) => {
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

            await Kartahistory.app.models.karta_node.updateAll( { or: [ { kartaId }, { kartaDetailId: kartaId }] }, { "is_deleted": true } );
            await Kartahistory.app.models.karta_phase.updateAll( { kartaId, "is_child": true }, { "is_deleted": true } );

            let tempHistoryData = await Kartahistory.find({ where: { versionId, kartaId, historyType: 'temp', "undoCheck" : false }}); 
            let mainHistoryData = await Kartahistory.find({ where: { versionId, kartaId, historyType: 'main', "undoCheck" : false }});
            let finalHistoryData = tempHistoryData.concat(mainHistoryData);
            let lastHistoryOfKartaVersion = "";
            
            for ( let j = 0; j < finalHistoryData.length; j++ ) {
                if(finalHistoryData[j].event == "node_created") {
                    let nodeData = JSON.parse(JSON.stringify(finalHistoryData[j].event_options.created));
                    delete nodeData.id;
                    await Kartahistory.app.models.karta_node.update( { "_id": finalHistoryData[j].kartaNodeId, "is_deleted": true }, nodeData );
                } else if (finalHistoryData[j].event == "node_updated") {
                    await Kartahistory.app.models.karta_node.update( { "_id": finalHistoryData[j].kartaNodeId, "is_deleted": false }, finalHistoryData[j].event_options.updated );
                } else if (finalHistoryData[j].event == "node_removed") {
                    await Kartahistory.app.models.karta_node.update( { "_id": finalHistoryData[j].kartaNodeId, "is_deleted": false }, { "is_deleted": true } );
                } else if (finalHistoryData[j].event == "phase_created") {
                    let phaseData = JSON.parse(JSON.stringify(finalHistoryData[j].event_options.created));
                    delete phaseData.id;
                    await Kartahistory.app.models.karta_phase.update( { "_id": finalHistoryData[j].kartaNodeId, "is_deleted": true }, {"is_deleted": false } );
                    // await Kartahistory.app.models.karta_phase.update( { "_id": finalHistoryData[j].kartaNodeId }, phaseData );
                } else if (finalHistoryData[j].event == "phase_updated") {
                    await Kartahistory.app.models.karta_phase.update( { "_id": finalHistoryData[j].kartaNodeId }, finalHistoryData[j].event_options.updated );
                } else if (finalHistoryData[j].event == "phase_removed") {
                    await Kartahistory.app.models.karta_phase.update( { "_id": finalHistoryData[j].kartaNodeId, "is_deleted": false }, { "is_deleted": true } );
                }

                if ( j == finalHistoryData.length - 1 ){
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

    Kartahistory.undoKartaToVersion = async ( versionId, kartaId ) => {
        try {
            let kartaDetails = await Kartahistory.app.models.karta.findOne({ where: { "id": kartaId }});
            if (kartaDetails.historyId == "none") {
                return { "message": "nothing", "data": null };
            } else {
                let lastHistoryData = await Kartahistory.findOne({ where: { id: kartaDetails.historyId }});
                let mainHistoryData = await Kartahistory.find({ where: { versionId, kartaId, historyType: 'main', randomKey: lastHistoryData.randomKey }});
                let finalHistoryData = mainHistoryData;
                let toSetIndex = finalHistoryData.findIndex( x => JSON.stringify(x.id) == JSON.stringify(kartaDetails.historyId) );

                if ( toSetIndex != -1 ) {
                    let wholeHistory = await Kartahistory.find({ where: { versionId, kartaId, historyType: 'main' }});
                    let lastHistoryIndex = wholeHistory.findIndex( x => JSON.stringify(x.id) == JSON.stringify(finalHistoryData[0].id) );
                    let nextHistoryIndex = lastHistoryIndex - 1;
                    if ( nextHistoryIndex >= 0 ) {
                        let lastHistory = {}; 
                        for ( let i = finalHistoryData.length - 1; i >= 0; i-- ) {
                            let currentHistory = finalHistoryData[i];
                            if (currentHistory.is_deleted) {
                                return { "message": "final", "data": null }; 
                            } else {
                                if( currentHistory.event == "node_created" ) {
                                    await Kartahistory.update({ "id": currentHistory.id }, { "undoCheck" : true });
                                    await Kartahistory.app.models.karta_node.update({ "id": currentHistory.kartaNodeId, "is_deleted": false }, { "is_deleted": true });
                                    if(i == 0) lastHistory = currentHistory;
                                } else if ( currentHistory.event == "node_updated" ) {
                                    await Kartahistory.update({ "id": currentHistory.id }, { "undoCheck" : true });
                                    await Kartahistory.app.models.karta_node.update({ "id": currentHistory.kartaNodeId }, currentHistory.old_options );
                                    if(i == 0) lastHistory = currentHistory;
                                } else if ( currentHistory.event == "node_removed" ) {
                                    await Kartahistory.update({ "id": currentHistory.id }, { "undoCheck" : true });
                                    let nodeData = JSON.parse( JSON.stringify(currentHistory.event_options.removed ));
                                    delete nodeData.id;
                                    await Kartahistory.app.models.karta_node.update({ "id": currentHistory.kartaNodeId, "is_deleted": true }, { "is_deleted": false } );
                                    if(i == 0) lastHistory = currentHistory;
                                } else if ( currentHistory.event == "phase_created" ) {
                                    await Kartahistory.update({ "id": currentHistory.id }, { "undoCheck" : true });
                                    await Kartahistory.app.models.karta_phase.update({ "id": currentHistory.kartaNodeId, "is_deleted": false }, { "is_deleted": true });
                                    if(i == 0) lastHistory = currentHistory;
                                } else if ( currentHistory.event == "phase_updated" ) {
                                    await Kartahistory.update({ "id": currentHistory.id }, { "undoCheck" : true });
                                    await Kartahistory.app.models.karta_phase.update({ "id": currentHistory.kartaNodeId }, currentHistory.old_options );
                                    if(i == 0) lastHistory = currentHistory;
                                } else if ( currentHistory.event == "phase_removed" ) {
                                    await Kartahistory.update({ "id": currentHistory.id }, { "undoCheck" : true });
                                    let phaseData = JSON.parse( JSON.stringify(currentHistory.event_options.removed ));
                                    delete phaseData.id;
                                    await Kartahistory.app.models.karta_phase.update({ "id": currentHistory.kartaNodeId, "is_deleted": true }, phaseData );
                                    if(i == 0) lastHistory = currentHistory;
                                }
                            }
                        }

                        await Kartahistory.app.models.karta.update({ "id": kartaId }, { "historyId": wholeHistory[nextHistoryIndex].id });
                        return { "message": "done", "data": lastHistory };
                    } else {
                        return { "message": "final", "data": null }; 
                    }
                } else {
                    return { "message": "nothing", "data": null };
                }
            }
        }
        catch(err) {
            console.log(err);
        }
    }

    Kartahistory.redoKartaToVersion = async ( versionId, kartaId ) => {
        try {
            const kartaDetails = await Kartahistory.app.models.karta.findOne({ where: { "id": kartaId }});
            const wholeHistory = await Kartahistory.find({ where: { versionId, kartaId, historyType: 'main' }});
            const lastHistoryIndex = wholeHistory.findIndex( x => JSON.stringify(x.id) == JSON.stringify(kartaDetails.historyId) );
            if ( lastHistoryIndex != -1 ) {
                let nextHistory = wholeHistory[lastHistoryIndex + 1];
                if (nextHistory) {
                    let mainHistoryData = await Kartahistory.find({ where: { versionId, kartaId, historyType: 'main', randomKey: nextHistory.randomKey }});
                    let finalHistoryData = mainHistoryData;
                    let lastHistory = {}; 
                    for ( let i = 0; i < finalHistoryData.length; i++ ) {
                        let currentHistory = finalHistoryData[i];
                        if (currentHistory.is_deleted) {
                            return { "message": "final", "data": null }; 
                        } else {
                            if ( currentHistory.event == "node_created" ) {
                                await Kartahistory.update({ "id": currentHistory.id }, { "undoCheck" : false });
                                // await findChildNodes(currentHistory.kartaNodeId, "remove");
                                await Kartahistory.app.models.karta_node.update({ "id": currentHistory.kartaNodeId, "is_deleted": true }, { "is_deleted": false } );
                                if(i == finalHistoryData.length - 1) lastHistory = currentHistory;
                            } else if ( currentHistory.event == "node_updated" ) {
                                await Kartahistory.update({ "id": currentHistory.id }, { "undoCheck" : false });
                                await Kartahistory.app.models.karta_node.update({ "id": currentHistory.kartaNodeId }, currentHistory.event_options.updated );
                                if(i == finalHistoryData.length - 1) lastHistory = currentHistory;
                            } else if ( currentHistory.event == "node_removed" ) {
                                await Kartahistory.update({ "id": currentHistory.id }, { "undoCheck" : false });
                                // await findChildNodes(currentHistory.kartaNodeId, "create");
                                await Kartahistory.app.models.karta_node.update({ "id": currentHistory.kartaNodeId, "is_deleted": false }, { "is_deleted": true });
                                if(i == finalHistoryData.length - 1) lastHistory = currentHistory;
                            } else if ( currentHistory.event == "phase_created" ) {
                                await Kartahistory.update({ "id": currentHistory.id }, { "undoCheck" : false });
                                // await findChildNodes(currentHistory.kartaNodeId, "create");
                                await Kartahistory.app.models.karta_phase.update({ "id": currentHistory.kartaNodeId, "is_deleted": true }, currentHistory.event_options.created );
                                if(i == finalHistoryData.length - 1) lastHistory = currentHistory;
                            } else if ( currentHistory.event == "phase_updated" ) {
                                await Kartahistory.update({ "id": currentHistory.id }, { "undoCheck" : false });
                                await Kartahistory.app.models.karta_phase.update({ "id": currentHistory.kartaNodeId }, currentHistory.event_options.updated );
                                if(i == finalHistoryData.length - 1) lastHistory = currentHistory;
                            } else if ( currentHistory.event == "phase_removed" ) {
                                await Kartahistory.update({ "id": currentHistory.id }, { "undoCheck" : false });
                                // await findChildNodes(currentHistory.kartaNodeId, "create");
                                await Kartahistory.app.models.karta_phase.update({ "id": currentHistory.kartaNodeId, "is_deleted": false }, { "is_deleted": true });
                                if(i == finalHistoryData.length - 1) lastHistory = currentHistory;
                            }
                        }
                    }

                    await Kartahistory.app.models.karta.update({ "id": kartaId }, { "historyId": lastHistory.id });
                    return { "message": "done", "data": lastHistory };
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

    // Before Kartahistory create
    Kartahistory.beforeRemote('create', (context, user, next) => {
        context.req.body.randomKey ? context.req.body.randomKey = context.req.body.randomKey.toString() : null;
        next();
    });
};
