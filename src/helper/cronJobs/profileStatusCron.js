'use strict';

const cron = require('node-cron');
const moment = require('moment-timezone');

exports.profileStatusCron = (app) => {
    // CronJob for everyday at midnight
    cron.schedule('0 0 * * 5', async () => {
        try {
            console.log("Profile notification");
        } catch (err) {
            console.log(`==========>>>>> WHILE PROFILE NOTIFICATION (${new Date()}) = Someting went wrong `, err);
            throw err;
        }
    },
    {
        timezone: "Asia/Kolkata"
    });
}