// const fs = require("fs");
// const path = require('path');
// const keygen = require('keygenerator');
// const generator = require('generate-password');
// const ejs = require('ejs');
// const { RoleManager } = require('../../helper');
// const speakeasy = require('speakeasy');
// const QRCode = require('qrcode');
// const moment = require('moment');

// exports.sendMail = (params, callback) => {
//     ejs.renderFile(path.resolve(`templates/${params.template}`),
//     { params.data }, {}, (err, html) => {

//     }
// }
// ejs.renderFile(path.resolve('templates/send-verification-code.ejs'),
//       {user: User.app.currentUser, emailVerificationCode}, {}, function(err, html) {
//         User.app.models.Email.send({
//           to: User.app.currentUser.email,
//           from: User.app.dataSources.email.settings.transports[0].auth.user,
//           subject: `Verfication Code | ${User.app.get('name')}`,
//           html
//         }, function(err) {
//           console.log('> sending verification code email to:', User.app.currentUser.email);
//           if (err) {
//             console.log('> error while sending verification code email', err);
//             return next(err);
//           }
//           next(null, 'success');
//         });
//       });