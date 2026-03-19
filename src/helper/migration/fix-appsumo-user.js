/**
 * Fix AppSumo User Subscription
 * 
 * This script fixes AppSumo users who signed up but don't have a subscription
 * (likely due to the race condition bug in verification.component.ts)
 * 
 * Usage: node fix-appsumo-user.js <email>
 * Example: node fix-appsumo-user.js synergylionsmkt@gmail.com
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../sample.env') });

const { MongoClient, ObjectId } = require('mongodb');
const axios = require('axios');

// Configuration
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27018/kpikarta-prod';
const UNIBEE_API_URL = process.env.UNIBEE_API_URL || 'https://api.unibee.dev';
const UNIBEE_API_KEY = process.env.UNIBEE_API_KEY || 'ub_0g1orFzW7dJkk2CjQWZOEN4fa3u7NdKf';
const APPSUMO_PLAN_ID = process.env.UNIBEE_APPSUMO_PLAN_ID || '452';

// Get email from command line
const EMAIL_TO_FIX = process.argv[2];

if (!EMAIL_TO_FIX) {
  console.log('Usage: node fix-appsumo-user.js <email>');
  console.log('Example: node fix-appsumo-user.js synergylionsmkt@gmail.com');
  process.exit(1);
}

// UniBee API helper
const unibeeApi = axios.create({
  baseURL: UNIBEE_API_URL,
  headers: {
    'Authorization': UNIBEE_API_KEY,
    'Content-Type': 'application/json'
  },
  timeout: 30000
});

async function createUnibeeCustomer(user) {
  try {
    console.log(`Creating UniBee customer for ${user.email}...`);
    
    // Use /merchant/user/new endpoint (not /merchant/user/create)
    const response = await unibeeApi.post('/merchant/user/new', {
      email: user.email,
      firstName: user.fullName?.split(' ')[0] || 'AppSumo',
      lastName: user.fullName?.split(' ').slice(1).join(' ') || 'User',
      companyName: user.companyName || 'AppSumo User',
      externalUserId: user.email // Use email as external reference
    });
    
    if (response.data.code === 0) {
      console.log(`✅ Created UniBee customer: ${response.data.data.user.id}`);
      return response.data.data.user;
    } else if (response.data.code === 51) {
      // User already exists, find them
      console.log('Customer already exists, searching...');
      return await findUnibeeCustomer(user.email);
    } else {
      throw new Error(response.data.message || 'Failed to create customer');
    }
  } catch (error) {
    // Check if user already exists (code 51)
    if (error.response?.data?.code === 51) {
      console.log('Customer already exists, searching...');
      return await findUnibeeCustomer(user.email);
    }
    throw error;
  }
}

async function findUnibeeCustomer(email) {
  try {
    // UniBee uses POST for list endpoint with searchKey parameter
    const response = await unibeeApi.post('/merchant/user/list', {
      searchKey: email,
      page: 0,
      count: 10
    });
    
    if (response.data.code === 0 && response.data.data?.userAccounts?.length > 0) {
      // Find exact match
      const exactMatch = response.data.data.userAccounts.find(u => 
        u.email?.toLowerCase() === email.toLowerCase()
      );
      if (exactMatch) {
        console.log(`Found existing UniBee customer: ${exactMatch.id}`);
        return exactMatch;
      }
    }
    return null;
  } catch (error) {
    console.error('Error searching for customer:', error.message);
    return null;
  }
}

async function createUnibeeSubscription(customerId, planId, couponCode) {
  try {
    console.log(`Creating UniBee subscription for customer ${customerId}...`);
    
    // UniBee uses /merchant/subscription/create_submit endpoint
    const data = {
      userId: parseInt(customerId),
      planId: parseInt(planId),
      gatewayId: parseInt(process.env.UNIBEE_GATEWAY_ID) || 82, // Stripe gateway
      quantity: 1,
      returnUrl: process.env.WEB_URL || 'http://localhost:3000'
    };
    
    // Add coupon code if provided (UniBee uses discountCode)
    if (couponCode) {
      data.discountCode = couponCode;
      console.log(`Applying coupon code: ${couponCode}`);
    }
    
    const response = await unibeeApi.post('/merchant/subscription/create_submit', data);
    
    if (response.data.code === 0) {
      const subscription = response.data.data.subscription;
      console.log(`✅ Created UniBee subscription: ${subscription.subscriptionId}`);
      return subscription;
    } else {
      throw new Error(response.data.message || 'Failed to create subscription');
    }
  } catch (error) {
    console.error('Subscription creation error:', error.response?.data || error.message);
    throw error;
  }
}

async function checkExistingSubscription(customerId) {
  try {
    // UniBee uses POST for subscription list with userId parameter
    const response = await unibeeApi.post('/merchant/subscription/list', {
      userId: parseInt(customerId)
    });
    
    if (response.data.code === 0 && response.data.data?.subscriptions?.length > 0) {
      // UniBee status 2 = Active
      const activeSubscription = response.data.data.subscriptions.find(s => 
        s.status === 2 || s.status === 1 // 1 = Pending, 2 = Active
      );
      if (activeSubscription) {
        console.log(`Found existing subscription: ${activeSubscription.subscriptionId} (status: ${activeSubscription.status})`);
        return activeSubscription;
      }
    }
    return null;
  } catch (error) {
    console.error('Error checking subscriptions:', error.message);
    return null;
  }
}

async function fixAppSumoUser() {
  const client = new MongoClient(MONGO_URI);
  
  try {
    await client.connect();
    console.log('Connected to MongoDB\n');
    
    const db = client.db();
    const usersCollection = db.collection('user');
    const subscriptionsCollection = db.collection('subscription');
    const companiesCollection = db.collection('company');
    
    // Find the user
    console.log(`Looking for user: ${EMAIL_TO_FIX}\n`);
    const user = await usersCollection.findOne({ email: EMAIL_TO_FIX });
    
    if (!user) {
      console.log('❌ User not found');
      return;
    }
    
    console.log('=== User Found ===');
    console.log(`  ID: ${user._id}`);
    console.log(`  Email: ${user.email}`);
    console.log(`  Name: ${user.fullName}`);
    console.log(`  Company ID: ${user.companyId}`);
    console.log(`  User Type: ${user.userType}`);
    console.log(`  Subscription Status: ${user.subscriptionStatus}`);
    console.log(`  Subscription ID: ${user.subscriptionId}`);
    console.log(`  Coupon Code: ${user.couponCode}`);
    console.log();
    
    if (user.userType !== 'appsumo') {
      console.log('⚠️  Warning: This user is not an AppSumo user');
    }
    
    // Check if subscription already exists in local DB
    let localSubscription = await subscriptionsCollection.findOne({ 
      $or: [
        { userId: user._id },
        { userId: user._id.toString() },
        { companyId: user.companyId }
      ]
    });
    
    if (localSubscription) {
      console.log('=== Existing Local Subscription ===');
      console.log(`  ID: ${localSubscription._id}`);
      console.log(`  Status: ${localSubscription.status}`);
      console.log(`  Plan ID: ${localSubscription.planId}`);
      console.log(`  UniBee Sub ID: ${localSubscription.subscriptionId}`);
      
      if (localSubscription.status === 'active') {
        // Update user's subscriptionStatus if needed
        if (user.subscriptionStatus !== 'active') {
          console.log('\nUpdating user subscriptionStatus to active...');
          await usersCollection.updateOne(
            { _id: user._id },
            { $set: { subscriptionStatus: 'active', subscriptionId: localSubscription._id } }
          );
          console.log('✅ User subscription status updated');
        } else {
          console.log('\n✅ User already has active subscription');
        }
        return;
      }
    }
    
    // Get company info
    const company = await companiesCollection.findOne({ _id: user.companyId });
    console.log(`Company: ${company?.name || 'Unknown'}\n`);
    
    // Step 1: Create or find UniBee customer
    let unibeeCustomer = await findUnibeeCustomer(user.email);
    if (!unibeeCustomer) {
      unibeeCustomer = await createUnibeeCustomer(user);
    }
    
    if (!unibeeCustomer) {
      console.log('❌ Failed to create/find UniBee customer');
      return;
    }
    
    // Step 2: Check for existing UniBee subscription
    let unibeeSubscription = await checkExistingSubscription(unibeeCustomer.id);
    
    // Step 3: Create subscription if not exists
    if (!unibeeSubscription) {
      unibeeSubscription = await createUnibeeSubscription(
        unibeeCustomer.id,
        APPSUMO_PLAN_ID,
        user.couponCode
      );
    }
    
    if (!unibeeSubscription) {
      console.log('❌ Failed to create UniBee subscription');
      return;
    }
    
    // Step 4: Create local subscription record
    const subscriptionData = {
      userId: user._id,
      companyId: user.companyId,
      customerId: unibeeCustomer.id.toString(),
      planId: APPSUMO_PLAN_ID,
      subscriptionId: unibeeSubscription.subscriptionId,
      amount: 0,
      status: 'active',
      frequency: 'year',
      nextSubscriptionDate: new Date(unibeeSubscription.currentPeriodEnd * 1000),
      trialStart: null,
      trialEnd: null,
      subscriptionDetails: unibeeSubscription,
      billingProvider: 'UniBee',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    console.log('\nCreating local subscription record...');
    const result = await subscriptionsCollection.insertOne(subscriptionData);
    console.log(`✅ Local subscription created: ${result.insertedId}`);
    
    // Step 5: Update user's subscription status
    console.log('\nUpdating user subscription status...');
    await usersCollection.updateOne(
      { _id: user._id },
      { 
        $set: { 
          subscriptionStatus: 'active',
          subscriptionId: result.insertedId
        }
      }
    );
    console.log('✅ User subscription status updated to active');
    
    // Also update all users in the same company
    const companyUsersResult = await usersCollection.updateMany(
      { companyId: user.companyId },
      { $set: { subscriptionStatus: 'active' } }
    );
    console.log(`✅ Updated ${companyUsersResult.modifiedCount} company users to active status`);
    
    console.log('\n========================================');
    console.log('🎉 AppSumo user subscription fixed!');
    console.log('The user can now access the dashboard.');
    console.log('========================================');
    
  } catch (error) {
    console.error('Error:', error.message);
    if (error.response?.data) {
      console.error('API Response:', JSON.stringify(error.response.data, null, 2));
    }
  } finally {
    await client.close();
  }
}

// Run the fix
fixAppSumoUser();
