'use strict';

module.exports = function(Kartaphase) {
    // Create history
    const createHistory = async (kartaId, node, updatedData, randomKey, event = "node_updated") => {
        const userIdValue = Kartaphase.app.currentUser.id;
        Kartaphase.app.models.karta.findOne({ where: { "_id": kartaId } }, {}, (err, karta) => {
        // Prepare history data
        let history_data = {
            event,
            kartaNodeId: node.id,
            userId: userIdValue,
            versionId: karta.versionId,
            kartaId: kartaId,
            parentNodeId: node.parentId,
            historyType: 'main',
            randomKey
        }
        event == "node_removed" ? history_data["event_options"] = {
            created: null,
            updated: null,
            removed: updatedData
        } : event == "node_updated" ? history_data["event_options"] = {
            created: null,
            updated: updatedData,
            removed: null
        } : history_data["event_options"] = {
            created: updatedData,
            updated: null,
            removed: null
        }
        if (event == "node_updated") {
            let oldOptions = {};
            Object.keys(updatedData).forEach(el => oldOptions[el] = node[el]);
            history_data["old_options"] = oldOptions;
        }
        // Create history of current node
        Kartaphase.app.models.karta_history.create(history_data, {}, (err, response) => {
            if (err) console.log(err, 'err');
            Kartaphase.app.models.karta.update({ "id": kartaId }, { "historyId": response.id }, () => {});
        });
        });
    }

    // Adjust weightage
    const reAdjustWeightage = async (kartaId, parentId, phaseId, randomKey) => {
        // Find children of current karta
        const childrens = await Kartaphase.app.models.karta_node.find({ where: { "kartaDetailId": kartaId, parentId, phaseId, "is_deleted": false } });
        // Assign divided weightage to all the nodes of that phase of current karta
        if (childrens.length > 0) {
        // Divide weightage
        const weightage = + (100 / childrens.length).toFixed(2);
        await Kartaphase.app.models.karta_node.updateAll({ "kartaDetailId": kartaId, parentId, phaseId, "is_deleted": false }, { weightage });
        // Create new history
        for (let children of childrens) createHistory(kartaId, children, { weightage }, randomKey);
        }
    }

    // Delete extra added child phase and reconnect it's child to the above phase
    Kartaphase.delete = async (kartaId, phaseId, nextPhaseId) => {
        try {
            // Random key
            const randomKey = new Date().getTime();
            // Find Karta Details
            const kartaDetails = await Kartaphase.app.models.karta.findOne({ where: { "_id": kartaId } });
            // Find phase details
            const currentPhase = await Kartaphase.findOne({ where: { "_id": phaseId } });
            let removed_phase = currentPhase.__data;
            delete removed_phase["id"];
            // Set the status of phase to deleted along with its history
            await Kartaphase.update({ "_id": phaseId, "is_child": true } , { $set: { "is_deleted": true } });
            let history_data = {
                event: "phase_removed",
                kartaNodeId: phaseId,
                userId: Kartaphase.app.currentUser.id,
                versionId: kartaDetails.versionId,
                kartaId: kartaId,
                parentNodeId: currentPhase.parentId,
                historyType: 'main',
                event_options: {
                  created: null,
                  updated: null,
                  removed: removed_phase,
                },
                randomKey
            }
            await Kartaphase.app.models.karta_history.create(history_data);

            // Reconnect child phase to another parent
            const childPhase = await Kartaphase.findOne({ where: { "parentId": phaseId }});
            if (childPhase) {
                await Kartaphase.update({ "id": childPhase.id } , { $set: { "parentId": currentPhase.parentId } });
                let history_data = {
                    event: "phase_updated",
                    kartaNodeId: childPhase.id,
                    userId: Kartaphase.app.currentUser.id,
                    versionId: kartaDetails.versionId,
                    kartaId: kartaId,
                    parentNodeId: phaseId,
                    historyType: 'main',
                    event_options: {
                        created: null,
                        updated: { "parentId": currentPhase.parentId },
                        removed: null,
                    },
                    old_options: { "parentId": phaseId },
                    randomKey
                }
                // Create history of updated node
                await Kartaphase.app.models.karta_history.create(history_data);
            }

            // Find nodes that are attached to current phase and set it to deleted
            const nodes = await Kartaphase.app.models.karta_node.find({ where: { "kartaDetailId": kartaId, phaseId } });
            if (nodes.length > 0) {
                for (let j=0; j<nodes.length; j++) {
                    let item = nodes[j];
                    // Set the status of node to deleted along with its history
                    await Kartaphase.app.models.karta_node.update({ "_id": item.id }, { $set: { "is_deleted": true } });
                    let removed_node = item;
                    delete removed_node["id"];
                    let history_data = {
                        event: "node_removed",
                        kartaNodeId: item.id,
                        userId: Kartaphase.app.currentUser.id,
                        versionId: kartaDetails.versionId,
                        kartaId: kartaId,
                        parentNodeId: item.parentId,
                        historyType: 'main',
                        event_options: {
                          created: null,
                          updated: null,
                          removed: removed_node.__data,
                        },
                        randomKey
                    };
                    // Create history
                    await Kartaphase.app.models.karta_history.create(history_data);

                    // Find childrens of deleted node
                    const childrens = await Kartaphase.app.models.karta_node.find({ where: { "parentId": item.id }});
                    if (childrens.length > 0) {
                        for (let k=0; k<childrens.length; k++) {
                            let currentNode = childrens[k].__data;
                            // Reconnect child nodes to another parent
                            await Kartaphase.app.models.karta_node.update({ "id": currentNode.id }, { $set: { "parentId": item.parentId } }); 
                            let history_data = {
                                event: "node_updated",
                                kartaNodeId: currentNode.id,
                                userId: Kartaphase.app.currentUser.id,
                                versionId: kartaDetails.versionId,
                                kartaId: kartaId,
                                parentNodeId: currentNode.parentId,
                                historyType: 'main',
                                event_options: {
                                  created: null,
                                  updated: { "parentId": item.parentId },
                                  removed: null,
                                },
                                old_options: { "parentId": item.id },
                                randomKey
                            }
                            // Create history of updated node
                            let history = await Kartaphase.app.models.karta_history.create(history_data);
                            if ( k == childrens.length - 1) await Kartaphase.app.models.karta.update({ "id": kartaId }, { "historyId": history.id });
                        }
                    }
                }
                // Readjust weightage
                for (let node of nodes) {
                    await reAdjustWeightage(kartaId, node.parentId, nextPhaseId, randomKey);
                }
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
            const randomKey = new Date().getTime();
            const kartaDetails = await Kartaphase.app.models.karta.findOne({where: { id: phase.kartaId }});
            // Creating Phase history
            let created_phase = phase.__data;
            created_phase["id"] ? delete created_phase["id"] : null;
            let history_data = {
                event: "phase_created",
                kartaNodeId: phase.id,
                userId: Kartaphase.app.currentUser.id,
                versionId: kartaDetails.versionId,
                kartaId: phase.kartaId,
                parentNodeId: phase.parentId,
                historyType: 'main',
                event_options: {
                    created: created_phase,
                    updated: null,
                    removed: null,
                },
                randomKey
            };
            await Kartaphase.app.models.karta_history.create(history_data);

            // Overall flow for updating and creating empty child nodes
            await Kartaphase.update({ "_id": phase.id }, { "global_name": phase.name });
            if (addEmptyNodes) {
                // Find nodes that are attached to current phase parent
                const nodes = await Kartaphase.app.models.karta_node.find({ where: { "kartaDetailId": phase.kartaId, "phaseId": phase.parentId, "is_deleted": false } });
                if (nodes.length > 0) {
                    // Reconnect child nodes to newly added empty nodes
                    for ( let i = 0; i < nodes.length; i++ ) {
                        let item = nodes[i];
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

                            // Create History
                            let created_node = node.__data;
                            created_node["id"] ? delete created_node["id"] : null;
                            let history_data = {
                                event: "node_created",
                                kartaNodeId: node.id,
                                userId: Kartaphase.app.currentUser.id,
                                versionId: kartaDetails.versionId,
                                kartaId: phase.kartaId,
                                parentNodeId: node.parentId,
                                historyType: 'main',
                                event_options: {
                                    created: created_node,
                                    updated: null,
                                    removed: null,
                                },
                                randomKey
                            };
                            await Kartaphase.app.models.karta_history.create(history_data);
                            let nodeChildrens = await Kartaphase.app.models.karta_node.find({ where: { "_id": { $neq: node.id }, "parentId": item.id } });
                            for ( let j = 0; j < nodeChildrens.length; j++ ) {
                                let nodeChild = nodeChildrens[j];
                                await Kartaphase.app.models.karta_node.update({ "_id": nodeChild.id, "parentId": item.id }, { $set: { "parentId": node.id } });   
                                let history_data = {
                                    event: "node_updated",
                                    kartaNodeId: nodeChild.id,
                                    userId: Kartaphase.app.currentUser.id,
                                    versionId: kartaDetails.versionId,
                                    kartaId: kartaDetails.id,
                                    parentNodeId: item.id,
                                    historyType: 'main',
                                    event_options: {
                                      created: null,
                                      updated: { "parentId": node.id },
                                      removed: null,
                                    },
                                    old_options: { "parentId": item.id },
                                    randomKey
                                }
                                const history = await Kartaphase.app.models.karta_history.create(history_data);
                                if(j == nodeChildrens.length - 1) await Kartaphase.app.models.karta.update({ "id": phase.kartaId }, { "historyId": history.id });
                            }
                            // await Kartaphase.app.models.karta_node.update({ "_id": { $neq: node.id }, "parentId": item.id }, { $set: { "parentId": node.id } });
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
