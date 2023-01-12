'use strict';

const cron = require('node-cron');
const moment = require('moment-timezone');
const { create_subscription, update_subscription } = require('../stripe');

exports.createSubscriptionCron = (app) => {
    // CronJob for everyday at midnight
    cron.schedule('0 0 * * *', async () => {
    // cron.schedule('*/5 * * * * *', async () => {
        try {
            const currentDate = moment().unix();
            const subscribedUsers = await app.models.subscription.find({ where: { trialActive: true, trialEnds: { lte: currentDate }, status: false }});
            if ( subscribedUsers.length > 0 ) {
                for (let i = 0; i < subscribedUsers.length; i++ ) {
                    let finalItems = [];
                    let updatedItems = [];
                    let priceMapper = {};
                    let currentSubscribedUser = subscribedUsers[i];
                    const userData = await app.models.user.findOne({ where: { "id": currentSubscribedUser.userId }});
                    const findRegisteredUserDetails = await app.models.user.find({ where: { "companyId": userData.companyId }});
                    let userTracker = {
                        "Creator": {name: "Creator", quantity: 0 },
                        "Champion": {name: "Champion", quantity: 0 },
                        // "Spectator": {name: "Spectator", quantity: 0 },
                    };

                    for (let j = 0; j < findRegisteredUserDetails.length; j++) {
                        let currentUser = findRegisteredUserDetails[j];
                        const licenseId = await app.models.license.findOne({ where: { id: currentUser.licenseId }});
                        userTracker[licenseId.name] = { ...userTracker[licenseId.name], quantity: userTracker[licenseId.name].quantity + 1 };
                    }

                    for( let k = 0; k < Object.keys(userTracker).length; k++ ) {
                        const priceData = await app.models.price_mapping.findOne({ where: { licenseType: Object.keys(userTracker)[k], interval: userData.currentPlan == "monthly" ? "month": "year" }});
                        priceMapper[priceData.priceId] = Object.values(userTracker)[k].quantity;
                        finalItems.push({ price: priceData.priceId, quantity: 0 });
                    }

                    let subscription = await create_subscription({ customerId: currentSubscribedUser.customerId, items: finalItems });
                    await app.models.subscription.update({ "id": currentSubscribedUser.id }, { trialActive: false, subscriptionId: subscription.id, status: true });

                    for( let l = 0; l < subscription.items.data.length; l++ ) {
                        let currentPrice = subscription.items.data[l];
                        updatedItems.push({
                            id: currentPrice.id,
                            quantity: priceMapper[currentPrice.price.id]
                        });
                    }
                    
                    await update_subscription(subscription.id, { items: updatedItems, proration_behavior: 'none' });
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
}