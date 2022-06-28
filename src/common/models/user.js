/* eslint-disable max-len */
'use strict';

const path = require('path');
const keygen = require('keygenerator');
const fs = require('fs');
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
    } else next(new Error('Invalid OTP'));
  };

  User.selectPlan = function(plan, next) {
    this.app.currentUser.updateAttributes({currentPlan: plan}, (err)=>{
      next(err, this.app.currentUser);
    });
  };

  User.resendCode = function(next) {
    var emailVerificationCode = keygen.number({length: 6});
    this.app.currentUser.updateAttributes({emailVerificationCode}, {}, err => {
      ejs.renderFile(path.resolve('templates/resend-verification-code.ejs'),
      {user: User.app.currentUser, emailVerificationCode}, {}, function(err, html) {
        User.app.models.Email.send({
          to: User.app.currentUser.email,
          from: User.app.dataSources.email.settings.transports[0].auth.user,
          subject: `Verfication Code | ${User.app.get('name')}`,
          html,
        }, function(err) {
          console.log('> sending verification code email to:', User.app.currentUser.email);
          if (err) return console.log('> error sending verification code email');
          next(null, 'success');
        });
      });
    });
  };

  User.generateMFAQRCode = function(next) {
    if (this.app.currentUser.mfaQRCode) {
      return next(null, this.app.currentUser.mfaQRCode);
    }
    var secret = speakeasy.generateSecret({length: 6, name: this.app.get('name') + ' | ' + this.app.currentUser.fullName});
    QRCode.toDataURL(secret.otpauth_url, function(err, mfaQRCode) {
      User.app.currentUser.updateAttributes({mfaSecret: secret.base32, mfaQRCode}, (err)=>{
        next(err, mfaQRCode);
      });
    });
  };

  User.enableMFA = function(token, next) {
    if (this.app.currentUser.mfaEnabled) {
      return next(new Error('MFA is already configured for this account'));
    }
    var verified = speakeasy.totp.verify({
      secret: this.app.currentUser.mfaSecret,
      encoding: 'base32',
      token,
    });
    if (verified) {
      this.app.currentUser.updateAttribute('mfaEnabled', true, (err)=>{
        next(null, verified);
      });
    } else next(null, verified);
  };

  User.verifyMFACode = function(token, next) {
    if (!this.app.currentUser.mfaEnabled) {
      return next(new Error('Multi factor authentication is disabled. Please enable it first'));
    }
    next(null, speakeasy.totp.verify({
      secret: this.app.currentUser.mfaSecret,
      encoding: 'base32',
      token,
    }));
  };

  User.resetMFAConfig = function(next) {
    this.app.currentUser.updateAttributes({mfaSecret: '', mfaQRCode: '', mfaEnabled: ''}, (err)=>{
      next(err, true);
    });
  };

/* =============================REMOTE HOOKS=========================================================== */
  User.on('resetPasswordRequest', function(info) {
    var resetLink = `${process.env.WEB_URL}/reset-password?access_token=${info.accessToken.id}`;
    ejs.renderFile(path.resolve('templates/forgotpassword.ejs'),
    {fullName: info.user.fullName, resetLink}, {}, function(err, html) {
      User.app.models.Email.send({
        to: info.email,
        from: User.app.dataSources.email.settings.transports[0].auth.user,
        subject: 'Reset your password | ' + User.app.get('name'),
        html,
      }, function(err) {
        console.log('> sending password reset email to:', info.email);
        if (err) return console.log('> error sending password reset email');
      });
    });
  });

  User.afterRemote('create', function(context, user, next) {
    RoleManager.assignRoles(User.app, ['user'], user.id, ()=>{
      var emailVerificationCode = keygen.number({length: 6});
      user.updateAttributes({emailVerificationCode}, {}, err=> {
        var options = {
          name: User.app.get('name'),
          type: 'email',
          to: user.email,
          from: User.app.dataSources.email.settings.transports[0].auth.user,
          subject: process.env.TEMPLATE_SIGNUP_SUBJECT,
          template: path.resolve(__dirname, '../../templates/signup.ejs'),
          user: user,
          emailVerificationCode,
        };
        user.verify(options, function(err, response) {
          user.accessTokens.create((error, token)=>{
            delete user.__data.emailVerificationCode;
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
            ejs.renderFile(path.resolve('templates/resend-verification-code.ejs'),
            {user, redirect: User.app.get('weburl'), emailVerificationCode}, {}, function(err, html) {
              User.app.models.Email.send({
                to: user.email,
                from: User.app.dataSources.email.settings.transports[0].auth.user,
                subject: `Verfication Code | ${User.app.get('name')}`,
                html,
              }, function(err) {
                console.log('> sending verification code email to:', user.email);
                if (err) return console.log('> error sending verification code email');
                next();
              });
            });
          });
        } else next();
      }));
    } else next();
  });
};
