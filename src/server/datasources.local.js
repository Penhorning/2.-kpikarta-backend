const { shouldUseDemoEmail, shouldUseDemoSms } = require('../helper/demoMode');

const emailTransports = shouldUseDemoEmail ? [] : [{
  "type": "smtp",
  "host": process.env.SMTP_HOST,
  "secure": false,
  "port": Number(process.env.SMTP_PORT || process.env.SMPT_PORT || 587),
  "tls": {
    "rejectUnauthorized": false
  },
  "auth": {
    "user": process.env.SMTP_USER,
    "pass": process.env.SMTP_PASS
  }
}];

module.exports = {
  "db": {
    "host": "127.0.0.1",
    "database": process.env.DB,
    "name": "db",
    "port": 27017,
    "connector": "mongodb",
    "maxDepthOfQuery": 11000,
    "maxDepthOfData": 11000
  },
  "email": {
    "name": "email",
    "connector": "mail",
    "transports": emailTransports,
  },
  "twilio": {
    "name": "twilio",
    "connector": "loopback-connector-twilio",
    "accountSid": process.env.TWILIO_ACCOUNT_SID || (shouldUseDemoSms ? 'demo-account-sid' : undefined),
    "authToken": process.env.TWILIO_AUTH_TOKEN || (shouldUseDemoSms ? 'demo-auth-token' : undefined),
    "sgAPIKey": process.env.SENDGRID_API_KEY || (shouldUseDemoSms ? 'demo-sendgrid-key' : undefined)
  },
  "storage": {
    "name": "storage",
    "connector": "loopback-component-storage",
    "provider": "filesystem",
    "root": "./storage",
    "nameConflict": "makeUnique",
    "maxFileSize": "20000000",  // 20mb
    "allowedContentTypes": [
      "image/jpeg",
      "image/jpg",
      "image/png"
    ]
  }
};
