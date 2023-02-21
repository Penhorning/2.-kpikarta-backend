'use strict';

const cron = require('node-cron');
const moment = require('moment-timezone');
const { sendEmail } = require('../../helper/sendEmail');

exports.profileStatusCron = (app) => {
    // CronJob for everyday at midnight
    cron.schedule('0 0 * * 5', async () => {
    // cron.schedule('*/4 * * * * *', () => {
        try {
            app.models.User.getDataSource().connector.connect(function (err, db) {
                const userCollection = db.collection('user');
                userCollection.aggregate([
                  {
                    $match: {
                        $or: [{ "profilePic" : { $exists: false } }, { "profilePic" : { $eq: "" } }],
                        $or: [{ "mobileVerified" : { $exists: false } }, { "mobileVerified" : { $eq: "" } }, , { "mobileVerified" : { $eq: false } }],
                        $or: [{ "_2faEnabled" : { $exists: false } }, { "_2faEnabled" : { $eq: "" } }, { "_2faEnabled" : { $eq: false } }],
                        $or: [{ "street" : { $exists: false } }, { "street" : { $eq: "" } }],
                        $or: [{ "city" : { $exists: false } }, { "city" : { $eq: "" } }],
                        $or: [{ "state" : { $exists: false } }, { "state" : { $eq: "" } }],
                        $or: [{ "postal_code" : { $exists: false } }, { "postal_code" : { $eq: "" } }],
                        $or: [{ "country" : { $exists: false } }, { "country" : { $eq: "" } }],
                    }
                  }
                ]).toArray((err, result) => {
                  if (err) throw err;
                  else {
                    if(result.length > 0) {
                      for(let i = 0; i < result.length; i++) {
                        const emailObj = {
                          subject: `Profile Status`,
                          template: "profile-reminder.ejs",
                          email: result[i].email,
                          user: result[i],
                        };
                        sendEmail(app, emailObj, () => {});
                      }
                    }
                    // console.log("contributorId", result);
                  }
                });
              });
        } catch (err) {
            console.log(`==========>>>>> WHILE PROFILE NOTIFICATION (${new Date()}) = Someting went wrong `, err);
            throw err;
        }
    },
    {
        timezone: "Asia/Kolkata"
    });
}