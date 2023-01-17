/* eslint-disable max-len */
'use strict';

const fs = require("fs");
const path = require('path');
const keygen = require('keygenerator');
const generator = require('generate-password');
const { RoleManager } = require('../../helper');
const moment = require('moment');
const { sendEmail } = require("../../helper/sendEmail");

module.exports = function(User) {
  /* QUERY VARIABLES
  ----------------*/
  // Sort
  const SORT = {
    $sort: { createdAt: -1 }
  }
  // Find user who is not deleted
  const FIND_ONLY_NOT_DELETED_USERS = {
    $match: { $or: [ { "is_deleted" : { $exists: false } }, { "is_deleted" : false } ] }
  }
  // Role map lookup
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
  // Role map lookup for company admin
  const ROLE_MAP_LOOKUP_COMPANY_ADMIN = (roleId) => {
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
  // Company lookup
  const COMPANY_LOOKUP = {
    $lookup: {
      from: 'company',
      localField: 'companyId',
      foreignField: '_id',
      as: 'company'
    },
  }
  const UNWIND_COMPANY = {
    $unwind: {
      path: "$company"
    }
  }
  // Employee department lookup
  const EMPLOYEE_DEPARTMENT_LOOKUP = {
    $lookup: {
        from: "department",
        let: {
            department_id: "$company.departmentId"
        },
        pipeline: [
            {
                $match: {
                    $expr: {
                        $and: [
                            { $eq: ["$_id", "$$department_id"] }
                        ]
                    }
                }
            }
        ],
        as: "company.department"
    }
  }
  const UNWIND_EMPLOYEE_DEPARTMENT = {
    $unwind: {
      path: "$company.department",
      preserveNullAndEmptyArrays: true
    }
  }
  // Employee range lookup
  const EMPLOYEE_RANGE_LOOKUP = {
    $lookup: {
        from: "employee_range",
        let: {
            range_id: "$company.employeeRangeId"
        },
        pipeline: [
            {
                $match: {
                    $expr: {
                        $and: [
                            { $eq: ["$_id", "$$range_id"] }
                        ]
                    }
                }
            }
        ],
        as: "company.employee_range"
    }
  }
  const UNWIND_EMPLOYEE_RANGE = {
    $unwind: {
      path: "$company.employee_range",
      preserveNullAndEmptyArrays: true
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
  // Project
  const PROJECT = {
    $project: {
      '_id': 1,
      'fullName': 1,
      'email': 1,
      'emailVerified': 1,
      'mobile': 1,
      'mobileVerified': 1,
      'street': 1,
      'city': 1,
      'state': 1,
      'postal_code': 1,
      'country': 1,
      'profilePic': 1,
      'license': 1,
      'Role': 1,
      'company': 1,
      'department': 1,
      'active': 1,
      'updatedAt': 1,
      'createdAt': 1
    }
  }
  // Facet
  const FACET = (page, limit) => {
    return {
        $facet: {
          metadata: [{ $count: "total" }, { $addFields: { 'page': page } }],
          data: [{ $skip: (limit * page) - limit }, { $limit: limit }]
        }
    }
  }
  
  /* General Methods
  ---------------*/
  // Remove extra space from string
  const removeSpace = (str) => {
    return str.trim().replace(/  +/g, ' ');
  }
  // Generate Password
  const generatePassword = () => {
    return generator.generate({
      length: 8,
      numbers: true,
      symbols: '!@#$%^&*()+=?;,./"{}|:<>~_-`][\\\'',
      strict: true
    });
  }
  // Send SMS
  const sendSMS = (number, message) => {
    try {
      let smsOptions = {
        type: 'sms',
        from: process.env.TWILIO_MESSAGINGSERVICE_SID,
        to: number,
        body: message
      };
      return new Promise((resolve, reject) => {
        User.app.models.Twilio.send(smsOptions, (err, data) => {
          console.log('> sending code to mobile number:', number);
          if (err) {
            console.log('> error while sending code to mobile number', err);
            reject(err);
          }
          resolve("success");
        })
      })
    } catch (error) {
      console.error("> error in SMS function", error);
      return { success: true, msg: error };
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

    const password = generatePassword();
    
    // Create user
    User.create({ fullName, email, "emailVerified": true, password, mobile, roleId, licenseId, departmentId, creatorId, addedBy: "creator" }, {}, (err, user) => {
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
                const data = {
                  subject: `Welcome to | ${User.app.get('name')}`,
                  template: "welcome.ejs",
                  email: user.email,

                  user,
                  password,
                  loginUrl: `${process.env.WEB_URL}/login`,
                  appName: User.app.get('name')
                }
                sendEmail(User.app, data, async () => {
                  await user.updateAttributes({ password });
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

    const password = generatePassword();
    
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
            // Send email and password to user
            const data = {
              subject: `New Credentials | ${User.app.get('name')}`,
              template: "credential.ejs",
              email: user.email,

              user,
              password,
              appName: User.app.get('name')
            }
            sendEmail(User.app, data, async (response) => {
              if (response.success) {
                await user.updateAttributes({ password });
                next(null, 'Credentials sent successully!');
              } else {
                next(response.message);
              }
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
        
        let creatorId = user.creatorId || user.id;
        let query = { "companyId": user.companyId, creatorId, "_id": { $ne: userId } };

        if (type === "all") query = { "companyId": user.companyId };
        else if (type === "members" && user.departmentId) {
          query = { "companyId": user.companyId, "departmentId": user.departmentId, creatorId, "_id": { $ne: userId } }; 
        }

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
            FIND_ONLY_NOT_DELETED_USERS,
            LICENSE_LOOKUP,
            UNWIND_LICENSE,
            ROLE_LOOKUP,
            UNWIND_ROLE,
            DEPARTMENT_LOOKUP,
            UNWIND_DEPARTMENT,
            SEARCH_MATCH,
            SORT,
            PROJECT,
            FACET(page, limit)
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
          FIND_ONLY_NOT_DELETED_USERS,
          ROLE_MAP_LOOKUP(role.id),
          UNWIND_ROLE_MAP
        ]).toArray((err, result) => {
          next(err, result.length);
        });
      });
    });
  }

  // Get all users
  User.getAll = (page, limit, searchQuery, start, end, next) => {
    page = parseInt(page, 10) || 1;
    limit = parseInt(limit, 10) || 100;

    searchQuery = searchQuery ? searchQuery.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : "";
    let query = { "creatorId": { $exists: false } };

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
          },
          {
            'company.name': {
              $regex: searchQuery,
              $options: 'i'
            }
          }
        ]
      }
    }
    // Find user role
    User.app.models.Role.findOne({ where: {"name": "company_admin"} }, (err, role) => {
      User.getDataSource().connector.connect(function(err, db) {
        const userCollection = db.collection('user');
        userCollection.aggregate([
          { 
            $match: query
          },
          FIND_ONLY_NOT_DELETED_USERS,
          ROLE_MAP_LOOKUP_COMPANY_ADMIN(role.id),
          UNWIND_ROLE_MAP,
          ROLE_LOOKUP,
          UNWIND_ROLE,
          LICENSE_LOOKUP,
          UNWIND_LICENSE,
          COMPANY_LOOKUP,
          UNWIND_COMPANY,
          EMPLOYEE_DEPARTMENT_LOOKUP,
          UNWIND_EMPLOYEE_DEPARTMENT,
          EMPLOYEE_RANGE_LOOKUP,
          UNWIND_EMPLOYEE_RANGE,
          SEARCH_MATCH,
          SORT,
          PROJECT,
          FACET(page, limit)
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
      this.app.currentUser.updateAttributes({ "emailVerified": true, "emailVerificationCode": ""}, (err)=>{
        next(err, this.app.currentUser);
      });
    } else {
      let error = new Error("Invalid Code");
      error.status = 400;
      next(error);
    }
  };

  User.verifyPaymentMethod = function(next) {
    this.app.currentUser.updateAttributes({ "paymentVerified": true}, (error)=>{
      if(error) {
        let error = new Error("Invalid Code");
        error.status = 400;
        next(error);
      }
      next(error, this.app.currentUser);
    });
  };
  
  // Send email code
  User.sendEmailCode = function(next) {
    const emailVerificationCode = keygen.number({ length: 6 });
    const data = {
      subject: `Verfication Code | ${User.app.get('name')}`,
      template: "verification-code.ejs",
      email: User.app.currentUser.email,

      user: User.app.currentUser,
      emailVerificationCode,
      appName: User.app.get('name')
    }
    sendEmail(User.app, data, async (response) => {
      if (response.success) {
        await this.app.currentUser.updateAttributes({ emailVerificationCode });
        next(null, 'success');
      } else {
        next(response.message);
      }
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
    this.app.currentUser.updateAttributes({mobileVerificationCode}, {}, (err) => {
      if (err) return next(err);
      else {
        let mobileNumber;
        if (type == "updateProfile") mobileNumber = mobile.e164Number;
        else mobileNumber = User.app.currentUser.mobile.e164Number;
        sendSMS(mobileNumber, `${mobileVerificationCode} is your One-Time Password (OTP) for KPI Karta Mobile Number Verification.`)
        .then(() => {
          next(null, "sent");
        }).catch(err => {
          let error = err;
          error.status = 500;
          return next(error);
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
  User.block = function(userId, next) {
    User.findOne({ where: { "_id": userId } }, (err, user) => {
      if (err) {
        let error = new Error("User not found!");
        error.status = 404;
        next(error);
      }
      else if (user.creatorId) {
        User.updateAll({ "_id": userId }, { "active" : false }, (err) => {
          next(err, true);
        });
      } else {
        User.updateAll({ or: [{ "_id": userId }, { "creatorId": userId }] }, { "active" : false }, (err) => {
          next(err, true);
        });
      }
    });
  }
  // Unblock user
  User.unblock = function(userId, next) {
    User.findOne({ where: { "_id": userId } }, (err, user) => {
      if (err) {
        let error = new Error("User not found!");
        error.status = 404;
        next(error);
      }
      // Blocking a member of a company
      else if (user.creatorId) {
        User.updateAll({ "_id": userId }, { "active" : true }, (err) => {
          next(err, true);
        });
      } 
      // Blocking the whole company with members
      else {
        User.updateAll({ or: [{ "_id": userId }, { "creatorId": userId }] }, { "active" : true }, (err) => {
          if (err) {
            let error = new Error("User not found..!!");
            error.status = 404;
            next(error);
          }
          // Starting the Subscription
          User.app.models.subscription.findOne({ where: { userId }}, (err, subscription) => {
            if (err) {
              let error = new Error("Subscription not found..!!");
              error.status = 404;
              next(error);
            }
            User.app.models.subscription.update({ "id": subscription.id }, { status: true, trialActive: false }, (err) => {
              next(err, true);
            });
          })
        });
      }
    });
  }

  // Delete user
  User.delete = function(userId, next) {
    User.findOne({ where: { "_id": userId } }, (err, user) => {
      if (err) next(err);
      else if (!user) {
        let error = new Error("User not found!");
        error.status = 404;
        next(error);
      } else {
        User.app.models.userIdentity.findOne({ userId }, (err, resp) => {
          if (err) next(err);
          if (resp) {
            User.app.models.userIdentity.remove({ userId }, (err, resp) => {
              if (err) next(err);
            });
          }
        });
        user.is_deleted = true;
        user.active = false;
        user.email = `${user.email.split('@')[0]}_${Date.now()}_@${user.email.split('@')[1]}`;
        user.save();
        next(null, true);
      }
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
  User.on('resetPasswordRequest', (user) => {
    const resetLink = `${process.env.WEB_URL}/reset-password?access_token=${user.accessToken.id}`;
    const data = {
      subject: `Reset your password | ${User.app.get('name')}`,
      template: "forgot-password.ejs",
      email: user.email,
      
      user: user.user,
      resetLink,
      appName: User.app.get('name')
    }
    sendEmail(User.app, data, () => { });
  });

  // Before user create
  User.beforeRemote('create', (context, user, next) => {
    const companyName = removeSpace(context.req.body.companyName);
    const regex = new RegExp(["^", companyName, "$"].join(""), "i");

    User.app.models.company.findOne({ where: { "name": regex } }, (err, result) => {
      if (err) return next(err);
      else if (result) {
        let error = new Error("Company name is already registered!");
        error.status = 400;
        next(error);
      } else next();
    });
  });

  // After user create
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
        User.app.models.company.create({ "name": removeSpace(req.body.companyName), "userId": user.id }, {}, (err, company) => {
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
          const password = generatePassword();
          const data = {
            subject: `Welcome to | ${User.app.get('name')}`,
            template: "welcome.ejs",
            email: user.email,
      
            user,
            password,
            loginUrl: `${process.env.WEB_URL}/login`,
            appName: User.app.get('name')
          }
          sendEmail(User.app, data, async () => {
            await user.updateAttributes({ "emailVerified": true, password });
          });
        } else {
          // Generate verification code and send email
          const emailVerificationCode = keygen.number({ length: 6 });
          const data = {
            subject: `Thanks for signing up | ${User.app.get('name')}`,
            template: "signup.ejs",
            email: user.email,

            user,
            emailVerificationCode,
            appName: User.app.get('name')
          }
          sendEmail(User.app, data, async () => {
            await user.updateAttributes({ emailVerificationCode });
          });
        }
      });
    });
  });

  // After user login
  User.afterRemote('userLogin', (context, accessToken, next) => {
    if (accessToken && accessToken.user) {
      // Find user by access token
      User.findById(accessToken.userId.toString(), { include: ['company', 'role', 'license'] }, (err, user) => {
        if (err) return next(err);
        // Check if user is active or not
        if (!user.active) {
          let error = new Error("Your account has been deactivated or deleted by the admin, please connect admin at info@kpikarta.com for more details.");
          error.status = 400;
          next(error);
        }
        // If email is not verified
        else if (!user.emailVerified) {
          next();
          const emailVerificationCode = keygen.number({ length: 6 });
          const data = {
            subject: `Verfication Code | ${User.app.get('name')}`,
            template: "verification-code.ejs",
            email: user.email,

            user,
            emailVerificationCode,
            appName: User.app.get('name')
          }
          sendEmail(User.app, data, async () => {
            await user.updateAttributes({ emailVerificationCode });
          });
        }
        // User is verified, checking for twoFactor enabled or not
        else {
          if (user.mobile && user._2faEnabled && user.mobileVerified) {
            let mobileVerificationCode = keygen.number({ length: 6 });
            user.updateAttributes({ mobileVerificationCode }, {}, err => {
              sendSMS(user.mobile.e164Number, `${mobileVerificationCode} is your One-Time Password (OTP) for login on KPI Karta. Request you to please enter this to complete your login. This is valid for one time use only. Please do not share with anyone.`)
              .then(() => {}).catch(err => {});
            });
          }
          // Setting includes
          context.result = context.result.toJSON();
          context.result.user = user;
          next();
        }
      });
    } else next();
  });

  // After user update
  User.afterRemote('prototype.patchAttributes', function(context, userInstance, next) {
    const user = User.app.currentUser;
    const req = context.req;

    if (req.body.type == "social_user") {
      User.app.models.Role.findOne({ where:{ "name": "company_admin" } }, (err, role) => {
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
                  console.log('> error while updating social user', err);
                  return next(err);
                } 
              });
            });
          });
          // Send welcome email to social users
          const password = generatePassword();
          user.updateAttributes({ password }, {}, (err) => {
            // Create access token
            user.accessTokens.create((err, token) => {
              userInstance.__data.accessToken = token.id;
              next();
            });
            if (!user.email.includes("facebook.com")) {
              const data = {
                subject: `Welcome to | ${User.app.get('name')}`,
                template: "welcome.ejs",
                email: user.email,

                user,
                password,
                loginUrl: `${process.env.WEB_URL}/login`,
                appName: User.app.get('name')
              }
              sendEmail(User.app, data, () => { });
            }
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
