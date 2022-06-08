'use strict';

module.exports = function(User) {
  User.on('resetPasswordRequest', function(info) {
    console.log('But it does not print this log here ever.');

    var url = 'http://www.example.com/reset-password';
    var html = 'Click <a href="' + url + '?access_token=' +
    info.accessToken.id + '">here</a>';
    User.app.models.Email.send({
      to: info.email,
      from: User.app.dataSources.email.settings.transports[0].auth.user,
      subject: 'Reset your password | ' + User.app.get('name'),
      html: html,
    }, function(err) {
      console.log('> sending password reset email to:', info.email);
      if (err) return console.log('> error sending password reset email');
    });
  });
};
