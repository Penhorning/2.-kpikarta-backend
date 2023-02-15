'use strict';
const cron = require('node-cron');

exports.resetAchievedValueCron = (app) => {
  // CronJob for 1st day of month
  cron.schedule('* * 1 * *', async () => {
    try {
      await app.models.KartaNode.update({ "is_deleted": false, "contributorId": { exists: true } }, { "achieved_value": 0 });
    } catch (err) {
      console.log(`==========>>>>> WHILE RESET ACHIEVED VALUE CRON (${new Date()}) = Someting went wrong `, err);
      throw err;
    }
  },
  {
    timezone: "Asia/Kolkata"
  });
}