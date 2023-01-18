'use strict';

module.exports = function(Kartaphase) {
    // Delete extra added child phase and reconnect it's child to the above phase
    Kartaphase.delete = async (kartaId, phaseId) => {
        try {
            // Find phase details
            const currentPhase = await Kartaphase.findOne({ where: { "_id": phaseId } });
            // Set the status of phase to deleted
            await Kartaphase.update({ "_id": phaseId } , { $set: { "is_deleted": true } });
            // Reconnect child phase to another parent
            await Kartaphase.update({ "parentId": currentPhase.id } , { $set: { "parentId": currentPhase.parentId } });
            // Find nodes that are attached to current phase
            const nodes = await Kartaphase.app.models.karta_node.find({ where: { "kartaDetailId": kartaId, phaseId } });
            if (nodes.length > 0) {
                // Reconnect child nodes to another parent
                nodes.forEach(async item => {
                    await Kartaphase.app.models.karta_node.update({ "_id": item.id } , { $set: { "is_deleted": true } });
                    await Kartaphase.app.models.karta_node.update({ "parentId": item.id } , { $set: { "parentId": item.parentId } }); 
                });
                return "Phase deleted successfully!";
            }
        } catch (err) {
            console.log("===>>> Error in deleting child phase ", err);
            return err;
        }
    }

    // After phase create, set global name
    Kartaphase.afterRemote('create', (context, phase, next) => {
        Kartaphase.update({ "_id": phase.id }, { "global_name": phase.name }, (err, result) => {
            next(err, result);
        });
    });
};
