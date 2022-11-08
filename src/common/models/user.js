/* eslint-disable max-len */
'use strict';

const fs = require("fs");
const path = require('path');
const keygen = require('keygenerator');
const generator = require('generate-password');
const ejs = require('ejs');
const { RoleManager } = require('../../helper');
const moment = require('moment');

module.exports = function(User) {
  // Send SMS
  const sendSMS = (user, message) => {
    try {
      let smsOptions = {
        type: 'sms',
        to: user.mobile.e164Number,
        from: "+16063667831",
        body: message
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
  const ROLE_MAP_LOOKUP = (roleId) => {
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
                  { $ne: ["$roleId", roleId] }
                ]
              }
            }
          }
        ],
        as: "RoleMap"
      }
    }
  }
  const UNWIND_ROLE_MAP = {
    $unwind: {
      path: "$RoleMap"
    }
  }
  // Role lookup
  const ROLE_LOOKUP = {
    $lookup: {
      from: 'Role',
      localField: 'roleId',
      foreignField: '_id',
      as: 'Role'
    },
  }
  const UNWIND_ROLE = {
    $unwind: {
      path: "$Role"
    }
  }
  // License lookup
  const LICENSE_LOOKUP = {
    $lookup: {
      from: 'license',
      localField: 'licenseId',
      foreignField: '_id',
      as: 'license'
    },
  }
  const UNWIND_LICENSE = {
    $unwind: {
      path: "$license"
    }
  }
  // Department lookup
  const DEPARTMENT_LOOKUP = {
    $lookup: {
      from: 'department',
      localField: 'departmentId',
      foreignField: '_id',
      as: 'department'
    },
  }
  const UNWIND_DEPARTMENT = {
    $unwind: {
      path: "$department",
      preserveNullAndEmptyArrays: true
    }
  }



/* =============================CUSTOM METHODS=========================================================== */

  // Add admin user
  User.addAdmin = (fullName, email, password, next) => {
    User.create({ fullName, email, password }, {}, (err, user) => {
      if (err) {
        console.log('> error while creating admin', err);
        return next(err);
      }
      // Find role
      User.app.models.Role.findOne({ where:{ "name": "admin" } }, (err, role) => {
        if (err) {
          console.log('> error while finding role', err);
          return next(err);
        }
        // Assign role
        RoleManager.assignRoles(User.app, [role.id], user.id, () => {
          if (err) {
            console.log('> error while assigning role', err);
            return next(err);
          }
          next();
        });
      });
    });
  }

  // Add user via invite member
  User.inviteMember = (data, next) => {
    const { fullName, email, mobile, roleId, licenseId, departmentId, creatorId } = data;

    const password = generator.generate({
      length: 8,
      numbers: true,
      symbols: true,
      strict: true
    });
    
    // Create user
    User.create({ fullName, email, password, mobile, roleId, licenseId, departmentId, creatorId, addedBy: "creator" }, {}, (err, user) => {
      if (err) {
        console.log('> error while creating user', err);
        return next(err);
      } else {
        RoleManager.assignRoles(User.app, [roleId], user.id, () => {
          // Find creator's company id and assign it to the new user
          User.findById(creatorId, (err, creator) => {
            if (err) {
              console.log('> error while getting creator data', err);
              return next(err);
            }
            User.update({ "_id": user.id },  { "companyId": creator.companyId }, err => {
              if (err) {
                console.log('> error while updating user', err);
                return next(err);
              } else {
                next(null, "User invited successfully!");
                // Send email and password to user
                user.updateAttributes({ password }, {}, err => {
                  ejs.renderFile(path.resolve('templates/welcome.ejs'),
                    { user, name: User.app.get('name'), loginUrl: `${process.env.WEB_URL}/login`, password }, {}, function(err, html) {
                      User.app.models.Email.send({
                        to: user.email,
                        from: User.app.dataSources.email.settings.transports[0].auth.user,
                        subject: `Welcome to | ${User.app.get('name')}`,
                        html
                      }, function(err) {
                        console.log('> sending welcome email to invited user:', user.email);
                        if (err) {
                          console.log('> error while sending welcome email to invited user', err);
                        }
                      });
                  });
                });
              }
            });
          });
        });
      }
    });
  }

  // Send credentials
  User.sendCredentials = (userId, next) => {

    const password = generator.generate({
      length: 8,
      numbers: true,
      symbols: true,
      strict: true
    });
    
    // Update new password
    User.findOne({ where: { "_id": userId } }, (err, user) => {
      if (err) {
        console.log('> error while finding user', err);
        return next(err);
      } else {
        user.updateAttributes({ password }, {}, (err) => {
          if (err) {
            console.log('> error while updating new credentials', err);
            return next(err);
          } else {
            next(null, "Credentials sent successully!");
            // Send email and password to user
            ejs.renderFile(path.resolve('templates/credential.ejs'),
                { user, name: User.app.get('name'), password }, {}, function(err, html) {
                  User.app.models.Email.send({
                    to: user.email,
                    from: User.app.dataSources.email.settings.transports[0].auth.user,
                    subject: `New Credentials | ${User.app.get('name')}`,
                    html
                  }, function(err) {
                    console.log('> sending credentials email to user:', user.email);
                    if (err) {
                      console.log('> error while sending credentials email to user', err);
                    }
                  });
              });
          }
        });
      }
    });
  }

  // Get all members by company id
  User.getAllMembers = (userId, type, page, limit, searchQuery, start, end, next) => {
    page = parseInt(page, 10) || 1;
    limit = parseInt(limit, 10) || 100;

    User.findById(userId, (err, user) => {
      if (err) return next(err);
      else {
        searchQuery = searchQuery ? searchQuery.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : "";
        userId = User.getDataSource().ObjectID(userId);
        
        let query = {};
        if (type === "all") query = { "companyId": user.companyId }
        else query = { "companyId": user.companyId, "_id": { $ne: userId } };

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
        User.getDataSource().connector.connect(function(err, db) {
          const userCollection = db.collection('user');
          userCollection.aggregate([
            { 
              $match: query
            },
            {
              $sort: { "createdAt": -1 }
            },
            LICENSE_LOOKUP,
            UNWIND_LICENSE,
            ROLE_LOOKUP,
            UNWIND_ROLE,
            DEPARTMENT_LOOKUP,
            UNWIND_DEPARTMENT,
            SEARCH_MATCH,
            {
              $facet: {
                metadata: [{ $count: "total" }, { $addFields: { 'page': page } }],
                data: [{ $skip: (limit * page) - limit }, { $limit: limit }]
              }
            }
          ]).toArray((err, result) => {
            if (result) result[0].data.length > 0 ? result[0].metadata[0].count = result[0].data.length : 0;
            next(err, result);
          });
        });
      }
    });
  };

  // Get all user count
  User.getCount = function(next) {
    User.app.models.Role.findOne({ where: { "name": "admin" } }, (err, role) => {
      User.getDataSource().connector.connect(function(err, db) {
        const userCollection = db.collection('user');
        userCollection.aggregate([
          ROLE_MAP_LOOKUP(role.id),
          UNWIND_ROLE_MAP
        ]).toArray((err, result) => {
          next(err, result.length);
        });
      });
    });
  };
  // Get all users
  User.getAll = (page, limit, searchQuery, start, end, next) => {
    page = parseInt(page, 10) || 1;
    limit = parseInt(limit, 10) || 100;

    searchQuery = searchQuery ? searchQuery.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : "";
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
    User.app.models.Role.findOne({ where: {"name": "admin"} }, (err, role) => {
      User.getDataSource().connector.connect(function(err, db) {
        const userCollection = db.collection('user');
        userCollection.aggregate([
          { 
            $match: query
          },
          {
            $sort: { "createdAt": -1 }
          },
          ROLE_MAP_LOOKUP(role.id),
          UNWIND_ROLE_MAP,
          ROLE_LOOKUP,
          UNWIND_ROLE,
          LICENSE_LOOKUP,
          UNWIND_LICENSE,
          SEARCH_MATCH,
          {
            $facet: {
              metadata: [{ $count: "total" }, { $addFields: { 'page': page } }],
              data: [{ $skip: (limit * page) - limit }, { $limit: limit }]
            }
          }
        ]).toArray((err, result) => {
          if (result) result[0].data.length > 0 ? result[0].metadata[0].count = result[0].data.length : 0;
          next(err, result);
        });
      });
    });
  };

  function forgotWithRole(email, next, role) {
    User.findOne({ where: {email}, include: 'roles' }, (err, user) => {
      if (err) return next(err);
      if (user) {
        user.roles((e, roles) => {
          roles = roles.map(r => r.name);
          if (roles.indexOf(role) > -1) {
            User.resetPassword({email}, next);
          } else if (role === 'not_admin' && roles[0] !== 'admin') {
            User.resetPassword({email}, next);
          } else {
            let error = new Error("You are not allowed to reset password here");
            error.status = 400;
            next(error);
          }
        });
      } else {
        let error = new Error("User does not exists");
        error.status = 400;
        next(error);
      }
    });
  }
  User.forgotPasswordAdmin = (email, next)=>{
    forgotWithRole(email, next, 'admin');
  };

  User.forgotPasswordUser = (email, next) => {
    forgotWithRole(email, next, 'not_admin');
  };

  function loginWithRole(email, password, next, role) {
    User.login({ email, password }, 'user', (err, token) => {
      if (err) return next(err);
      token.user((_e, user) => {
        user.roles((e, roles) => {
          roles = roles.map(r => r.name);
          if (roles.indexOf(role) > -1) {
            next(null, token);
          } else if (role === 'not_admin' && roles[0] !== 'admin') {
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
    loginWithRole(email, password, next, 'not_admin');
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
  // Check 2FA config
  User.check2FAConfig = function(next) {
    let data = {
      mobile: this.app.currentUser.mobile,
      _2faEnabled: this.app.currentUser._2faEnabled,
      mobileVerified: this.app.currentUser.mobileVerified
    };
    next(null, data);
  };
  // Enable/Disable 2FA
  User.toggle2FA = function(type, next) {

    if (type && this.app.currentUser.mobile && this.app.currentUser.mobileVerified) {
      this.app.currentUser.updateAttributes({ "_2faEnabled": type }, (err)=>{
        next(err, type);
      });
    } else if (!type) {
      this.app.currentUser.updateAttributes({ "_2faEnabled": type }, (err)=>{
        next(err, type);
      });
    } else {
      let error = new Error("You cannot enable Two Factor Authorization, before mobile verification");
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

  // Get Roles
  User.getRoles = function(next) {
    User.app.models.Role.find({}, (err, roles) => {
      if (err) {
        console.log('> error while getting roles', err);
        return next(err);
      }

      let allRoles = roles.filter(x => x.name !== 'admin');
      return next(null, allRoles);
    });
  }

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
    const req = context.req;
    // Find role
    User.app.models.Role.findOne({ where:{ "name": "company_admin" } }, (err, role) => {
      if (err) {
        console.log('> error while finding role', err);
        return next(err);
      }
      // Assign role
      RoleManager.assignRoles(User.app, [role.id], user.id, () => {
        // Create company
        User.app.models.company.create({ "name": req.body.companyName, "userId": user.id }, {}, (err, company) => {
          if (err) {
            console.log('> error while creating company', err);
            return next(err);
          }
          // Find license
          User.app.models.License.findOne({ where: { "name": "Creator" } }, (err, license) => {
            if (err) {
              console.log('> error while finding license', err);
              return next(err);
            }
            // Assign roleId, licenseId and companyId
            User.update({ "_id": user.id },  { "companyId": company.id, "roleId": role.id, "licenseId": license.id }, err => {
              if (err) {
                console.log('> error while updating user', err);
                return next(err);
              } 
            });
          });
        });
        // Create token
        user.accessTokens.create((err, token) => {
          // user.__data.token = token;
          if (err) {
            console.log('> error while creating access token', err);
            return next(err);
          }
          let data = {
            token,
            id: user.id,
            fullName: user.fullName,
            email: user.email,
            cardId: ""  // temp card id
          }
          context.result = data;
          next();
        });

        // Send email and password to new users
        if (req.body.addedBy == "admin") {
          let password = generator.generate({
            length: 8,
            numbers: true,
            symbols: true,
            strict: true
          });
          user.updateAttributes({ password }, {}, err => {
            ejs.renderFile(path.resolve('templates/welcome.ejs'),
              { user, name: req.app.get('name'), loginUrl: `${process.env.WEB_URL}/login`, password }, {}, function(err, html) {
                User.app.models.Email.send({
                  to: user.email,
                  from: User.app.dataSources.email.settings.transports[0].auth.user,
                  subject: `Welcome to | ${req.app.get('name')}`,
                  html
                }, function(err) {
                  console.log('> sending welcome email to admin side user:', user.email);
                  if (err) {
                    console.log('> error while sending welcome email to admin side user', err);
                  }
                });
            });
          });
        } else {
          // Generate verification code and update in db
          let emailVerificationCode = keygen.number({length: 6});
          user.updateAttributes({ emailVerificationCode }, {}, err => {
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
          });
        }
      });
    });
  });

  User.afterRemote('userLogin', (context, accessToken, next) => {
    if (accessToken && accessToken.user) {
      // Find user by access token
      User.findById(accessToken.userId.toString(), (err, user) => {
        // Check if user is active or not
        if (!user.active) {
          let error = new Error("Your account has been deactivated or deleted by the admin, please connect admin at info@kpikarta.com for more details.");
          error.status = 400;
          next(error);
        }
        // If email is not verified
        else if (!user.emailVerified) {
          next();
          let emailVerificationCode = keygen.number({ length: 6 });
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
              });
            });
          });
        }
        // User is verified, checking for twoFactor enabled or not
        else {
          if (user.mobile && user._2faEnabled && user.mobileVerified) {
            let mobileVerificationCode = keygen.number({length: 6});
            user.updateAttributes({ mobileVerificationCode }, {}, err => {
              sendSMS(user, `${mobileVerificationCode} is your code for KPI Karta Login.`);
            });
          }
          // Get company details
          User.app.models.company.findById(user.companyId.toString(), (err, company) => {
            if (err) {
              console.log('> error while fetching company details', err);
              return next(err);
            }
            context.result.company = company;
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
      User.app.models.Role.findOne({ where:{ "name": "company_admin" } }, (err, role) => {
        RoleManager.assignRoles(User.app, [role.id], user.id, () => {
          // Create company and assign it's id to the user
          User.app.models.company.create({ "name": req.body.companyName, "userId": user.id }, {}, (err, company) => {
            if (err) {
              console.log('> error while creating company', err);
              return next(err);
            }
            User.update({ "_id": user.id},  { "companyId": company.id}, err => {
              if (err) {
                console.log('> error while updating user', err);
                return next(err);
              } 
            });
          });
          // Send welcome email to social users
          let password = generator.generate({
            length: 8,
            numbers: true,
            symbols: true,
            strict: true
          });
          user.updateAttributes({ password }, {}, (err) => {
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
    } else if (req.body.type === "invited_user") {
      let updatedUserId = User.getDataSource().ObjectID(req.body.userId);
      RoleManager.assignRoles(User.app, [req.body.roleId], updatedUserId, () => {
        next();
      });
    } else {
      if (req.body.oldImage) {
        fs.unlink(path.resolve('storage/user/', req.body.oldImage), (err) => { console.log(err) });
      }
      next();
    }
  });
};
