/* eslint-disable max-len */
'use strict';

const path = require('path');
const keygen = require('keygenerator');
const generator = require('generate-password');
const ejs = require('ejs');
const RoleManager = require('../../helper').RoleManager;
const speakeasy = require('speakeasy');
var QRCode = require('qrcode');

module.exports = function(User) {
/* =============================CUSTOM METHODS=========================================================== */

  User.findUsersExceptAdmin = (next)=>{
    User.find({include: 'roles'}, (err, users)=>{
      users = users.filter(user=>{
        return user.roles().map(r=>r.name).indexOf('admin') == -1;
      });
      next(err, users);
    });
  };

  User.forgotPasswordAdmin = (email, next)=>{
    User.findOne({where: {email}, include: 'roles'}, (err, user)=>{
      var isAdmin = user.roles().map(r=>r.name).indexOf('admin') > -1;
      if (isAdmin) {
        User.resetPassword({email}, next);
      } else {
        next(null, err ? err.message : 'You are not an administrator');
      };
    });
  };

  User.adminLogin = (email, password, next)=>{
    User.login({email, password}, 'user', (err, token)=>{
      if (err) return next(err);
      token.user((_e, user)=>{
        user.roles((e, roles)=>{
          roles = roles.map(r=>r.name);
          if (roles.indexOf('admin') > -1) {
            next(null, token);
          } else next(new Error('Only admins are allowed to login'));
        });
      });
    });
  };

  User.verifyEmail = function(otp, next) {
    var otpVerified = this.app.currentUser.emailVerificationCode == otp;
    if (otpVerified) {
      this.app.currentUser.updateAttributes({emailVerified: true, emailVerificationCode: ''}, (err)=>{
        next(err, this.app.currentUser);
      });
    } else {
      let error = new Error("Invalid Code");
      error.status = 400;
      next(error);
    }
  };
// Send email code
  User.sendEmailCode = function(next) {
    var emailVerificationCode = keygen.number({length: 6});
    this.app.currentUser.updateAttributes({emailVerificationCode}, {}, err => {
      ejs.renderFile(path.resolve('templates/send-verification-code.ejs'),
      {user: User.app.currentUser, emailVerificationCode}, {}, function(err, html) {
        User.app.models.Email.send({
          to: User.app.currentUser.email,
          from: User.app.dataSources.email.settings.transports[0].auth.user,
          subject: `Verfication Code | ${User.app.get('name')}`,
          html
        }, function(err) {
          console.log('> sending verification code email to:', User.app.currentUser.email);
          if (err) return console.log('> error while sending verification code email');
          next(null, 'success');
        });
      });
    });
  };
// Verify mobile
  User.verifyMobile = function(code, mobile, next) {
    let codeVerified = this.app.currentUser.mobileVerificationCode == code;
    if (codeVerified) {
      let query;
      if (mobile) query = { mobile, mobileVerified: true, mobileVerificationCode: '' }
      else query = { mobileVerified: true, mobileVerificationCode: '' }

      this.app.currentUser.updateAttributes(query, (err)=>{
        next(null, true);
      });
    } else {
      let error = new Error("Invalid Code");
      error.status = 400;
      next(error);
    }
  };
// Send mobile code
  User.sendMobileCode = function(type, mobile, next) {
    let mobileVerificationCode = keygen.number({length: 6});
    this.app.currentUser.updateAttributes({mobileVerificationCode}, {}, err => {
      if (err) return next(err);
      else {
        let mobileNumber;
        if (type == "updateProfile") mobileNumber = mobile.e164Number;
        else mobileNumber = User.app.currentUser.mobile.e164Number;
        let twilio_data = {
          type: 'sms',
          to: mobileNumber,
          from: "+16063667831",
          body: `${mobileVerificationCode} is your code for KPI Karta mobile verification.`
        }
        User.app.models.Twilio.send(twilio_data, function (err, data) {
          console.log('> sending code to mobile number:', mobileNumber);
          if (err) return console.log('> error while sending code to mobile number');
          next(null, 'sent');
        });
        // next(null, 'sent');
      }
    });
  };
// Assign plan
  User.selectPlan = function(plan, next) {
    this.app.currentUser.updateAttributes({currentPlan: plan}, (err)=>{
      next(err, this.app.currentUser);
    });
  };
// Generate MFA Qr code
  User.generateMFAQRCode = function(next) {
    if (this.app.currentUser.mfaQRCode) {
      return next(null, this.app.currentUser.mfaQRCode);
    }
    var secret = speakeasy.generateSecret({length: 6, name: this.app.get('name') + ' | ' + this.app.currentUser.fullName});
    QRCode.toDataURL(secret.otpauth_url, function(err, mfaQRCode) {
      User.app.currentUser.updateAttributes({ "mfaSecret": secret.base32, mfaQRCode }, (err)=>{
        next(err, mfaQRCode);
      });
    });
  };
// Enable MFA
  User.enableMFA = function(token, next) {
    if (this.app.currentUser.mfaEnabled) {
      let error = new Error("MFA is already configured for this account");
      error.status = 400;
      return next(error);
    }
    var verified = speakeasy.totp.verify({
      secret: this.app.currentUser.mfaSecret,
      encoding: 'base32',
      token
    });
    if (verified) {
      this.app.currentUser.updateAttribute('mfaEnabled', true, (err)=>{
        next(null, verified);
      });
    } else {
      let error = new Error("Invalid Code");
      error.status = 400;
      return next(error);
    }
  };
// Verify MFA code
  User.verifyMFACode = function(token, next) {
    if (!this.app.currentUser.mfaEnabled) {
      let error = new Error("Multi factor authentication is disabled. Please enable it first");
      error.status = 400;
      return next(error);
    }
    next(null, speakeasy.totp.verify({
      secret: this.app.currentUser.mfaSecret,
      encoding: 'base32',
      token,
    }));
  };
// Reset MFA
  User.resetMFAConfig = function(next) {
    this.app.currentUser.updateAttributes({ "mfaSecret": "", "mfaQRCode": "", "mfaEnabled": false }, (err)=>{
      next(err, true);
    });
  };
// Enable/Disable MFA
  User.checkMFAEnabled = function(next) {
    if (this.app.currentUser.mfaEnabled) next (null, true);
    else next(null, false);
  };
// Enable/Disable MFA
  User.toggleMFA = function(type, next) {
    this.app.currentUser.updateAttributes({ "mfaEnabled": type }, (err)=>{
      next(err, type);
    });
  };

/* =============================REMOTE HOOKS=========================================================== */
  User.on('resetPasswordRequest', function(info) {
    var resetLink = `${process.env.WEB_URL}/reset-password?access_token=${info.accessToken.id}`;
    ejs.renderFile(path.resolve('templates/forgot-password.ejs'),
    { fullName: info.user.fullName, resetLink }, {}, function(err, html) {
      User.app.models.Email.send({
        to: info.email,
        from: User.app.dataSources.email.settings.transports[0].auth.user,
        subject: 'Reset your password | ' + User.app.get('name'),
        html
      }, function(err) {
        console.log('> sending password reset email to:', info.email);
        if (err) return console.log('> error while sending password reset email');
      });
    });
  });

  User.afterRemote('create', function(context, user, next) {
    RoleManager.assignRoles(User.app, ['user'], user.id, ()=>{
      let emailVerificationCode = keygen.number({length: 6});
      let mobileVerificationCode = keygen.number({length: 6});
      user.updateAttributes({ emailVerificationCode, mobileVerificationCode }, {}, err => {
        var options = {
          name: User.app.get('name'),
          type: 'email',
          to: user.email,
          from: User.app.dataSources.email.settings.transports[0].auth.user,
          subject: process.env.TEMPLATE_SIGNUP_SUBJECT,
          template: path.resolve(__dirname, '../../templates/signup.ejs'),
          user: user,
          emailVerificationCode
        };

        let twilio_data = {
          type: 'sms',
          to: user.mobile.e164Number,
          from: "+16063667831",
          body: `${mobileVerificationCode} is your code for KPI Karta mobile verification.`
        }

        User.app.models.company.create({ name: context.req.body.companyName, userId: user.id }, {}, err => {
          if (err) return console.log('> error while creating company data');
        });

        User.app.models.Twilio.send(twilio_data, function (err, data) {
          console.log('> sending code to mobile number:', user.mobile.e164Number);
          if (err) return console.log('> error while sending code to mobile number');
        });

        user.verify(options, function(err, response) {
          user.accessTokens.create((error, token)=>{
            delete user.__data.emailVerificationCode;
            delete user.__data.mobileVerificationCode;
            user.__data.token = token;
            if (err) {
              return next(err);
            }
            next();
          });
        });
      });
    });
  });

  User.afterRemote('login', function(context, accessToken, next) {
    if (accessToken && accessToken.user) {
      User.findById(accessToken.userId.toString(), ((err, user)=>{
        if (!user.emailVerified) {
          var emailVerificationCode = keygen.number({length: 6});
          user.updateAttributes({emailVerificationCode}, {}, err => {
            ejs.renderFile(path.resolve('templates/send-verification-code.ejs'),
            { user, emailVerificationCode }, {}, function(err, html) {
              User.app.models.Email.send({
                to: user.email,
                from: User.app.dataSources.email.settings.transports[0].auth.user,
                subject: `Verfication Code | ${User.app.get('name')}`,
                html
              }, function(err) {
                console.log('> sending verification code email to:', user.email);
                if (err) return console.log('> error while sending verification code email');
                next();
              });
            });
          });
        } else if (!user.emailVerified && !user.mobileVerified) {
          let mobileVerificationCode = keygen.number({length: 6});
          user.updateAttributes({mobileVerificationCode}, {}, err => {
            let twilio_data = {
              type: 'sms',
              to: user.mobile.e164Number,
              from: "+16063667831",
              body: `${mobileVerificationCode} is your code for KPI Karta mobile verification.`
            }
            User.app.models.Twilio.send(twilio_data, function (err, data) {
              console.log('> sending code to mobile number:', user.mobile.e164Number);
              if (err) return console.log('> error while sending code to mobile number');
              next();
            });
            // next();
          });
        } else {
          user.company((err, company) => {
            if (err) return console.log('> error while fetching company details');
            context.result.companyLogo = company.__data.logo ? company.__data.logo : "";
            next();
          });
        }
      }));
    } else next();
  });

  User.afterRemote('prototype.patchAttributes', function(context, userInstance, next) {
    const user = User.app.currentUser;
    const req = context.req;

    if (req.body.type == "social_user") {
      // Send welcome email to social users
      let password = generator.generate({
        length: 8,
        numbers: true,
        symbols: true,
        strict: true
      });
      user.updateAttributes({password}, {}, (err) => {
        if (!user.email.includes("facebook.com")) {
          ejs.renderFile(path.resolve('templates/welcome.ejs'),
          { user, name: req.app.get('name'), loginUrl: `${process.env.WEB_URL}/login`, password }, {}, function(err, html) {
            User.app.models.Email.send({
              to: user.email,
              from: User.app.dataSources.email.settings.transports[0].auth.user,
              subject: `Welcome to | ${req.app.get('name')}`,
              html
            }, function(err) {
              console.log('> sending welcome email to social user:', user.email);
              if (err) return console.log('> error while sending welcome email to social user');
            });
          });
        }
        user.accessTokens.create((err, token) => {
          userInstance.__data.accessToken = token.id;
          next();
        });
      });
    } else next();
  });
};
