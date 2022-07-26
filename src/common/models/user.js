/* eslint-disable max-len */
'use strict';

const fs = require("fs");
const path = require('path');
const keygen = require('keygenerator');
const generator = require('generate-password');
const ejs = require('ejs');
const { RoleManager } = require('../../helper');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const moment = require('moment');

module.exports = function(User) {
  // Send SMS
  const sendSMS = (user, mobileVerificationCode) => {
    try {
      let smsOptions = {
        type: 'sms',
        to: user.mobile.e164Number,
        from: "+16063667831",
        body: `${mobileVerificationCode} is your code for KPI Karta mobile verification.`
      };
      User.app.models.Twilio.send(smsOptions, (err, data) => {
        console.log('> sending code to mobile number:', user.mobile.e164Number);
        if (err) console.log('> error while sending code to mobile number', err);
      });
    } catch (error) {
      console.error("> error in SMS function", error);
    }
  }

  // QUERY VARIABLES
  const ROLE_LOOKUP = (roleId) => {
    return {
      $lookup: {
        from: "RoleMapping",
        let: {
          user_id: "$_id"
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$principalId", "$$user_id"] },
                  { $eq: ["$roleId", roleId] }
                ]
              }
            }
          }
        ],
        as: "role"
      }
    }
  }
  const UNWIND_ROLE = {
    $unwind: {
      path: "$role"
    }
  }



/* =============================CUSTOM METHODS=========================================================== */
  // Get all user count
  User.getCount = function(next) {
    User.app.models.Role.findOne({ where: {"name": "user"} }, (err, role) => {
      User.getDataSource().connector.connect(function(err, db) {
        const userCollection = db.collection('user');
        userCollection.aggregate([
          ROLE_LOOKUP(role.id),
          UNWIND_ROLE
        ]).toArray((err, result) => {
          next(err, result.length);
        });
      });
    });
  };
  // Get all users
  User.getAll = (page, limit, search_query, start, end, next) => {
    page = parseInt(page, 10) || 1;
    limit = parseInt(limit, 10) || 100;

    let searchQuery = search_query ? search_query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : "";
    let query = {};

    if (start && end) {
      query.createdAt = {
          $gte: moment(start).toDate(),
          $lte: moment(end).toDate()
      }
    }

    const SEARCH_MATCH = {
      $match: {
        $or: [
          {
            'fullName': {
              $regex: searchQuery,
              $options: 'i'
            }
          },
          {
            'email': {
              $regex: searchQuery,
              $options: 'i'
            }
          },
          {
            'mobile.internationalNumber': {
              $regex: searchQuery,
              $options: 'i'
            }
          }
        ]
      }
    }
    // Find user role
    User.app.models.Role.findOne({ where: {"name": "user"} }, (err, role) => {
      User.getDataSource().connector.connect(function(err, db) {
        const userCollection = db.collection('user');
        userCollection.aggregate([
          { 
            $match: query
          },
          {
            $sort: { "createdAt": -1 }
          },
          ROLE_LOOKUP(role.id),
          UNWIND_ROLE,
          SEARCH_MATCH,
          {
            $facet: {
              metadata: [{ $count: "total" }, { $addFields: { 'page': page } }],
              data: [{ $skip: (limit * page) - limit }, { $limit: limit }]
            }
          }
        ]).toArray((err, result) => {
          result[0].data.length > 0 ? result[0].metadata[0].count = result[0].data.length : 0;
          next(err, result);
        });
      });
    });
  };

  function forgotWithRole(email, next, role) {
    User.findOne({ where: {email}, include: 'roles' }, (err, user) => {
      if (err) return next(err);
      let isValidRole = user.roles().map(r => r.name).indexOf(role) > -1;
      if (isValidRole) {
        User.resetPassword({email}, next);
      } else {
        let error = new Error("You are not allowed to Reset Password here");
        error.status = 400;
        next(error);
      };
    });
  }
  User.forgotPasswordAdmin = (email, next)=>{
    forgotWithRole(email, next, 'admin');
  };

  User.forgotPasswordUser = (email, next) => {
    forgotWithRole(email, next, 'user');
  };

  function loginWithRole(email, password, next, role) {
    User.login({ email, password }, 'user', (err, token) => {
      if (err) return next(err);
      token.user((_e, user)=>{
        user.roles((e, roles)=>{
          roles = roles.map(r=>r.name);
          if (roles.indexOf(role) > -1) {
            next(null, token);
          } else {
            let error = new Error("You are not allowed to login here");
            error.status = 400;
            next(error);
          }
        });
      });
    });
  };

  User.adminLogin = (email, password, next) => {
    loginWithRole(email, password, next, 'admin');
  };

  User.userLogin = (email, password, next) => {
    loginWithRole(email, password, next, 'user');
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
          if (err) {
            console.log('> error while sending verification code email', err);
            return next(err);
          }
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
          if (err) {
            console.log('> error while sending code to mobile number', err);
            let error = err;
            error.status = 500;
            return next(error);
          }
          next(null, 'sent');
        });
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
  User.enableMFA = function(code, next) {
    if (this.app.currentUser.mfaEnabled) {
      let error = new Error("MFA is already configured for this account");
      error.status = 400;
      return next(error);
    }
    var verified = speakeasy.totp.verify({
      secret: this.app.currentUser.mfaSecret,
      encoding: 'base32',
      code
    });
    if (verified) {
      this.app.currentUser.updateAttribute( { "mfaVerified": true, "mfaEnabled": true }, (err)=>{
        next(null, verified);
      });
    } else {
      let error = new Error("Invalid Code");
      error.status = 400;
      return next(error);
    }
  };  
  // Verify MFA code (Used while login)
  User.verifyMFACode = function(token, next) {
    if (!this.app.currentUser.mfaEnabled) {
      let error = new Error("Multi factor authentication is disabled. Please enable it first");
      error.status = 400;
      return next(error);
    }
    var verified = speakeasy.totp.verify({
      secret: this.app.currentUser.mfaSecret,
      encoding: 'base32',
      token
    });
    if (verified) next(null, verified);
    else {
      let error = new Error("Invalid Code");
      error.status = 400;
      return next(error);
    }
  };
  // Reset MFA
  User.resetMFAConfig = function(next) {
    this.app.currentUser.updateAttributes({ "mfaSecret": "", "mfaQRCode": "", "mfaVerified": false, "mfaEnabled": false }, (err)=>{
      next(err, true);
    });
  };
  // Check MFA config
  User.checkMFAConfig = function(next) {
    let mfa = {
      secret: this.app.currentUser.mfaSecret,
      qrCode: this.app.currentUser.mfaQRCode,
      verified: this.app.currentUser.mfaVerified,
      enabled: this.app.currentUser.mfaEnabled
    };
    next(null, mfa);
  };
  // Enable/Disable MFA
  User.toggleMFA = function(type, next) {

    if (type && this.app.currentUser.mfaQRCode && this.app.currentUser.mfaSecret && this.app.currentUser.mfaVerified) {
      this.app.currentUser.updateAttributes({ "mfaEnabled": type }, (err)=>{
        next(err, type);
      });
    } else if (!type) {
      this.app.currentUser.updateAttributes({ "mfaEnabled": type }, (err)=>{
        next(err, type);
      });
    } else {
      let error = new Error("You cannot enable MFA, before setup");
      error.status = 400;
      next(error);
    }
  };

  // Block user
  User.blockUser = function(userId, next) {
    User.updateAll({ "_id": userId }, { "active" : false }, (err)=>{
      next(err, true);
    });
  };

  // Unblock user
  User.unblockUser = function(userId, next) {
    User.updateAll({ "_id": userId }, { "active" : true }, (err)=>{
      next(err, true);
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
        if (err) return console.log('> error while sending password reset email', err);
      });
    });
  });

  User.afterRemote('create', (context, user, next) => {
    // Find role
    User.app.models.Role.findOne({ where:{ "name": "user" } }, (err, role) => {
      if (err) {
        console.log('> error while finding role', err);
        return next(err);
      }
      // Assign role
      RoleManager.assignRoles(User.app, [role.id], user.id, () => {
        // Set company name
        User.app.models.company.create({ "name": context.req.body.companyName, "userId": user.id }, {}, err => {
          if (err) {
            console.log('> error while creating company', err);
            return next(err);
          }
        });
        // Create token
        user.accessTokens.create((err, token) => {
          user.__data.token = token;
          if (err) {
            console.log('> error while creating access token', err);
            return next(err);
          }
          next();
        });

        // Generate verification code and update in db
        let emailVerificationCode = keygen.number({length: 6});
        let mobileVerificationCode = keygen.number({length: 6});
        user.updateAttributes({ emailVerificationCode, mobileVerificationCode }, {}, err => {
          if (err) {
            console.log('> error while update attributes', err);
            return next(err);
          }
          let emailOptions = {
            name: User.app.get('name'),
            type: 'email',
            to: user.email,
            from: User.app.dataSources.email.settings.transports[0].auth.user,
            subject: process.env.TEMPLATE_SIGNUP_SUBJECT,
            template: path.resolve(__dirname, '../../templates/signup.ejs'),
            user,
            emailVerificationCode
          };
          // Send email
          user.verify(emailOptions, function(err, response) {
            console.log('> sending email to: ', user.email);
            if (err) console.log('> error while sending code to email', user.email);
          });
          // Send sms
          sendSMS(user, mobileVerificationCode);
        });
      });
    });
  });


  User.afterRemote('userLogin', (context, accessToken, next) => {
    if (accessToken && accessToken.user) {
      // Find user by access token
      User.findById(accessToken.userId.toString(), (err, user) => {
        // If email is not verified
        if (!user.emailVerified) {
          var emailVerificationCode = keygen.number({length: 6});
          user.updateAttributes({ emailVerificationCode }, {}, err => {
            ejs.renderFile(path.resolve('templates/send-verification-code.ejs'),
            { user, emailVerificationCode }, {}, (err, html) => {
              User.app.models.Email.send({
                to: user.email,
                from: User.app.dataSources.email.settings.transports[0].auth.user,
                subject: `Verfication Code | ${User.app.get('name')}`,
                html
              }, (err) => {
                console.log('> sending verification code email to:', user.email);
                if (err) {
                  console.log('> error while sending verification code email', err);
                  return next(err);
                }
                next();
              });
            });
          });
        } else {
          // User is verified, checking for mfa enabled or not
          if (!user.mfaEnabled && user.mobileVerified) {
            let mobileVerificationCode = keygen.number({length: 6});
            user.updateAttributes({ mobileVerificationCode }, {}, err => {
              sendSMS(user, mobileVerificationCode);
            });
          }
          // Get company name
          user.company((err, company) => {
            if (err) {
              console.log('> error while fetching company details', err);
              return next(err);
            }
            context.result.companyLogo = company.__data.logo ? company.__data.logo : "";
            next();
          });
        }
      });
    } else next();
  });

  User.afterRemote('prototype.patchAttributes', function(context, userInstance, next) {
    const user = User.app.currentUser;
    const req = context.req;

    if (req.body.type == "social_user") {
      User.app.models.Role.findOne({ where:{ "name": "user" } }, (err, role) => {
        RoleManager.assignRoles(User.app, [role.id], user.id, () => {
          // Set company name
          User.app.models.company.create({ "name": req.body.companyName, "userId": user.id }, {}, err => {
            if (err) {
              console.log('> error while creating company data', err);
              return next(err);
            }
          });
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
                  if (err) {
                    console.log('> error while sending welcome email to social user', err);
                    return next(err);
                  }
                });
              });
            }
            // Create access token
            user.accessTokens.create((err, token) => {
              userInstance.__data.accessToken = token.id;
              next();
            });
          });
        });
      });
    } else {
      if (req.body.oldImage) {
        fs.unlink(path.resolve('storage/user/', req.body.oldImage), (err) => { console.log(err) });
      }
      next();
    }
  });
};
