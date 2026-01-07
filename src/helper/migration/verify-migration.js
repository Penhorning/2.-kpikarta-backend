'use strict';

/**
 * Verify Migration Integrity
 * Check if users and subscriptions are correctly linked
 */

require('dotenv').config();
const axios = require('axios');
const chargebee = require('chargebee');

chargebee.configure({
    site: process.env.CHARGEBEE_SITE_NAME || 'kpikarta',
    api_key: process.env.CHARGEBEE_API_KEY
});

const UNIBEE_API_URL = process.env.UNIBEE_API_URL || 'https://api.unibee.dev';
const UNIBEE_API_KEY = process.env.UNIBEE_API_KEY;

const unibeeApi = axios.create({
    baseURL: UNIBEE_API_URL,
    headers: { 'Authorization': `Bearer ${UNIBEE_API_KEY}` },
    timeout: 30000
});

async function verifyUser(email) {
    console.log('═'.repeat(60));
    console.log('Verifying: ' + email);
    console.log('─'.repeat(60));
    
    // 1. Get ChargeBee customer
    const cbResult = await chargebee.customer.list({ email: { is: email } }).request();
    if (!cbResult.list || cbResult.list.length === 0) {
        console.log('  ChargeBee: NOT FOUND');
        return { email, status: 'cb_not_found' };
    }
    const cbCustomer = cbResult.list[0].customer;
    console.log('  ChargeBee Customer ID: ' + cbCustomer.id);
    
    // Get CB subscriptions
    const cbSubResult = await chargebee.subscription.list({ customer_id: { is: cbCustomer.id } }).request();
    const cbSubs = cbSubResult.list || [];
    console.log('  ChargeBee Subscriptions (' + cbSubs.length + '):');
    for (const s of cbSubs) {
        console.log('    - ' + s.subscription.id + ' (' + s.subscription.status + ')');
    }
    
    // 2. Get UniBee user
    const ubRes = await unibeeApi.get('/merchant/user/search', { params: { searchKey: email } });
    const ubUsers = ubRes.data?.data?.userAccounts || [];
    const ubUser = ubUsers.find(u => u.email.toLowerCase() === email.toLowerCase());
    
    if (!ubUser) {
        console.log('  UniBee: NOT FOUND');
        return { email, status: 'ub_not_found' };
    }
    
    console.log('  UniBee User ID: ' + ubUser.id);
    console.log('  UniBee ExtUserId: ' + ubUser.externalUserId);
    
    const userMatch = ubUser.externalUserId === cbCustomer.id;
    console.log('  User ID Match: ' + (userMatch ? '✅ YES' : '❌ NO - Expected: ' + cbCustomer.id));
    
    // 3. Get UniBee subscription
    const ubSubRes = await unibeeApi.get('/merchant/subscription/list', { params: { userId: ubUser.id } });
    const ubSubs = ubSubRes.data?.data?.subscriptions || [];
    console.log('  UniBee Subscriptions (' + ubSubs.length + '):');
    
    let subMatch = false;
    for (const s of ubSubs) {
        const sub = s.subscription;
        console.log('    - ' + sub.subscriptionId);
        console.log('      extSubId: ' + sub.externalSubscriptionId + ', planId: ' + sub.planId);
        
        const matchingCbSub = cbSubs.find(cs => cs.subscription.id === sub.externalSubscriptionId);
        if (matchingCbSub) {
            console.log('      ✅ Correctly linked to ChargeBee: ' + matchingCbSub.subscription.id);
            subMatch = true;
        } else {
            console.log('      ❌ externalSubscriptionId NOT in ChargeBee subscriptions!');
        }
    }
    
    return { 
        email, 
        status: userMatch && subMatch ? 'ok' : 'mismatch',
        userMatch,
        subMatch
    };
}

async function main() {
    console.log('\n🔍 MIGRATION INTEGRITY CHECK\n');
    
    // Test a sample of users
    const testEmails = [
        'penhorning@gmail.com',
        'matt@trifiro.com', 
        'daphuzz@gmail.com',
        'cderringer@tancoeng.com',
        'urbanmusiq@hotmail.com'
    ];
    
    const results = [];
    for (const email of testEmails) {
        try {
            const result = await verifyUser(email);
            results.push(result);
        } catch (err) {
            console.log('  ERROR: ' + err.message);
            results.push({ email, status: 'error', error: err.message });
        }
    }
    
    console.log('\n' + '═'.repeat(60));
    console.log('SUMMARY');
    console.log('─'.repeat(60));
    
    const ok = results.filter(r => r.status === 'ok').length;
    const mismatch = results.filter(r => r.status === 'mismatch').length;
    const errors = results.filter(r => r.status === 'error' || r.status.includes('not_found')).length;
    
    console.log('✅ OK: ' + ok);
    console.log('❌ Mismatch: ' + mismatch);
    console.log('⚠️ Errors/Not Found: ' + errors);
    
    if (mismatch > 0) {
        console.log('\n⚠️ MISMATCHED USERS:');
        results.filter(r => r.status === 'mismatch').forEach(r => {
            console.log('  - ' + r.email + ' (user: ' + (r.userMatch ? 'ok' : 'mismatch') + ', sub: ' + (r.subMatch ? 'ok' : 'mismatch') + ')');
        });
    }
}

main().catch(err => {
    console.error('Script failed:', err.message);
    process.exit(1);
});
