#!/usr/bin/env node
'use strict';

/**
 * ChargeBee to UniBee Coupon Migration Script
 * 
 * Migrates coupons and coupon sets from ChargeBee to UniBee.
 * 
 * Usage:
 *   node src/helper/migration/migrate-coupons.js [--dry-run]
 */

require('dotenv').config();

const axios = require('axios');
const chargebee = require('chargebee');

// Configure ChargeBee
chargebee.configure({
    site: process.env.CHARGEBEE_SITE_NAME || 'kpikarta',
    api_key: process.env.CHARGEBEE_API_KEY
});

// UniBee API configuration
const UNIBEE_API_URL = process.env.UNIBEE_API_URL || 'https://api.unibee.dev';
const UNIBEE_API_KEY = process.env.UNIBEE_API_KEY;

const unibeeApi = axios.create({
    baseURL: UNIBEE_API_URL,
    headers: {
        'Authorization': `Bearer ${UNIBEE_API_KEY}`,
        'Content-Type': 'application/json'
    },
    timeout: 30000
});

// CLI arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');

// UniBee Plan IDs for mapping
const PLAN_IDS = {
    creatorMonthly: parseInt(process.env.UNIBEE_CREATOR_MONTHLY_PLAN_ID) || 425,
    creatorYearly: parseInt(process.env.UNIBEE_CREATOR_YEARLY_PLAN_ID) || 424,
    spectatorFree: parseInt(process.env.UNIBEE_SPECTATOR_PLAN_ID) || 419,
};

// All plan IDs for coupons that apply to all plans
const ALL_PLAN_IDS = [
    PLAN_IDS.creatorMonthly,
    PLAN_IDS.creatorYearly,
    PLAN_IDS.spectatorFree,
];

/**
 * Convert ChargeBee coupon to UniBee discount format
 */
function convertCouponToUniBee(coupon) {
    // Determine discount type and amount
    // ChargeBee: discount_type = 'percentage' | 'fixed_amount'
    // UniBee: discountType = 1 (percentage) | 2 (fixed_amount)
    
    let discountType = 1; // percentage
    let discountPercentage = 0;
    let discountAmount = 0;
    
    if (coupon.discount_type === 'percentage') {
        discountType = 1;
        discountPercentage = coupon.discount_percentage || 0;
    } else if (coupon.discount_type === 'fixed_amount') {
        discountType = 2;
        discountAmount = coupon.discount_amount || 0;
    }
    
    // Determine billing type
    // UniBee: billingType = 1 (one-time) | 2 (recurring)
    // ChargeBee: duration_type = 'forever' | 'one_time' | 'limited_period'
    let billingType = 2; // recurring by default
    if (coupon.duration_type === 'one_time') {
        billingType = 1;
    }
    
    // Cycle limit (0 = forever, >0 = limited)
    let cycleLimit = 0;
    if (coupon.duration_type === 'limited_period' && coupon.period) {
        cycleLimit = coupon.period;
    }
    
    // Calculate end time
    let endTime;
    if (coupon.valid_till) {
        endTime = coupon.valid_till;
    } else {
        // Set to 20 years from now if no expiry
        endTime = Math.floor(Date.now() / 1000) + (86400 * 365 * 20);
    }
    
    // User/redemption limit
    let userLimit = 0;
    if (coupon.max_redemptions) {
        userLimit = coupon.max_redemptions;
    }
    
    return {
        code: coupon.id.toUpperCase(),
        name: coupon.name || coupon.id,
        billingType: billingType,
        discountType: discountType,
        discountPercentage: discountPercentage,
        discountAmount: discountAmount,
        cycleLimit: cycleLimit,
        startTime: Math.floor(Date.now() / 1000),
        endTime: endTime,
        userLimit: userLimit,
        planIds: ALL_PLAN_IDS, // Apply to all plans
        metadata: {
            chargebeeCouponId: coupon.id,
            migratedAt: new Date().toISOString()
        }
    };
}

/**
 * Fetch all coupons from ChargeBee
 */
async function fetchChargeBeCoupons() {
    return new Promise((resolve, reject) => {
        const coupons = [];
        
        chargebee.coupon.list({
            limit: 100,
            'status[is]': 'active'
        }).request((err, result) => {
            if (err) {
                reject(err);
                return;
            }
            
            result.list.forEach(item => {
                coupons.push(item.coupon);
            });
            
            resolve(coupons);
        });
    });
}

/**
 * Create discount in UniBee
 */
async function createUniBeeDiscount(discountData) {
    try {
        const response = await unibeeApi.post('/merchant/discount/new', discountData);
        return response.data?.data?.discount;
    } catch (err) {
        if (err.response?.data?.message?.includes('already exist')) {
            console.log(`  ⚠️  Discount ${discountData.code} already exists`);
            return { existing: true, code: discountData.code };
        }
        throw err;
    }
}

/**
 * Activate discount in UniBee
 */
async function activateUniBeeDiscount(discountId) {
    try {
        await unibeeApi.post('/merchant/discount/activate', { id: discountId });
        return true;
    } catch (err) {
        console.log(`  ⚠️  Could not activate discount ${discountId}: ${err.message}`);
        return false;
    }
}

/**
 * Main migration function
 */
async function main() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('       ChargeBee to UniBee Coupon Migration');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    if (isDryRun) {
        console.log('🔍 DRY RUN MODE - No changes will be made\n');
    } else {
        console.log('⚠️  LIVE MODE - Coupons will be created in UniBee\n');
    }
    
    // Fetch ChargeBee coupons
    console.log('📋 Fetching coupons from ChargeBee...');
    const coupons = await fetchChargeBeCoupons();
    console.log(`   Found ${coupons.length} active coupons\n`);
    
    if (coupons.length === 0) {
        console.log('No coupons to migrate.');
        return;
    }
    
    // Display coupons
    console.log('═══════════════════════════════════════════════════════════');
    console.log('ChargeBee Coupons:');
    console.log('═══════════════════════════════════════════════════════════');
    
    coupons.forEach(coupon => {
        const discount = coupon.discount_type === 'percentage' 
            ? `${coupon.discount_percentage}%` 
            : `$${(coupon.discount_amount / 100).toFixed(2)}`;
        const duration = coupon.duration_type === 'forever' ? 'Forever' : coupon.duration_type;
        const redemptions = coupon.max_redemptions || 'Unlimited';
        
        console.log(`  ${coupon.id}`);
        console.log(`    Name: ${coupon.name}`);
        console.log(`    Discount: ${discount} (${duration})`);
        console.log(`    Max Redemptions: ${redemptions}`);
        console.log(`    Status: ${coupon.status}`);
        console.log('');
    });
    
    if (isDryRun) {
        console.log('═══════════════════════════════════════════════════════════');
        console.log('DRY RUN - Would create the following discounts in UniBee:');
        console.log('═══════════════════════════════════════════════════════════\n');
        
        coupons.forEach(coupon => {
            const discountData = convertCouponToUniBee(coupon);
            console.log(`  ${discountData.code}:`);
            console.log(`    Type: ${discountData.discountType === 1 ? 'Percentage' : 'Fixed Amount'}`);
            console.log(`    Discount: ${discountData.discountPercentage}% / $${discountData.discountAmount}`);
            console.log(`    Billing Type: ${discountData.billingType === 1 ? 'One-time' : 'Recurring'}`);
            console.log(`    User Limit: ${discountData.userLimit || 'Unlimited'}`);
            console.log('');
        });
        
        console.log('Run without --dry-run to create these discounts in UniBee.');
        return;
    }
    
    // Create discounts in UniBee
    console.log('═══════════════════════════════════════════════════════════');
    console.log('Creating discounts in UniBee...');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    let created = 0;
    let skipped = 0;
    let failed = 0;
    
    for (const coupon of coupons) {
        const discountData = convertCouponToUniBee(coupon);
        console.log(`Creating: ${discountData.code}...`);
        
        try {
            const result = await createUniBeeDiscount(discountData);
            
            if (result?.existing) {
                skipped++;
            } else if (result?.id) {
                console.log(`  ✅ Created discount ID: ${result.id}`);
                
                // Activate the discount
                await activateUniBeeDiscount(result.id);
                console.log(`  ✅ Activated`);
                
                created++;
            } else {
                console.log(`  ❌ Unknown result`);
                failed++;
            }
        } catch (err) {
            console.log(`  ❌ Error: ${err.response?.data?.message || err.message}`);
            failed++;
        }
        
        console.log('');
    }
    
    // Summary
    console.log('═══════════════════════════════════════════════════════════');
    console.log('Migration Summary:');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`  Total coupons: ${coupons.length}`);
    console.log(`  Created: ${created}`);
    console.log(`  Skipped (existing): ${skipped}`);
    console.log(`  Failed: ${failed}`);
    console.log('═══════════════════════════════════════════════════════════');
}

main().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
