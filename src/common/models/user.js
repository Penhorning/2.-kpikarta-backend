/* eslint-disable max-len */
'use strict';

const path = require('path');
const keygen = require('keygenerator');
const fs = require('fs');
const ejs = require('ejs');

module.exports = function(User) {
/*=============================CUSTOM METHODS===========================================================*/
  User.verifyEmail = function (otp, next) {
    var otpVerified = this.app.currentUser.emailVerificationCode == otp;
    if (otpVerified) {
      this.app.currentUser.updateAttributes({emailVerified: true, emailVerificationCode: ''}, (err)=>{
        next(err, this.app.currentUser);
      });
    } else next(new Error('Invalid OTP'));
  };
  
  User.selectPlan = function (plan, next) {
    this.app.currentUser.updateAttributes({currentPlan: plan}, (err)=>{
      next(err, this.app.currentUser);
    });
  };
  
  User.resendCode = function (next) {
    var emailVerificationCode = keygen.number({length: 6});
    this.app.currentUser.updateAttributes({emailVerificationCode}, {}, err => {
      ejs.renderFile(path.resolve('templates/resend-verification-code.ejs'),
      {user: User.app.currentUser, redirect: User.app.get('weburl'), emailVerificationCode}, {}, function(err, html) {
        User.app.models.Email.send({
          to: User.app.currentUser.email,
          from: User.app.dataSources.email.settings.transports[0].auth.user,
          subject: `${emailVerificationCode} is your verfication code | ${User.app.get('name')}`,
          html
        }, function(err) {
          console.log('> sending verification code email to:', User.app.currentUser.email);
          if (err) return console.log('> error sending verification code email');
          next(null, "success");
        });
      });
    });
  };

/*=============================REMOTE HOOKS===========================================================*/
  User.on('resetPasswordRequest', function(info) {
    var resetLink = 'http://159.89.234.66:3343/reset-password?access_token=' + info.accessToken.id;
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
    var emailVerificationCode = keygen.number({length: 6});
    user.updateAttributes({emailVerificationCode}, {}, err=> {
      var options = {
        name: User.app.get('name'),
        type: 'email',
        to: user.email,
        from: User.app.dataSources.email.settings.transports[0].auth.user,
        subject: process.env.TEMPLATE_SIGNUP_SUBJECT,
        template: path.resolve(__dirname, '../../templates/signup.ejs'),
        redirect: User.app.get('weburl'),
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

  User.afterRemote('login', function(context, accessToken, next) {
    if (accessToken && accessToken.user) {
      accessToken.user((err, user)=>{
        if (!user.emailVerified) {
          var emailVerificationCode = keygen.number({length: 6});
          user.updateAttributes({emailVerificationCode}, {}, err => {
            ejs.renderFile(path.resolve('templates/resend-verification-code.ejs'),
            {user, redirect: User.app.get('weburl'), emailVerificationCode}, {}, function(err, html) {
              User.app.models.Email.send({
                to: user.email,
                from: User.app.dataSources.email.settings.transports[0].auth.user,
                subject: `${emailVerificationCode} is your verfication code | ${User.app.get('name')}`,
                html
              }, function(err) {
                console.log('> sending verification code email to:', user.email);
                if (err) return console.log('> error sending verification code email');
                next();
              });
            });
          });
        } else next();
      })
    } else next();
  });
};
