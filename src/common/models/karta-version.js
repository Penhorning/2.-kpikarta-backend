'use strict';

module.exports = function(Kartaversion) {
    Kartaversion.createVersion = async (name, kartaId, versionId) => {
        try {
            const newVersion = await Kartaversion.create({ name, kartaId });
            const findHistoryTemp = await Kartaversion.app.models.karta_history.find({ where: { kartaId, versionId, historyType: "temp" }});
            const findHistoryMain = await Kartaversion.app.models.karta_history.find({ where: { kartaId, versionId, historyType: "main" }});

            if( findHistoryTemp.length > 0 ){
                for( let i = 0; i < findHistoryTemp.length; i++ ) {
                    let newObj = {
                        event: findHistoryTemp[i].event,
                        event_options: findHistoryTemp[i].event_options,
                        kartaNodeId: findHistoryTemp[i].kartaNodeId,
                        userId: findHistoryTemp[i].userId,
                        versionId: newVersion.id,
                        kartaId: findHistoryTemp[i].kartaId,
                        historyType: 'temp'
                    };
                    findHistoryTemp[i].parentNodeId ? newObj['parentNodeId'] = findHistoryTemp[i].parentNodeId : null;

                    await Kartaversion.app.models.karta_history.create(newObj);
                }
            }

            if( findHistoryMain.length > 0 ){
                for( let i = 0; i < findHistoryMain.length; i++ ) {
                    let newObj = {
                        event: findHistoryMain[i].event,
                        event_options: findHistoryMain[i].event_options,
                        kartaNodeId: findHistoryMain[i].kartaNodeId,
                        userId: findHistoryMain[i].userId,
                        versionId: newVersion.id,
                        kartaId: findHistoryMain[i].kartaId,
                        historyType: 'temp'
                    };
                    findHistoryMain[i].parentNodeId ? newObj['parentNodeId'] = findHistoryMain[i].parentNodeId : null;

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
