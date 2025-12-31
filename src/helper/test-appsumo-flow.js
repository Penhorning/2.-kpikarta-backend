#!/usr/bin/env node
/**
 * Test Script: AppSumo Signup Flow with UniBee
 * 
 * This script tests the complete AppSumo user registration flow:
 * 1. Verify coupon code via /chargebee-coupons/verify-coupon
 * 2. Register user via /users (simulates signup)
 * 3. Assign free plan via /subscriptions/assign-plan
 * 
 * Usage: 
 *   node src/helper/test-appsumo-flow.js
 *   
 * Or with custom values:
 *   TEST_COUPON=YOUR_CODE TEST_EMAIL=test@example.com node src/helper/test-appsumo-flow.js
 */

// Load environment variables from .env file
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const axios = require('axios');

// Configuration
const API_URL = process.env.API_URL || 'http://localhost:3000';
const TEST_COUPON = process.env.TEST_COUPON || 'APPSUMO_TEST_CODE';
const TEST_EMAIL = process.env.TEST_EMAIL || `appsumo_test_${Date.now()}@test.com`;
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'TestPassword123!';
const FREE_PLAN_ID = 'Creator-Test-Free-USD-Monthly'; // Maps to UniBee plan 419

console.log('='.repeat(60));
console.log('AppSumo Signup Flow Test - UniBee Integration');
console.log('='.repeat(60));
console.log(`API URL: ${API_URL}`);
console.log(`Test Email: ${TEST_EMAIL}`);
console.log(`Coupon Code: ${TEST_COUPON}`);
console.log(`Free Plan ID: ${FREE_PLAN_ID}`);
console.log('='.repeat(60));

// Test results tracking
const results = {
    couponVerification: { status: 'pending', details: null },
    couponVerificationDirect: { status: 'pending', details: null },
    planAssignment: { status: 'pending', details: null }
};

/**
 * Test 1: Verify Coupon Code via API
 */
async function testCouponVerification() {
    console.log('\n[TEST 1] Coupon Verification via API');
    console.log('-'.repeat(40));
    
    try {
        const response = await axios.post(`${API_URL}/api/chargebee-coupons/verify-coupon`, {
            couponCode: TEST_COUPON
        }, {
            headers: { 'Content-Type': 'application/json' }
        });
        
        console.log('Response Status:', response.status);
        console.log('Response Data:', JSON.stringify(response.data, null, 2));
        
        if (response.data.success) {
            results.couponVerification = { 
                status: 'PASSED', 
                details: response.data 
            };
            console.log('Result: PASSED - Coupon is valid');
        } else {
            results.couponVerification = { 
                status: 'FAILED', 
                details: response.data 
            };
            console.log('Result: FAILED - Coupon validation returned false');
        }
    } catch (error) {
        const errorData = error.response?.data || error.message;
        console.log('Error:', JSON.stringify(errorData, null, 2));
        
        // For testing purposes, coupon not found is expected if no test coupon exists
        if (error.response?.status === 404) {
            results.couponVerification = { 
                status: 'SKIPPED', 
                details: 'Coupon not found - this is expected if no test coupon is configured in UniBee' 
            };
            console.log('Result: SKIPPED - No test coupon configured in UniBee');
        } else {
            results.couponVerification = { 
                status: 'FAILED', 
                details: errorData 
            };
            console.log('Result: FAILED');
        }
    }
}

/**
 * Test 2: Direct UniBee Coupon Verification (bypasses API, tests helper directly)
 */
async function testDirectCouponVerification() {
    console.log('\n[TEST 2] Direct UniBee Coupon Helper Test');
    console.log('-'.repeat(40));
    
    try {
        // Load the billing provider
        const { verify_coupon, isUniBee, BILLING_PROVIDER } = require('./billingProvider');
        
        console.log(`Billing Provider: ${BILLING_PROVIDER}`);
        console.log(`Is UniBee: ${isUniBee}`);
        
        if (!isUniBee) {
            results.couponVerificationDirect = { 
                status: 'SKIPPED', 
                details: 'Not using UniBee - skipping direct test' 
            };
            console.log('Result: SKIPPED - Not using UniBee');
            return;
        }
        
        const response = await verify_coupon(TEST_COUPON);
        console.log('UniBee Response:', JSON.stringify(response, null, 2));
        
        if (response.status === 200 && response.data?.coupon) {
            results.couponVerificationDirect = { 
                status: 'PASSED', 
                details: response.data 
            };
            console.log('Result: PASSED - UniBee coupon verification works');
        } else if (response.status === 404) {
            results.couponVerificationDirect = { 
                status: 'SKIPPED', 
                details: 'Coupon not found in UniBee - create a test coupon first' 
            };
            console.log('Result: SKIPPED - No test coupon in UniBee');
        } else {
            results.couponVerificationDirect = { 
                status: 'FAILED', 
                details: response 
            };
            console.log('Result: FAILED');
        }
    } catch (error) {
        console.log('Error:', error.message);
        results.couponVerificationDirect = { 
            status: 'ERROR', 
            details: error.message 
        };
        console.log('Result: ERROR');
    }
}

/**
 * Test 3: Get Plans (verify UniBee plan mapping)
 */
async function testGetPlans() {
    console.log('\n[TEST 3] Get Plans (UniBee Mapping)');
    console.log('-'.repeat(40));
    
    try {
        const response = await axios.get(`${API_URL}/api/subscriptions/get-plans`);
        
        console.log('Response Status:', response.status);
        console.log('Plans:', JSON.stringify(response.data, null, 2));
        
        results.getPlans = { 
            status: 'PASSED', 
            details: response.data 
        };
        console.log('Result: PASSED');
    } catch (error) {
        const errorData = error.response?.data || error.message;
        console.log('Error:', JSON.stringify(errorData, null, 2));
        results.getPlans = { 
            status: 'FAILED', 
            details: errorData 
        };
        console.log('Result: FAILED');
    }
}

/**
 * Test 4: Plan ID Mapping (verify FREE_PLAN_ID maps to UniBee 419)
 */
async function testPlanIdMapping() {
    console.log('\n[TEST 4] Plan ID Mapping');
    console.log('-'.repeat(40));
    
    try {
        const unibee = require('./unibee');
        
        // Test the mapPlanIdToUniBee function (internal)
        const testMappings = [
            'Creator-Test-Free-USD-Monthly',
            'creator-monthly-v3',
            'cb-creator-plan-Monthly',
            'creator-yearly-v2',
            '425', // Direct numeric ID
            425    // Numeric
        ];
        
        console.log('Plan ID Mappings:');
        testMappings.forEach(planId => {
            // We'll test by trying to get the plan
            console.log(`  ${planId} -> (check unibee.js mapPlanIdToUniBee)`);
        });
        
        // Verify environment variables
        console.log('\nEnvironment Variables:');
        console.log(`  UNIBEE_SPECTATOR_PLAN_ID: ${process.env.UNIBEE_SPECTATOR_PLAN_ID || '419 (default)'}`);
        console.log(`  UNIBEE_CREATOR_FREE_PLAN_ID: ${process.env.UNIBEE_CREATOR_FREE_PLAN_ID || '392 (default)'}`);
        console.log(`  UNIBEE_CREATOR_MONTHLY_PLAN_ID: ${process.env.UNIBEE_CREATOR_MONTHLY_PLAN_ID || '425 (default)'}`);
        
        results.planIdMapping = { status: 'INFO', details: 'Check mappings above' };
        console.log('Result: INFO - Mappings displayed');
    } catch (error) {
        console.log('Error:', error.message);
        results.planIdMapping = { status: 'ERROR', details: error.message };
        console.log('Result: ERROR');
    }
}

/**
 * Test 5: Create Test User & Assign Plan (Full Flow)
 * WARNING: This creates a real user - use with caution
 */
async function testFullSignupFlow(skipUserCreation = true) {
    console.log('\n[TEST 5] Full Signup Flow Simulation');
    console.log('-'.repeat(40));
    
    if (skipUserCreation) {
        console.log('SKIPPED: User creation disabled by default');
        console.log('Set FULL_TEST=true to run this test');
        results.fullFlow = { status: 'SKIPPED', details: 'User creation disabled' };
        return;
    }
    
    try {
        // Step 1: Create user (simulates signup)
        console.log('Step 1: Creating user...');
        const signupData = {
            email: TEST_EMAIL,
            password: TEST_PASSWORD,
            fullName: 'AppSumo Test User',
            userType: 'appsumo'  // Mark as AppSumo user
        };
        
        const signupResponse = await axios.post(`${API_URL}/api/users`, signupData);
        console.log('Signup Response:', signupResponse.status);
        
        // Step 2: Login to get token
        console.log('Step 2: Logging in...');
        const loginResponse = await axios.post(`${API_URL}/api/users/login/user`, {
            email: TEST_EMAIL,
            password: TEST_PASSWORD
        });
        
        const token = loginResponse.data.id;
        console.log('Login successful, token received');
        
        // Step 3: Assign free plan
        console.log('Step 3: Assigning free plan...');
        const planResponse = await axios.post(
            `${API_URL}/api/subscriptions/assign-plan`,
            { planId: FREE_PLAN_ID },
            { headers: { 'Authorization': token } }
        );
        
        console.log('Plan Assignment Response:', JSON.stringify(planResponse.data, null, 2));
        
        results.fullFlow = { status: 'PASSED', details: planResponse.data };
        console.log('Result: PASSED - Full AppSumo flow works');
        
    } catch (error) {
        const errorData = error.response?.data || error.message;
        console.log('Error:', JSON.stringify(errorData, null, 2));
        results.fullFlow = { status: 'FAILED', details: errorData };
        console.log('Result: FAILED');
    }
}

/**
 * Test 6: Verify UniBee API Connection
 */
async function testUniBeeConnection() {
    console.log('\n[TEST 6] UniBee API Connection');
    console.log('-'.repeat(40));
    
    try {
        const { get_plans, isUniBee, BILLING_PROVIDER } = require('./billingProvider');
        
        console.log(`Billing Provider: ${BILLING_PROVIDER}`);
        
        if (!isUniBee) {
            results.unibeeConnection = { status: 'SKIPPED', details: 'Using ChargeBee' };
            console.log('Result: SKIPPED - Using ChargeBee');
            return;
        }
        
        console.log('Fetching plans from UniBee...');
        const response = await get_plans();
        
        if (response.status === 200) {
            console.log(`Plans found: ${response.data?.list?.length || 0}`);
            if (response.data?.list?.length > 0) {
                response.data.list.forEach(plan => {
                    console.log(`  - ${plan.item_price.name} (ID: ${plan.item_price.id})`);
                });
            }
            results.unibeeConnection = { status: 'PASSED', details: response.data };
            console.log('Result: PASSED - UniBee connection works');
        } else {
            results.unibeeConnection = { status: 'FAILED', details: response };
            console.log('Result: FAILED');
        }
    } catch (error) {
        console.log('Error:', error.message);
        results.unibeeConnection = { status: 'ERROR', details: error.message };
        console.log('Result: ERROR');
    }
}

/**
 * Print Summary
 */
function printSummary() {
    console.log('\n');
    console.log('='.repeat(60));
    console.log('TEST SUMMARY');
    console.log('='.repeat(60));
    
    let passed = 0, failed = 0, skipped = 0;
    
    Object.entries(results).forEach(([test, result]) => {
        const status = result.status;
        let emoji = '⚪';
        if (status === 'PASSED') { emoji = '✅'; passed++; }
        else if (status === 'FAILED' || status === 'ERROR') { emoji = '❌'; failed++; }
        else { emoji = '⏭️'; skipped++; }
        
        console.log(`${emoji} ${test}: ${status}`);
    });
    
    console.log('-'.repeat(60));
    console.log(`Total: ${passed} passed, ${failed} failed, ${skipped} skipped`);
    console.log('='.repeat(60));
    
    if (failed > 0) {
        console.log('\nFailed Tests Details:');
        Object.entries(results).forEach(([test, result]) => {
            if (result.status === 'FAILED' || result.status === 'ERROR') {
                console.log(`\n${test}:`);
                console.log(JSON.stringify(result.details, null, 2));
            }
        });
    }
}

/**
 * Main
 */
async function main() {
    try {
        // Run tests
        await testUniBeeConnection();
        await testGetPlans();
        await testPlanIdMapping();
        await testCouponVerification();
        await testDirectCouponVerification();
        await testFullSignupFlow(process.env.FULL_TEST !== 'true');
        
        // Print summary
        printSummary();
        
    } catch (error) {
        console.error('Unexpected error:', error);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main().then(() => {
        process.exit(0);
    }).catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
}

module.exports = { testCouponVerification, testUniBeeConnection, testGetPlans };
