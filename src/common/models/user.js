/* eslint-disable max-len */
'use strict';

const path = require('path');
const keygen = require('keygenerator');
const fs = require('fs');
const ejs = require('ejs');

module.exports = function(User) {
  // Custom methods
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

  // Remote hooks
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

  User.afterRemote('login', function(context, user, next) {
    console.log("user data = ", user);
    if (user.emailVerified) {
      var emailVerificationCode = keygen.number({length: 6});
      ejs.renderFile(path.resolve('templates/signup.ejs'),
      {user, emailVerificationCode}, {}, function(err, html) {
        User.app.models.Email.send({
          to: user.email,
          from: User.app.dataSources.email.settings.transports[0].auth.user,
          subject: `${emailVerificationCode} is your verfication code | ${User.app.get('name')}`,
          html,
        }, function(err) {
          console.log('> sending verification code email to:', user.email);
          if (err) return console.log('> error sending verification code email');
        });
      });
    }
  });
};
