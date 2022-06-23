module.exports = {
  'db': {
    'host': 'localhost',
    'database': 'kpikarta-production',
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
};
