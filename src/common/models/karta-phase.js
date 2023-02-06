'use strict';

module.exports = function(Kartaphase) {
    // Delete extra added child phase and reconnect it's child to the above phase
    Kartaphase.delete = async (kartaId, phaseId) => {
        try {
            // Find phase details
            const currentPhase = await Kartaphase.findOne({ where: { "_id": phaseId } });
            // Set the status of phase to deleted
            await Kartaphase.update({ "_id": phaseId, "is_child": true } , { $set: { "is_deleted": true } });
            // Reconnect child phase to another parent
            await Kartaphase.update({ "parentId": currentPhase.id } , { $set: { "parentId": currentPhase.parentId } });
            // Find nodes that are attached to current phase
            const nodes = await Kartaphase.app.models.karta_node.find({ where: { "kartaDetailId": kartaId, phaseId } });
            if (nodes.length > 0) {
                // Reconnect child nodes to another parent
                nodes.forEach(async item => {
                    await Kartaphase.app.models.karta_node.update({ "_id": item.id }, { $set: { "is_deleted": true } });
                    await Kartaphase.app.models.karta_node.update({ "parentId": item.id }, { $set: { "parentId": item.parentId } }); 
                });
                return "Phase deleted successfully!";
            }
        } catch (err) {
            console.log("===>>> Error in deleting child phase ", err);
            return err;
        }
    }

    // After phase create, set global name
    Kartaphase.afterRemote('create', async (context, phase, next) => {
        const { addEmptyNodes, nextPhaseId } = context.req.body;
        
        try {
            await Kartaphase.update({ "_id": phase.id }, { "global_name": phase.name });
            if (addEmptyNodes) {
                // Find nodes that are attached to current phase parent
                const nodes = await Kartaphase.app.models.karta_node.find({ where: { "kartaDetailId": phase.kartaId, "phaseId": phase.parentId, "is_deleted": false } });
                if (nodes.length > 0) {
                    // Reconnect child nodes to newly added empty nodes
                    for (let item of nodes) {
                        // Find if we have nested children
                        const nestedChildrens = await Kartaphase.app.models.karta_node.findOne({ where: { "parentId": item.id, "kartaDetailId": phase.kartaId, "phaseId": nextPhaseId, "is_deleted": false } });
                        if (nestedChildrens) {
                            // Create emtpy node
                            let data = {
                                name: "Empty",
                                kartaDetailId: item.kartaDetailId,
                                phaseId: phase.id,
                                parentId: item.id,
                                weightage: 100
                            }
                            const node = await Kartaphase.app.models.karta_node.create(data);
                            await Kartaphase.app.models.karta_node.update({ "_id": { $neq: node.id }, "parentId": item.id }, { $set: { "parentId": node.id } });
                        }
                    }
                    return "Phase created successfully!";
                }
            }
        } catch (err) {
            console.log("===>>> Error in update global phase name and creating empty ndoes ", err);
            return err;
        }
    });
};
