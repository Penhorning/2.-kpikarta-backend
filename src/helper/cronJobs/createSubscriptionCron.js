'use strict';

const cron = require('node-cron');
const moment = require('moment-timezone');
const { create_subscription, update_subscription } = require('../stripe');
const { sendEmail } = require('../../helper/sendEmail');

exports.createSubscriptionCron = (app) => {
    
    // CronJob for Starting Subscriptions after trial ends
    // cron.schedule('0 0 * * *', async () => {
    cron.schedule('*/2 * * * * *', async () => {
        try {
            // Start subscription for the users whose trial is over
            const currentDate = moment().unix();
            const subscribedUsers = await app.models.subscription.find({ where: { trialActive: true, trialEnds: { lte: currentDate }, status: false, cronCheck: false, cardHolder: true }});
            if ( subscribedUsers.length > 0 ) {
                let userIds = [];
                for (let c = 0; c < subscribedUsers.length; c++ ) {
                    userIds.push(subscribedUsers[c].userId);
                };
                await app.models.subscription.update({ "trialActive": true, "trialEnds": { lte: currentDate }, "status": false, "userId": { in: userIds} }, { "cronCheck": true });

                for (let i = 0; i < subscribedUsers.length; i++ ) {
                    let currentSubscribedUser = subscribedUsers[i];
                    const sameCompanyUsers = await app.models.subscription.find({ where: { trialActive: true, trialEnds: { lte: currentDate }, status: false, cronCheck: false, companyId: currentSubscribedUser.companyId } });
                    if (sameCompanyUsers.length > 0) {
                        for (let j = 0; j < sameCompanyUsers.length; j++) {
                            let companyUser = sameCompanyUsers[j];
                            const userData = await app.models.user.findOne({ where: { "id": companyUser.userId, is_deleted: false }});
                            if (userData) {
                                const license = await app.models.license.findOne({ where: { id: userData.licenseId }});
                                const priceData = await app.models.price_mapping.findOne({ where: { licenseType: license.name, interval: companyUser.currentPlan == "monthly" ? "month": "year" }});
                                let subscription = await create_subscription({ customerId: companyUser.customerId, items: [{price: priceData.priceId, quantity: 1}] });
                                await app.models.subscription.update({ "id": companyUser.id }, { trialActive: false, subscriptionId: subscription.id, status: true, cronCheck: false });
                            } else {
                                await app.models.subscription.update({ "id": companyUser.id }, { trialActive: false, subscriptionId: "deactivated", status: false, cronCheck: false });
                            }
                        }
                    }
                } 
                console.log("Subscriptions started successfully..!!");
            }

            // Start subscription for those users who recently got activated again by Admin
            const recentlyActivatedUsers = await app.models.subscription.find({ where: { status: true, subscriptionId: "deactivated" }});
            if (recentlyActivatedUsers.length > 0) {
                for(let i = 0; i < recentlyActivatedUsers.length; i++) {
                    let currentSubscribedUser = recentlyActivatedUsers[i];
                    const userData = await app.models.user.findOne({ where: { "id": currentSubscribedUser.userId, is_deleted: false }});
                    if (userData) {
                        const license = await app.models.license.findOne({ where: { id: userData.licenseId }});
                        const priceData = await app.models.price_mapping.findOne({ where: { licenseType: license.name, interval: currentSubscribedUser.currentPlan }});
                        let subscription = await create_subscription({ customerId: currentSubscribedUser.customerId, items: [{price: priceData.priceId, quantity: 1}] });
                        await app.models.subscription.update({ "id": currentSubscribedUser.id }, { subscriptionId: subscription.id, status: true });
                    } else {
                        await app.models.subscription.update({ "id": currentSubscribedUser.id }, { subscriptionId: "deactivated", status: false });
                    }

                    console.log("Recently activated user's subscription started..");
                }
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
    // cron.schedule('*/5 * * * * *', async () => {
    cron.schedule('0 4 * * *', async () => {
        try {
            // var currentTime = moment().unix();
            // let trialEndDate = moment.unix("1674468805").format("YYYY/MM/DD");
            // let currentDate = moment.unix(currentTime).format("YYYY/MM/DD");
            // let difference = moment(trialEndDate.split("/")).diff(moment(currentDate.split("/")), 'days');

            const startDay = moment().add(3, 'days').startOf("day").unix();
            const endDay = moment().add(3, 'days').endOf("day").unix();
            const subscribedUsers = await app.models.subscription.find({ where: { trialActive: true, trialEnds: { gte: startDay, lte: endDay }, status: false }});

            if(subscribedUsers.length > 0) {
                // Prepare notification collection data
                let notificationData = [];
                let emailData = [];
                for(let i = 0; i < subscribedUsers.length; i++) {
                    // Notification Data
                    let notificationObj = {
                        // title: `${app.currentUser.fullName} shared the node ${node.name}`,
                        title: `Your trial period will be over after 3 days.`,
                        type: "trial_period",
                        contentId: subscribedUsers[i].id,
                        userId: subscribedUsers[i].userId
                    };
                    notificationData.push(notificationObj);

                    // Email Data
                    const userDetails = await app.models.user.findOne({ where: { id: subscribedUsers[i].userId }});
                    userDetails['lastDate'] = moment.unix(subscribedUsers[i].trialEnds).format("MM/DD/YYYY");
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