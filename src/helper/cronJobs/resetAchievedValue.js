'use strict';
const cron = require('node-cron');

exports.resetAchievedValueCron = (app) => {

  // Create history
  const createHistory = async (kartaId, node, updatedData, randomKey, event = "node_updated") => {
    const userIdValue = 'CRON_USER';
    app.models.karta.findOne({ where: { "_id": kartaId } }, {}, (err, karta) => {
    // Prepare history data
    let history_data = {
        event,
        kartaNodeId: node.id,
        userId: userIdValue,
        versionId: karta.versionId,
        kartaId: kartaId,
        parentNodeId: node.parentId,
        historyType: 'main',
        randomKey: randomKey.toString()
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
    app.models.karta_history.create(history_data, {}, (err, response) => {
        if (err) console.log(err, 'err');
        app.models.karta.update({ "id": kartaId }, { "historyId": response.id }, () => {});
    });
    });
  }

  // CronJob for 1st day of month
  cron.schedule('* * 1 * *', async () => {
    try {
      const nodes = await app.models.KartaNode.find({ where: { "is_deleted": false, "contributorId": { exists: true } } });
      if (nodes && nodes.length > 0) {
        console.log(`==========>>>>> ${nodes.length} NODES FOUND FOR RESETTING THE ACHIEVED VALUE`);
        for (let node of nodes) {
          node = JSON.parse(JSON.stringify(node));
          await app.models.KartaNode.update({ "_id": node.id }, { "achieved_value": 0 });
          let randomKey = new Date().getTime().toString();
          console.log(`==========>>>>> NODE(${node.id}) ACHIEVED VALUE RESET`);
          await createHistory(node.kartaDetailId, node, { "achieved_value": 0 }, randomKey);
          await createHistory(node.kartaDetailId, node, { "target": node.target }, randomKey);
          if (node.node_type === "metrics" && node.node_formula) {
            await createHistory(node.kartaDetailId, node, { "node_formula": node.node_formula }, randomKey);
          }
        }
      }
    } catch (err) {
      console.log(`==========>>>>> WHILE RESET ACHIEVED VALUE CRON (${new Date()}) = Someting went wrong `, err);
      throw err;
    }
  },
  {
    timezone: "Asia/Kolkata"
  });
}