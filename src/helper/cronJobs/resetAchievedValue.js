'use strict';
const cron = require('node-cron');
const moment = require('moment-timezone');

exports.resetAchievedValueCron = (app) => {

  // Create history
  const createHistory = async (kartaId, node, updatedData, randomKey, event = "node_updated") => {
    const userIdValue = 'CRON_USER';
    app.models.karta.findOne({ where: { "_id": kartaId } }, {}, (err, karta) => {
    // Prepare history data
    let history_data = {
        event,
        kartaNodeId: node.id,
        userId: karta.userId || userIdValue,
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

  // CronJob at 04:30 EDT & 08:00 UTC & 14:00 IST
  // cron.schedule('00 14 * * *', async () => {
  cron.schedule('*/2 * * * *', async () => {
    try {
      const todayDate = moment().endOf('day').toDate();

      const query = {
        "is_deleted": false,
        $and: [{ "contributorId": { exists: true } }, { "contributorId": { $ne: null } }],
        "due_date": { $lte: todayDate }
      }
      const nodes = await app.models.KartaNode.find({ where: query });
      if (nodes && nodes.length > 0) {
        console.log(`==========>>>>> ${nodes.length} NODES FOUND FOR RESETTING THE ACHIEVED VALUE & DUE DATE`);
        for (let node of nodes) {
          node = JSON.parse(JSON.stringify(node));
          // Set new due date
          let new_due_date = moment();
          if (node.target[0].frequency === "weekly") {
            new_due_date = moment().add(1, 'weeks');
          } else if (node.target[0].frequency === "monthly") {
            new_due_date = moment().add(1, 'months');
          } else if (node.target[0].frequency === "quarterly") {
            new_due_date = moment().add(3, 'months');
          } else if (node.target[0].frequency === "yearly") {
            new_due_date = moment().add(1, 'years');
          }
          await app.models.KartaNode.update({ "_id": node.id }, { "achieved_value": 0, "due_date": new_due_date });

          console.log(`==========>>>>> NODE(${node.id}) ACHIEVED VALUE & DUE DATE RESET`);
          
          // Create history
          let randomKey = new Date().getTime().toString();
          await createHistory(node.kartaDetailId, node, { "achieved_value": 0 }, randomKey);
          await createHistory(node.kartaDetailId, node, { "due_date": new_due_date }, randomKey);
          await createHistory(node.kartaDetailId, node, { "target": node.target }, randomKey);

          if (node.node_type === "metrics" && node.node_formula) {
            await createHistory(node.kartaDetailId, node, { "node_formula": node.node_formula }, randomKey);
          }
        }
      }
    } catch (err) {
      console.log(`==========>>>>> WHILE RESET ACHIEVED VALUE & DUE DATE CRON (${new Date()}) = Someting went wrong `, err);
      throw err;
    }
  },
  {
    timezone: "Asia/Kolkata"
  });
}