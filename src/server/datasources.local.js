module.exports = {
  "db": {
    "host": "localhost",
    "database": process.env.DB,
    "name": "db",
    "connector": "mongodb",
    "maxDepthOfQuery": 11000,
    "maxDepthOfData": 11000
  },
  "email": {
    "name": "email",
    "connector": "mail",
    "transports": [
      {
        "type": "smtp",
        "host": process.env.SMTP_HOST,
        "secure": false,
        "port": process.env.SMPT_PORT,
        "tls": {
          "rejectUnauthorized": false,
        },
        "auth": {
          "user": process.env.SMTP_USER,
          "pass": process.env.SMTP_PASS,
        },
      },
    ],
  },
  "twilio": {
    "name": "twilio",
    "connector": "loopback-connector-twilio",
    "accountSid": process.env.TWILIO_ACCOUNT_SID,
    "authToken": process.env.TWILIO_AUTH_TOKEN
  },
  "storage": {
    "name": "storage",
    "connector": "loopback-component-storage",
    "provider": "filesystem",
    "root": "./storage",
    "nameConflict": "makeUnique",
    "maxFileSize": "20000000",
    "allowedContentTypes": [
      "image/jpeg",
      "image/jpg",
      "image/png"
    ]
  }
};
