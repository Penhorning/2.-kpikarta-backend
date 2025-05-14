'use strict';

const cron = require('node-cron');
const moment = require('moment-timezone');
const { create_subscription } = require('../stripe');
const { sendEmail } = require('../../helper/sendEmail');

exports.createSubscriptionCron = (app) => {
    
    // CronJob for Starting Subscriptions after trial ends
    // CronJob runs in every 2 seconds
    cron.schedule('*/2 * * * * *', async () => {
        try {
            // Start subscription for the users whose trial is over
            const currentDate = moment().unix();
            const subscribedUsers = await app.models.subscription.find({ where: { trialActive: true, trialEnds: { lte: currentDate }, status: false, cronCheck: false }});
            let userIds = [];
            for (let c = 0; c < subscribedUsers.length; c++ ) {
                userIds.push(subscribedUsers[c].userId);
            };
            await app.models.subscription.update({ "trialActive": true, "status": false, "userId": { in: userIds} }, { "cronCheck": true });
            if ( subscribedUsers.length > 0 ) {
                for ( let i = 0; i < subscribedUsers.length; i++ ) {
                    let userData = await app.models.user.findOne({ where: { "id": subscribedUsers[i].userId, is_deleted: false }});
                    userData = JSON.parse(JSON.stringify(userData));
                    if (userData) {
                        const license = await app.models.license.findOne({ where: { id: userData.licenseId }});
                        if (license.name == "Spectator") {
                            await Subscription.deleteAll({ userId: subscribedUsers[i].userId });
                        } else {
                            const priceData = await app.models.price_mapping.findOne({ where: { licenseType: license.name, interval: subscribedUsers[i].currentPlan == "monthly" ? "month": "year" }});
                            let subscription = await create_subscription({ customerId: subscribedUsers[i].customerId, items: [{price: priceData.priceId, quantity: 1}] });
                            await app.models.subscription.update({ "id": subscribedUsers[i].id }, { trialActive: false, subscriptionId: subscription.id, status: true, cronCheck: false });
                        }
                    } else {
                        await app.models.subscription.update({ "id": subscribedUsers[i].id }, { "trialActive": false, "subscriptionId": "deactivated", "status": false, "cronCheck": false });
                    }
                }
                console.log("Subscriptions started successfully..!!");
            }

        } catch (err) {
            console.log(`==========>>>>> WHILE CREATING SUBSCRIPTIONS (${new Date()}) = Someting went wrong `, err);
            throw err;
        }
    },
    {
        timezone: "Asia/Kolkata"
    });

    // SEND WEB/EMAIL NOTIFICATION 3 DAYS BEFORE TRIAL ENDS
    // CronJob at 06:30pm EDT & 10:30pm UTC & 04:00am IST
    // cron.schedule('*/5 * * * * *', async () => {
    cron.schedule('00 04 * * *', async () => {
        try {
            const threeDaysLaterStart = moment().add(process.env.TRIAL_EMAIL_CRON, 'days').startOf("day").unix();
            const threeDaysLaterEnd = moment().add(process.env.TRIAL_EMAIL_CRON, 'days').endOf("day").unix();
            let subscribedUsers = await app.models.subscription.find({ where: { trialActive: true, trialEnds: { gte: threeDaysLaterStart, lte: threeDaysLaterEnd }, status: false }});
            subscribedUsers = JSON.parse(JSON.stringify(subscribedUsers));

            let filteredUsers = [];
            for(let j = 0; j < subscribedUsers.length; j++) {
                if(threeDaysLaterStart <= subscribedUsers[j].trialEnds && subscribedUsers[j].trialEnds <= threeDaysLaterEnd ) {
                    filteredUsers.push(subscribedUsers[j])
                }
            }

            if(filteredUsers.length > 0) {
                // Prepare notification collection data
                let notificationData = [];
                let emailData = [];
                for(let i = 0; i < filteredUsers.length; i++) {
                    // Notification Data
                    let notificationObj = {
                        // title: `${app.currentUser.fullName} shared the node ${node.name}`,
                        title: `Your trial period will be over after 3 days.`,
                        type: "trial_period",
                        contentId: filteredUsers[i].id,
                        userId: filteredUsers[i].userId
                    };
                    notificationData.push(notificationObj);

                    // Email Data
                    const userDetails = await app.models.user.findOne({ where: { id: filteredUsers[i].userId }});
                    userDetails['lastDate'] = moment.unix(filteredUsers[i].trialEnds).format("MM/DD/YYYY");
                    const emailObj = {
                        subject: `KPI trial period reminder`,
                        template: "trial-period.ejs",
                        email: userDetails.email,
                        user: userDetails,
                    };
                    emailData.push(emailObj);
                }
      
                // Insert data in notification collection
                await app.models.notification.create(notificationData);

                // Send Email - Need Testing here
                if(emailData.length > 0) {
                    for(let j = 0; j < emailData.length; j++ ) {
                        let email = emailData[j];
                        sendEmail(app, email, () => {});
                    }
                }

                console.log("Notifications and Emails sent successfully..!!");
            }
        } catch(err) {
            console.log(`==========>>>>> WHILE SENDING TRAIL NOTIFICATION (${new Date()}) = Someting went wrong `, err);
            throw err;
        }
    });
}