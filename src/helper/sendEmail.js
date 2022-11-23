'use strict';

const ejs = require('ejs');
const path = require('path');


exports.sendEmail = (app, params, callback) => {
    ejs.renderFile(path.resolve(`templates/${params.template}`),
    { data: params }, {}, (err, html) => {
        if (err) {
            console.log(`=> error while preparing mail body `, err);
            return callback({ success: false, message: "Error while preparing mail" });
        }
        app.models.Email.send({
            to: params.email,
            from: app.dataSources.email.settings.transports[0].auth.user,
            subject: `${params.subject} | ${app.get('name')}`,
            html
        }, function(err) {
            console.log(`=> sending ${params.subject.toLowerCase()} email to:`, params.email);
            if (err) {
                console.log(`=> error while sending ${params.subject.toLowerCase()} email `, err);
                return callback({ success: false, message: "Error while sending mail" });
            }
            console.log(`=> Mail sent: `, params.email);
            return callback({ success: true, message: "Mail sent" });
        });
    });
}