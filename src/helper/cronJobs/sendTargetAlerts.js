'use strict';

const cron = require('node-cron');
const moment = require('moment-timezone');
const { sendEmail } = require('../sendEmail');


const thresholdValue = 75;
const models = [
    {
        "relation": "contributor",
        "scope": {
            "fields": ["fullName", "email"]
        }
    },
    {
        "relation": "karta_detail",
        "scope": {
            "fields": ["name", "userId"],
            "include": {
                "relation": "owner",
                "scope": {
                    "fields": ["fullName", "email"]
                }
            }
        }
    }
]

exports.sendTargetAlertsCron = async (app) => {
    // Date variables
    const todayDate = moment().date();
    const currentYear = moment().year();
    const dayOfYear = moment().dayOfYear();
    const daysInMonth = moment().daysInMonth();
    const daysInYear = moment([currentYear]).isLeapYear() ? 366 : 365;

    // Get number of days between two dates
    const getDifference = (startDate, endDate) => {
        return moment(endDate).startOf('day').diff(moment(startDate).startOf('day'), 'days');
    }
    // Send notification or email alerts
    const sendAlert = async (params, item) => {
        if (params["percentage"] < params["thresholdValue"] && item.alert_type === "notification") {
            const notificationData =  {
                title: `${item.contributor().fullName} has not completely fill the ${item.name}'s achieved value in ${item.karta_detail().name}`,
                type: "kpi_node_alert",
                contentId: item.kartaDetailId,
                userId: item.notifyUserId
            }
            await app.models.notification.create(notificationData);
            await app.models.KartaNode.update({ "_id": item.id }, { "last_alert_sent_on": new Date() });
        } else if (params["percentage"] < params["thresholdValue"] && item.alert_type === "email") {
            const data = {
                subject: "KPI Target Alert",
                template: "kpi-target-alert.ejs",
                email: item.karta_detail().owner().email,
                
                username: item.karta_detail().owner().fullName,
                nodeName: item.name,
                targetType: item.target[0].frequency[0].toUpperCase() + item.target[0].frequency.slice(1),
                targetValue: item.target[0].value,
                achievedValue: item.achieved_value
            }
            sendEmail(app, data, async () => {
                await app.models.KartaNode.update({ "_id": item.id }, { "last_alert_sent_on": new Date() });
            });
        }
    }
    // Check target frequency and send alert accordingly
    const checkTargetFrequency = (item) => {
        if (item.target[0].frequency === 'monthly') {
            const todayTargetValue = todayDate * (item.target[0].value / daysInMonth);
            const percentage = (item.achieved_value/todayTargetValue) * 100;
            sendAlert({ percentage, thresholdValue, todayTargetValue }, item);
        } else if (item.target[0].frequency === 'quarterly') {
            let diff = getDifference(item.start_date, moment());
            if (diff > 90) {
                let d = parseInt((diff/90));
                let n = diff - (90*d);
                todayDate = n;
            }
            else todayDate = diff;
            const todayTargetValue = todayDate * (item.target[0].value / 90);
            const percentage = (item.achieved_value/todayTargetValue) * 100;
            sendAlert({ percentage, thresholdValue, todayTargetValue }, item);
        } else if (item.target[0].frequency === 'annually') {
            const todayTargetValue = dayOfYear * (item.target[0].value / daysInYear);
            const percentage = (item.achieved_value/todayTargetValue) * 100;
            sendAlert({ percentage, thresholdValue, todayTargetValue }, item);
        }
    }
    /* Find KPI node's which is lapsed, send it to node_alert table */
    // running once at 04:00 EDT & 08:00 UTC & 13:30 IST
    cron.schedule('30 13 * * *', async() => {
        try {
            let todayDate = moment().tz("Asia/Kolkata").toDate();
            todayDate= moment(todayDate).format("YYYY-MM-DD[T]" + "00:00:00");
            const previousDate = moment(todayDate).subtract(1, 'days').format("YYYY-MM-DD[T]" + "00:00:00");
    
            // FIND THE KPI NODES WHOSE ALERT_TYPE OR ALERT_FREQUENCY IS BLANK
            const onlyNotificationQuery = {
                "target.0.value": { gt: 0 },
                "contributorId": { exists: true },
                "is_deleted": false,
                "due_date": { gte: previousDate, lt: todayDate },
                "notifyUserId": { exists: true },
                "is_achieved_modified": false,
                or: [ { "alert_frequency": "" }, { "alert_type": "" } ]
            }
            const onlyNotificationNodes = await app.models.KartaNode.find({ where: onlyNotificationQuery, include: models });
            
            if (onlyNotificationNodes.length > 0) {
                console.log(`==========>>>>> ${onlyNotificationNodes.length} KPI Nodes (Only Notification) found at ${new Date()}`);
                // Prepare notification collection data
                let notificationData = [];
                onlyNotificationNodes.forEach(item => {
                    notificationData.push({
                    title: `${item.contributor().fullName} has not completely fill the ${item.name}'s achieved value in ${item.karta_detail().name}`,
                    type: "kpi_node_alert",
                    contentId: item.kartaDetailId,
                    userId: item.notifyUserId
                    });
                });
                await app.models.notification.create(notificationData);
            }
    
            // FIND THE KPI NODES WHOSE ALERT_TYPE AND ALERT_FREQUENCY IS EXIST
            const notificationQuery = {
                "start_date": { lt: todayDate },
                "contributorId": { exists: true },
                "is_deleted": false,
                // "is_achieved_modified": true,
                "alert_frequency": { exists: true, neq: "" }
            }
            const notificationNodes = await app.models.KartaNode.find({ where: notificationQuery, include: models });
    
            if (notificationNodes.length > 0) {
                console.log(`==========>>>>> ${notificationNodes.length} KPI Nodes (Notification) found at ${new Date()}`);
    
                notificationNodes.forEach(async item => {
                    let startDate = item["start_date"];
                    if (item.hasOwnProperty("last_alert_sent_on")) {
                        startDate = item["last_alert_sent_on"];
                    }
                    const difference = getDifference(startDate, moment());
                    
                    switch (item["alert_frequency"]) {
                        case "monthly":
                            if (difference >= daysInMonth) checkTargetFrequency(item);
                            break;
                        case "quarterly":
                            if (difference >= 90) checkTargetFrequency(item);
                            break;
                        case "yearly":
                            if (difference >= daysInYear) checkTargetFrequency(item);
                            break;
                    }
                });
            }
        } catch (err) {
            console.log(`==========>>>>> IN FINDING THE LAPSED KPI NODES CRON (${new Date()}) = Someting went wrong `, err);
        }
    },
    {
        timezone: "Asia/Kolkata"
    });
}