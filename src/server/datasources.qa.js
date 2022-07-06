module.exports = {
  'db': {
    'host': 'localhost',
    'database': 'kpikarta-qa',
    'name': 'db',
    'connector': 'mongodb',
  },
  'email': {
    'name': 'email',
    'connector': 'mail',
    'transports': [
      {
        'type': 'smtp',
        'host': process.env.SMTP_HOST,
        'secure': false,
        'port': process.env.SMPT_PORT,
        'tls': {
          'rejectUnauthorized': false,
        },
        'auth': {
          'user': process.env.SMTP_USER,
          'pass': process.env.SMTP_PASS,
        },
      },
    ],
  },
  "twilio": {
    "name": "twilio",
    "connector": "loopback-connector-twilio",
    "accountSid": "ACfe7d85c6f7dc9d26c60db4a5644237c9",
    "authToken": "e0f3dac18f49cda48a44d80d25532d53"
  },
  "storage": {
    "name": "storage",
    "connector": "loopback-component-storage",
    "provider": "filesystem",
    "root": "./storage",
    "nameConflict": "makeUnique"
  }
};
