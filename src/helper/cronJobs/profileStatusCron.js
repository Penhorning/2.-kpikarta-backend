'use strict';

const cron = require('node-cron');
const { sendEmail } = require('../../helper/sendEmail');

exports.profileStatusCron = (app) => {
    // CronJob runs at every friday
    // cron.schedule('0 0 * * 5', async () => {
    cron.schedule('*/5 * * * *', () => {
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
                        "subscriptionStatus": { $in: ["in_trial", "active"] },
                        "active": true,
                        "is_deleted": false
                    }
                  }
                ]).toArray((err, result) => {
                  if (err) throw err;
                  else {
                    if (result.length > 0) {
                      for (let user of result) {
                        const emailObj = {
                          subject: `Profile Status`,
                          template: "profile-reminder.ejs",
                          email: user.email,
                          user,
                          profileLink: `${process.env.WEB_URL}/my-profile`
                        };
                        sendEmail(app, emailObj, () => {});
                      }
                    }
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