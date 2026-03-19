'use strict';

const TRUE_VALUES = ['1', 'true', 'yes', 'on'];

const parseBool = (value) => TRUE_VALUES.includes(String(value || '').toLowerCase());

const hasEnv = (...keys) => keys.every((key) => {
    const value = process.env[key];
    return value !== undefined && value !== null && String(value).trim() !== '';
});

const isDemoMode = parseBool(process.env.DEMO_MODE);

const serviceConfig = {
    smtp: hasEnv('SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'),
    twilio: hasEnv('TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_MESSAGINGSERVICE_SID'),
    openai: hasEnv('OPENAI_API_KEY', 'OPENAI_ASSISTANT_KEY'),
    salesforce: hasEnv('SALESFORCE_USERNAME', 'SALESFORCE_PASSWORD', 'SALESFORCE_TOKEN'),
    unibee: hasEnv('UNIBEE_API_KEY'),
    chargebee: hasEnv('CHARGEBEE_API_KEY', 'CHARGEBEE_SITE_URL'),
    google: hasEnv('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'),
    facebook: hasEnv('FACEBOOK_CLIENT_ID', 'FACEBOOK_CLIENT_SECRET'),
    linkedin: hasEnv('LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'),
};

const shouldUseDemoEmail = isDemoMode || !serviceConfig.smtp;
const shouldUseDemoSms = isDemoMode || !serviceConfig.twilio;
const shouldUseDemoOpenAI = isDemoMode || !serviceConfig.openai;
const shouldUseDemoSalesforce = isDemoMode || !serviceConfig.salesforce;
const shouldUseDemoBilling = isDemoMode || !serviceConfig.unibee;
const shouldUseStaticVerificationCode = isDemoMode || shouldUseDemoEmail || shouldUseDemoSms;

const getDemoOtpCode = () => process.env.DEMO_STATIC_OTP || '123456';

module.exports = {
    parseBool,
    hasEnv,
    isDemoMode,
    serviceConfig,
    shouldUseDemoEmail,
    shouldUseDemoSms,
    shouldUseDemoOpenAI,
    shouldUseDemoSalesforce,
    shouldUseDemoBilling,
    shouldUseStaticVerificationCode,
    getDemoOtpCode,
};
