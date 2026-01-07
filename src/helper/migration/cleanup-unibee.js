#!/usr/bin/env node
'use strict';

/**
 * UniBee Cleanup Script
 * 
 * Clears all development data from UniBee:
 * - Subscriptions (cancel/expire)
 * - Users (delete)
 * - Plans (archive/delete)
 * 
 * Usage:
 *   node src/helper/migration/cleanup-unibee.js [--confirm]
 * 
 * Options:
 *   --confirm    Actually perform the cleanup (without this, it's dry-run)
 */

require('dotenv').config();

const axios = require('axios');

const UNIBEE_API_URL = process.env.UNIBEE_API_URL || 'https://api.unibee.dev';
const UNIBEE_API_KEY = process.env.UNIBEE_API_KEY;

const api = axios.create({
    baseURL: UNIBEE_API_URL,
    headers: {
        'Authorization': `Bearer ${UNIBEE_API_KEY}`,
        'Content-Type': 'application/json'
    },
    timeout: 30000
});

const args = process.argv.slice(2);
const isConfirmed = args.includes('--confirm');

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function listSubscriptions() {
    try {
        const response = await api.post('/merchant/subscription/list', { page: 0, count: 200 });
        return response.data?.data?.subscriptions || [];
    } catch (err) {
        console.error('Error listing subscriptions:', err.response?.data || err.message);
        return [];
    }
}

async function listUsers() {
    try {
        const response = await api.post('/merchant/user/list', { page: 0, count: 200 });
        return response.data?.data?.userAccounts || [];
    } catch (err) {
        console.error('Error listing users:', err.response?.data || err.message);
        return [];
    }
}

async function listPlans() {
    try {
        const response = await api.post('/merchant/plan/list', { page: 0, count: 200 });
        return response.data?.data?.plans || [];
    } catch (err) {
        console.error('Error listing plans:', err.response?.data || err.message);
        return [];
    }
}

async function cancelSubscription(subscriptionId) {
    try {
        // Force cancel immediately
        await api.post('/merchant/subscription/cancel', { 
            subscriptionId: subscriptionId,
            cancelAtPeriodEnd: 0 // Immediate
        });
        return true;
    } catch (err) {
        // Already cancelled or expired
        if (err.response?.data?.message?.includes('already') || 
            err.response?.data?.message?.includes('cancel')) {
            return true;
        }
        console.error(`   Error cancelling ${subscriptionId}:`, err.response?.data?.message || err.message);
        return false;
    }
}

async function deleteUser(userId) {
    try {
        // UniBee might not have delete, try suspend/delete
        await api.post('/merchant/user/suspend', { userId: userId });
        return true;
    } catch (err) {
        console.error(`   Error deleting user ${userId}:`, err.response?.data?.message || err.message);
        return false;
    }
}

async function deletePlan(planId) {
    try {
        // First deactivate/archive
        await api.post('/merchant/plan/deactivate', { planId: planId });
        await delay(500);
        
        // Then try to delete
        await api.post('/merchant/plan/delete', { planId: planId });
        return true;
    } catch (err) {
        // Plan might have subscriptions, just deactivate
        if (err.response?.data?.message?.includes('subscription') || 
            err.response?.data?.message?.includes('active')) {
            console.log(`   ⚠️ Plan ${planId} has subscriptions, only deactivated`);
            return true;
        }
        console.error(`   Error deleting plan ${planId}:`, err.response?.data?.message || err.message);
        return false;
    }
}

async function main() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('            UniBee Cleanup Script');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    if (!isConfirmed) {
        console.log('🔍 DRY RUN MODE - No changes will be made');
        console.log('   Use --confirm to actually perform cleanup\n');
    } else {
        console.log('⚠️  CONFIRMED MODE - Data will be deleted!\n');
    }
    
    // List all data
    console.log('📋 Fetching current data...\n');
    
    const subscriptions = await listSubscriptions();
    const users = await listUsers();
    const plans = await listPlans();
    
    console.log(`Found:`);
    console.log(`  - ${subscriptions.length} subscriptions`);
    console.log(`  - ${users.length} users`);
    console.log(`  - ${plans.length} plans\n`);
    
    // Show subscriptions
    console.log('═══════════════════════════════════════════════════════════');
    console.log('SUBSCRIPTIONS:');
    console.log('═══════════════════════════════════════════════════════════');
    subscriptions.forEach(s => {
        const sub = s.subscription || s;
        const user = s.user || {};
        console.log(`  ${sub.subscriptionId || 'N/A'} - User: ${user.email || 'N/A'} - Status: ${sub.status}`);
    });
    console.log('');
    
    // Show users
    console.log('═══════════════════════════════════════════════════════════');
    console.log('USERS:');
    console.log('═══════════════════════════════════════════════════════════');
    users.forEach(u => {
        console.log(`  ${u.id} - ${u.email} - SubStatus: ${u.subscriptionStatus}`);
    });
    console.log('');
    
    // Show plans
    console.log('═══════════════════════════════════════════════════════════');
    console.log('PLANS:');
    console.log('═══════════════════════════════════════════════════════════');
    plans.forEach(p => {
        const plan = p.plan || p;
        const statusMap = { 1: 'Editing', 2: 'Active', 3: 'Inactive', 4: 'Expired', 5: 'Archived' };
        const typeMap = { 1: 'Main', 2: 'Addon', 3: 'OneTime' };
        console.log(`  ${plan.id} - ${plan.planName} (Type: ${typeMap[plan.type] || plan.type}, Status: ${statusMap[plan.status] || plan.status})`);
    });
    console.log('');
    
    if (!isConfirmed) {
        console.log('═══════════════════════════════════════════════════════════');
        console.log('To actually delete all this data, run:');
        console.log('  node src/helper/migration/cleanup-unibee.js --confirm');
        console.log('═══════════════════════════════════════════════════════════');
        return;
    }
    
    // PERFORM CLEANUP
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🗑️  PERFORMING CLEANUP...');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    // 1. Cancel all subscriptions first
    console.log('Step 1: Cancelling subscriptions...');
    let subsCancelled = 0;
    for (const s of subscriptions) {
        const sub = s.subscription || s;
        if (sub.subscriptionId) {
            const success = await cancelSubscription(sub.subscriptionId);
            if (success) subsCancelled++;
            await delay(300);
        }
    }
    console.log(`   ✅ Cancelled ${subsCancelled}/${subscriptions.length} subscriptions\n`);
    
    // 2. Suspend/delete users
    console.log('Step 2: Suspending users...');
    let usersDeleted = 0;
    for (const u of users) {
        const success = await deleteUser(u.id);
        if (success) usersDeleted++;
        await delay(300);
    }
    console.log(`   ✅ Suspended ${usersDeleted}/${users.length} users\n`);
    
    // 3. Delete/archive plans
    console.log('Step 3: Deleting/archiving plans...');
    let plansDeleted = 0;
    for (const p of plans) {
        const plan = p.plan || p;
        const success = await deletePlan(plan.id);
        if (success) plansDeleted++;
        await delay(300);
    }
    console.log(`   ✅ Deleted/archived ${plansDeleted}/${plans.length} plans\n`);
    
    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ CLEANUP COMPLETE!');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('\nNOTE: Some data may require manual deletion from UniBee dashboard');
    console.log('      if there are dependencies or restrictions.');
}

main().catch(console.error);
