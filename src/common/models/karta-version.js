'use strict';

module.exports = function(Kartaversion) {

    // Create new version
    Kartaversion.createVersion = async (name, kartaId, versionId) => {
        try {
            const newVersion = await Kartaversion.create({ name, kartaId });
            let findHistoryTemp = await Kartaversion.app.models.karta_history.find({ where: { kartaId, versionId, historyType: "temp" }});
            let findHistoryMain = await Kartaversion.app.models.karta_history.find({ where: { kartaId, versionId, historyType: "main" }});

            if (findHistoryTemp.length > 0 ){
                for (let i = 0; i < findHistoryTemp.length; i++ ) {
                    let tempObj = JSON.parse(JSON.stringify(findHistoryTemp[i]));
                    let newObj = {
                        ...tempObj,
                        event: tempObj.event,
                        event_options: tempObj.event_options,
                        kartaNodeId: tempObj.kartaNodeId,
                        userId: tempObj.userId,
                        versionId: newVersion.id,
                        kartaId: tempObj.kartaId,
                        historyType: 'temp'
                    };
                    delete newObj["id"];
                    if(tempObj.event == "node_updated" || tempObj.event == "phase_updated") newObj["old_options"] = tempObj.old_options;
                    tempObj.parentNodeId ? newObj['parentNodeId'] = tempObj.parentNodeId : null;
                    await Kartaversion.app.models.karta_history.create(newObj);
                }
            }

            if( findHistoryMain.length > 0 ) {
                for( let i = 0; i < findHistoryMain.length; i++ ) {
                    let mainObj = JSON.parse(JSON.stringify(findHistoryMain[i]));
                    let newObj = {
                        ...mainObj,
                        event: mainObj.event,
                        event_options: mainObj.event_options,
                        kartaNodeId: mainObj.kartaNodeId,
                        userId: mainObj.userId,
                        versionId: newVersion.id,
                        kartaId: mainObj.kartaId,
                        historyType: 'temp'
                    };
                    delete newObj["id"];
                    if(mainObj.event == "node_updated" || mainObj.event == "phase_updated") newObj["old_options"] = mainObj.old_options;
                    mainObj.parentNodeId ? newObj['parentNodeId'] = mainObj.parentNodeId : null;
                    await Kartaversion.app.models.karta_history.create(newObj);
                }
            }

            await Kartaversion.app.models.karta.update({ id: kartaId }, { historyId: "none" });
            return newVersion;
        }
        catch(err){
            console.log(err);
        }
    }
    
};
