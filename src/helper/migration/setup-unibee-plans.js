#!/usr/bin/env node
'use strict';

/**
 * UniBee Plans Setup Script
 * 
 * Creates all required plans in UniBee with correct pricing and trial periods.
 * Based on ChargeBee plan configuration and client requirements:
 * 
 * - Creator Monthly: $9/month + 14-day trial
 * - Creator Yearly: $99/year + 14-day trial
 * - Creator Addon Monthly: $9/month (no trial)
 * - Creator Addon Yearly: $99/year (no trial)
 * - Champion Addon Monthly: $6/month (no trial)
 * - Champion Addon Yearly: $59/year (no trial)
 * - Spectator Yearly: $0/year (FREE, no trial)
 * 
 * Usage:
 *   node src/helper/migration/setup-unibee-plans.js
 */

require('dotenv').config();

const axios = require('axios');
const fs = require('fs');
const path = require('path');

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

// Plans configuration matching ChargeBee + client requirements
const PLANS_CONFIG = [
    {
        planName: 'Creator Monthly',
        externalPlanId: 'cb-creator-plan-Monthly',
        amount: 900,  // $9.00 in cents
        currency: 'USD',
        intervalUnit: 'month',
        intervalCount: 1,
        trialDurationTime: 14,  // 14-day trial
        trialDemand: false,     // Auto-start trial
        description: 'KPI Karta Creator Plan - Monthly subscription with 14-day free trial'
    },
    {
        planName: 'Creator Yearly',
        externalPlanId: 'cb-creator-plan-Yearly',
        amount: 9900,  // $99.00 in cents
        currency: 'USD',
        intervalUnit: 'year',
        intervalCount: 1,
        trialDurationTime: 14,  // 14-day trial
        trialDemand: false,
        description: 'KPI Karta Creator Plan - Yearly subscription with 14-day free trial'
    },
    {
        planName: 'Creator Addon Monthly',
        externalPlanId: 'cb-creator-addon-plan-Monthly',
        amount: 900,  // $9.00 in cents
        currency: 'USD',
        intervalUnit: 'month',
        intervalCount: 1,
        trialDurationTime: 0,   // No trial
        description: 'Additional Creator seat - Monthly'
    },
    {
        planName: 'Creator Addon Yearly',
        externalPlanId: 'cb-creator-addon-plan-Yearly',
        amount: 9900,  // $99.00 in cents
        currency: 'USD',
        intervalUnit: 'year',
        intervalCount: 1,
        trialDurationTime: 0,   // No trial
        description: 'Additional Creator seat - Yearly'
    },
    {
        planName: 'Champion Addon Monthly',
        externalPlanId: 'cb-champion-addon-plan-Monthly',
        amount: 600,  // $6.00 in cents
        currency: 'USD',
        intervalUnit: 'month',
        intervalCount: 1,
        trialDurationTime: 0,   // No trial
        description: 'Champion Addon seat - Monthly'
    },
    {
        planName: 'Champion Addon Yearly',
        externalPlanId: 'cb-champion-addon-plan-Yearly',
        amount: 5900,  // $59.00 in cents
        currency: 'USD',
        intervalUnit: 'year',
        intervalCount: 1,
        trialDurationTime: 0,   // No trial
        description: 'Champion Addon seat - Yearly'
    },
    {
        planName: 'Spectator Free',
        externalPlanId: 'spectator-free-yearly',
        amount: 0,     // FREE
        currency: 'USD',
        intervalUnit: 'year',
        intervalCount: 1,
        trialDurationTime: 0,   // No trial
        description: 'Spectator Plan - Free yearly access with limited features'
    }
];

const createdPlans = {};

async function getOrCreateProduct() {
    console.log('📦 Checking for existing product...');
    
    try {
        // List existing products
        const response = await unibeeApi.post('/merchant/product/list', {
            page: 1,
            count: 10
        });
        
        const products = response.data?.data?.products || [];
        
        if (products.length > 0) {
            console.log(`✅ Using existing product: ${products[0].productName} (ID: ${products[0].id})`);
            return products[0].id;
        }
        
        // Create new product
        console.log('📦 Creating new product...');
        const createResponse = await unibeeApi.post('/merchant/product/new', {
            productName: 'KPI Karta',
            description: 'KPI Karta Subscription Plans'
        });
        
        const productId = createResponse.data?.data?.product?.id;
        console.log(`✅ Created product: KPI Karta (ID: ${productId})`);
        return productId;
        
    } catch (err) {
        console.error('❌ Error with product:', err.response?.data || err.message);
        throw err;
    }
}

async function createPlan(productId, planConfig) {
    console.log(`\n📝 Creating plan: ${planConfig.planName}...`);
    
    const planData = {
        productId: productId,
        planName: planConfig.planName,
        externalPlanId: planConfig.externalPlanId,
        amount: planConfig.amount,
        currency: planConfig.currency,
        intervalUnit: planConfig.intervalUnit,
        intervalCount: planConfig.intervalCount,
        description: planConfig.description
    };
    
    // Add trial if specified
    if (planConfig.trialDurationTime > 0) {
        planData.trialDurationTime = planConfig.trialDurationTime * 24 * 60 * 60; // Convert days to seconds
        planData.trialDemand = planConfig.trialDemand || false;
    }
    
    try {
        const response = await unibeeApi.post('/merchant/plan/new', planData);
        const plan = response.data?.data?.plan;
        
        if (plan) {
            console.log(`   ✅ Created: ID ${plan.id}`);
            console.log(`      Amount: $${planConfig.amount / 100}/${planConfig.intervalUnit}`);
            console.log(`      Trial: ${planConfig.trialDurationTime > 0 ? planConfig.trialDurationTime + ' days' : 'None'}`);
            return plan;
        }
    } catch (err) {
        // Check if plan already exists
        if (err.response?.data?.message?.includes('already exist') || 
            err.response?.data?.message?.includes('duplicate')) {
            console.log(`   ⚠️ Plan already exists, searching...`);
            
            // Find existing plan by external ID
            const searchResponse = await unibeeApi.post('/merchant/plan/list', {
                page: 1,
                count: 50
            });
            
            const plans = searchResponse.data?.data?.plans || [];
            const existingPlan = plans.find(p => p.externalPlanId === planConfig.externalPlanId);
            
            if (existingPlan) {
                console.log(`   ✅ Found existing: ID ${existingPlan.id}`);
                return existingPlan;
            }
        }
        
        console.error(`   ❌ Error: ${err.response?.data?.message || err.message}`);
        return null;
    }
}

async function activatePlan(planId) {
    try {
        await unibeeApi.post('/merchant/plan/activate', { planId: planId });
        console.log(`   🚀 Activated plan ${planId}`);
        return true;
    } catch (err) {
        // Plan might already be active
        if (err.response?.data?.message?.includes('already') || 
            err.response?.data?.message?.includes('active')) {
            console.log(`   🚀 Plan ${planId} already active`);
            return true;
        }
        console.error(`   ⚠️ Could not activate plan ${planId}: ${err.response?.data?.message || err.message}`);
        return false;
    }
}

async function updateEnvFile(plans) {
    console.log('\n📄 Updating .env file...');
    
    const envPath = path.join(__dirname, '../../.env');
    let envContent = fs.readFileSync(envPath, 'utf8');
    
    const envUpdates = {
        'UNIBEE_CREATOR_MONTHLY_PLAN_ID': plans['cb-creator-plan-Monthly'],
        'UNIBEE_CREATOR_YEARLY_PLAN_ID': plans['cb-creator-plan-Yearly'],
        'UNIBEE_CREATOR_MONTHLY_ADDON_PLAN_ID': plans['cb-creator-addon-plan-Monthly'],
        'UNIBEE_CREATOR_YEARLY_ADDON_PLAN_ID': plans['cb-creator-addon-plan-Yearly'],
        'UNIBEE_CHAMPION_MONTHLY_ADDON_PLAN_ID': plans['cb-champion-addon-plan-Monthly'],
        'UNIBEE_CHAMPION_YEARLY_ADDON_PLAN_ID': plans['cb-champion-addon-plan-Yearly'],
        'UNIBEE_SPECTATOR_PLAN_ID': plans['spectator-free-yearly']
    };
    
    for (const [key, value] of Object.entries(envUpdates)) {
        if (!value) continue;
        
        const regex = new RegExp(`^${key}=.*$`, 'm');
        if (envContent.match(regex)) {
            envContent = envContent.replace(regex, `${key}=${value}`);
            console.log(`   Updated: ${key}=${value}`);
        } else {
            // Add new line before any blank lines at the end
            envContent = envContent.trimEnd() + `\n${key}=${value}`;
            console.log(`   Added: ${key}=${value}`);
        }
    }
    
    fs.writeFileSync(envPath, envContent);
    console.log('✅ .env file updated');
}

async function updateSampleEnvFile(plans) {
    console.log('\n📄 Updating sample.env file...');
    
    const envPath = path.join(__dirname, '../../sample.env');
    
    if (!fs.existsSync(envPath)) {
        console.log('   ⚠️ sample.env not found, skipping');
        return;
    }
    
    let envContent = fs.readFileSync(envPath, 'utf8');
    
    const envUpdates = {
        'UNIBEE_CREATOR_MONTHLY_PLAN_ID': 'your-creator-monthly-plan-id',
        'UNIBEE_CREATOR_YEARLY_PLAN_ID': 'your-creator-yearly-plan-id',
        'UNIBEE_CREATOR_MONTHLY_ADDON_PLAN_ID': 'your-creator-addon-monthly-plan-id',
        'UNIBEE_CREATOR_YEARLY_ADDON_PLAN_ID': 'your-creator-addon-yearly-plan-id',
        'UNIBEE_CHAMPION_MONTHLY_ADDON_PLAN_ID': 'your-champion-addon-monthly-plan-id',
        'UNIBEE_CHAMPION_YEARLY_ADDON_PLAN_ID': 'your-champion-addon-yearly-plan-id',
        'UNIBEE_SPECTATOR_PLAN_ID': 'your-spectator-plan-id'
    };
    
    for (const [key, value] of Object.entries(envUpdates)) {
        const regex = new RegExp(`^${key}=.*$`, 'm');
        if (!envContent.match(regex)) {
            envContent = envContent.trimEnd() + `\n${key}=${value}`;
            console.log(`   Added: ${key}`);
        }
    }
    
    fs.writeFileSync(envPath, envContent);
    console.log('✅ sample.env file updated');
}

async function main() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('            UniBee Plans Setup Script');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    if (!UNIBEE_API_KEY) {
        console.error('❌ UNIBEE_API_KEY not configured');
        process.exit(1);
    }
    
    try {
        // Step 1: Get or create product
        const productId = await getOrCreateProduct();
        
        // Step 2: Create all plans
        console.log('\n📝 Creating plans...');
        
        for (const planConfig of PLANS_CONFIG) {
            const plan = await createPlan(productId, planConfig);
            if (plan) {
                createdPlans[planConfig.externalPlanId] = plan.id;
            }
        }
        
        // Step 3: Activate all plans
        console.log('\n🚀 Activating plans...');
        
        for (const [externalId, planId] of Object.entries(createdPlans)) {
            await activatePlan(planId);
        }
        
        // Step 4: Update .env file
        await updateEnvFile(createdPlans);
        await updateSampleEnvFile(createdPlans);
        
        // Summary
        console.log('\n═══════════════════════════════════════════════════════════');
        console.log('                    SETUP COMPLETE');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('\nCreated Plans:');
        
        for (const [externalId, planId] of Object.entries(createdPlans)) {
            const config = PLANS_CONFIG.find(p => p.externalPlanId === externalId);
            console.log(`  ${config.planName}: ID ${planId}`);
            console.log(`     $${config.amount / 100}/${config.intervalUnit}${config.trialDurationTime > 0 ? ' + ' + config.trialDurationTime + '-day trial' : ''}`);
        }
        
        console.log('\n✅ All plans created and activated!');
        console.log('✅ Environment variables updated!');
        console.log('\nNext steps:');
        console.log('  1. Restart your application to load new env vars');
        console.log('  2. Run the migration script: node helper/migration/chargebee-to-unibee.js');
        
    } catch (err) {
        console.error('\n❌ Setup failed:', err.message);
        process.exit(1);
    }
}

main();
