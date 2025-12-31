# ChargeBee to UniBee Migration - Final Checklist

## ✅ CODE CHANGES (100% COMPLETE)

### Core Integration
- ✅ **src/helper/unibee.js** - Complete UniBee API wrapper (~1025 lines)
  - All ChargeBee functions replicated
  - $0 pricing bug fixed (fetches plan details)
  - Trial date calculation fixed (14-day trial from plan config)
  - Coupon/discount support added
  - Webhook signature verification

- ✅ **src/helper/billingProvider.js** - Abstraction layer
  - Runtime provider switching via BILLING_PROVIDER env var
  - Exports all billing functions
  - getPlanIds() for provider-specific plan IDs

- ✅ **Models Updated**
  - `src/common/models/subscription.js` - Uses billingProvider
  - `src/common/models/user.js` - Uses billingProvider
  - `src/common/models/chargebee-coupon.js` - Supports both providers

- ✅ **Webhook Implementation** - `src/server/boot/customRoutes/index.js`
  - Unified `/webhook` endpoint (auto-detects provider)
  - UniBee-specific `/webhook/unibee` endpoint
  - Full event handling (subscription.*, payment.*, invoice.*)
  - Signature verification support

### Migration Scripts
- ✅ `src/helper/migration/chargebee-to-unibee.js` - Data migration
- ✅ `src/helper/migration/setup-unibee-plans.js` - Plan creation
- ✅ `src/helper/migration/migrate-coupons.js` - Coupon migration
- ✅ `src/helper/migration/cleanup-unibee.js` - Cleanup utilities

### Fixed Issues
- ✅ $0 Pricing Display (UniBee returns amount:0 during trial)
- ✅ Trial Dates (UniBee's trialEnd was incorrect)
- ✅ Duplicate Customer Error (Error code 51 handling)
- ✅ Status Mapping (pending_activation → in_trial)

---

## 📋 CONFIGURATION REQUIRED

### 1. Environment Variables (.env file)

```bash
# ============ BILLING PROVIDER CONFIGURATION ============
# Set to 'unibee' to use UniBee, 'chargebee' for ChargeBee
BILLING_PROVIDER=unibee

# ============ UNIBEE CONFIGURATION ============
UNIBEE_API_URL=https://api.unibee.dev
UNIBEE_API_KEY=your-unibee-api-key-here
UNIBEE_WEBHOOK_SECRET=your-webhook-secret-here
UNIBEE_GATEWAY_ID=82

# UniBee Plan IDs (Get from UniBee Dashboard)
UNIBEE_SPECTATOR_PLAN_ID=419
UNIBEE_CREATOR_MONTHLY_PLAN_ID=425
UNIBEE_CREATOR_YEARLY_PLAN_ID=424
UNIBEE_CREATOR_FREE_PLAN_ID=
UNIBEE_CREATOR_MONTHLY_ADDON_PLAN_ID=431
UNIBEE_CREATOR_YEARLY_ADDON_PLAN_ID=428
UNIBEE_CHAMPION_MONTHLY_ADDON_PLAN_ID=432
UNIBEE_CHAMPION_YEARLY_ADDON_PLAN_ID=430
```

**Action Items:**
1. ⚠️ Set `UNIBEE_API_KEY` (from UniBee dashboard)
2. ⚠️ Set `UNIBEE_WEBHOOK_SECRET` (generated in UniBee webhook settings)
3. ✅ Plan IDs already configured (419, 424, 425, 428, 430, 431, 432)

---

## 🔗 UNIBEE DASHBOARD SETUP

### 2. Webhook Configuration

**Steps:**
1. Log in to UniBee Dashboard: https://dashboard.unibee.dev
2. Go to **Settings → Webhooks**
3. Click **Add Webhook**
4. Configure:
   ```
   URL: https://your-domain.com/webhook/unibee
   Events: Select all or specific:
     - subscription.created
     - subscription.updated
     - subscription.renewed
     - subscription.cancelled
     - subscription.deleted
     - subscription.paused
     - subscription.resumed
     - payment.success
     - payment.failed
     - invoice.paid
   ```
5. Copy the **Webhook Secret** and add to .env as `UNIBEE_WEBHOOK_SECRET`
6. Test webhook from dashboard

**Alternative URL:** Can also use `/webhook` (unified endpoint)

---

## 🚀 DATA MIGRATION

### 3. Run Migration Scripts

**IMPORTANT:** Run in this exact order:

```bash
# 1. Setup UniBee Plans (if not done)
cd src/helper/migration
node setup-unibee-plans.js

# 2. Migrate Customer Data
node chargebee-to-unibee.js

# 3. Migrate Coupons
node migrate-coupons.js

# 4. Verify migration results
# Check: migration-report-*.json
```

**Pre-Migration Checklist:**
- [ ] Backup MongoDB database
- [ ] Verify UniBee API key is valid
- [ ] Ensure all plan IDs are correct
- [ ] Test with 1-2 customers first
- [ ] Check migration report for errors

---

## 🧪 TESTING

### 4. Verify Integration

**Test Subscription Creation:**
```bash
# Login and get token
curl -X POST http://localhost:3000/api/users/login/user \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password"}'

# Create subscription (use access token)
curl -X POST http://localhost:3000/api/subscriptions/assign-plan \
  -H "Content-Type: application/json" \
  -H "Authorization: YOUR_TOKEN" \
  -d '{"planId":"425"}'

# Verify pricing shows $9 (not $0)
# Verify trial dates show 14-day span
```

**Test Coupon Verification:**
```bash
curl -X POST http://localhost:3000/api/subscriptions/verify-coupon \
  -H "Content-Type: application/json" \
  -H "Authorization: YOUR_TOKEN" \
  -d '{"couponCode":"TESTCODE"}'
```

**Test Webhook:**
```bash
# Trigger test event from UniBee dashboard
# Check server logs for webhook processing
# Verify user status updates in database
```

---

## 📊 MONITORING

### 5. Post-Migration Checks

**Database Verification:**
```javascript
// Check subscription collection
db.subscription.find({ status: { $ne: "deleted" } }).count()

// Check user subscription statuses
db.user.find({ subscriptionStatus: "active" }).count()
db.user.find({ subscriptionStatus: "in_trial" }).count()

// Verify pricing data
db.subscription.find({ amount: 0 })  // Should be empty
```

**Log Monitoring:**
```bash
# Watch for UniBee API errors
tail -f /path/to/logs | grep "UniBee"

# Watch for webhook events
tail -f /path/to/logs | grep "WEBHOOK"
```

---

## ⚙️ SWITCHING PROVIDERS

### 6. Runtime Provider Switching

**To use UniBee:**
```bash
BILLING_PROVIDER=unibee
npm start
```

**To rollback to ChargeBee:**
```bash
BILLING_PROVIDER=chargebee
npm start
```

**Note:** No code changes needed - abstraction layer handles everything!

---

## 🔍 KNOWN ISSUES & SOLUTIONS

### Issue 1: $0 Pricing During Trial
**Status:** ✅ FIXED  
**Solution:** Code fetches plan details to get actual pricing

### Issue 2: Trial Dates Showing Same Day
**Status:** ✅ FIXED  
**Solution:** Calculates from plan's trialDurationTime (14 days)

### Issue 3: Duplicate Customer Error
**Status:** ✅ FIXED  
**Solution:** Catches error code 51, fetches existing customer

---

## 📝 API COMPATIBILITY

### All ChargeBee APIs Replicated in UniBee:

| ChargeBee Function | UniBee Function | Status |
|-------------------|-----------------|--------|
| get_plans | get_plans | ✅ |
| get_champion_plan | get_champion_plan | ✅ |
| create_customer | create_customer | ✅ |
| create_subscription | create_subscription | ✅ |
| update_subscription | update_subscription | ✅ |
| pause_subscription | pause_subscription | ✅ |
| resume_subscription | resume_subscription | ✅ |
| cancel_subscription | cancel_subscription | ✅ |
| delete_subscription | delete_subscription | ✅ |
| create_portal_session | create_portal_session | ✅ |
| verify_coupon | verify_coupon | ✅ |
| apply_discount | apply_discount | ✅ |
| Webhook handling | Webhook handling | ✅ |

---

## ✅ FINAL CHECKLIST

### Pre-Production
- [ ] All environment variables configured
- [ ] UniBee webhook configured and tested
- [ ] Database backup completed
- [ ] Migration scripts executed successfully
- [ ] Test subscriptions created successfully
- [ ] Coupons verified and applied
- [ ] Webhook events processing correctly
- [ ] Pricing displays correctly ($9, not $0)
- [ ] Trial periods show correct dates (14 days)

### Production Deployment
- [ ] Set `BILLING_PROVIDER=unibee` in production .env
- [ ] Update production webhook URL in UniBee
- [ ] Monitor logs for first 24 hours
- [ ] Verify new subscriptions work
- [ ] Test cancellation/pause/resume flows
- [ ] Monitor payment processing
- [ ] Keep ChargeBee as backup (don't delete data yet)

### Post-Production (After 30 Days)
- [ ] Verify all subscriptions migrated successfully
- [ ] Confirm webhook events processing correctly
- [ ] Check revenue reconciliation
- [ ] Can safely deprecate ChargeBee integration

---

## 🆘 ROLLBACK PLAN

If issues occur:
1. Set `BILLING_PROVIDER=chargebee`
2. Restart server
3. System reverts to ChargeBee immediately
4. No data loss - MongoDB unchanged

---

## 📞 SUPPORT

**UniBee Support:**
- Dashboard: https://dashboard.unibee.dev
- Docs: https://docs.unibee.dev
- API: https://api.unibee.dev

**Migration Issues:**
- Check migration reports in `src/helper/migration/`
- Review server logs for errors
- Test with single customer first

---

## 🎉 SUMMARY

**Migration Status:** ✅ **100% COMPLETE**

All code changes, fixes, and features are implemented. Only configuration steps remain:
1. Add UniBee API key to .env
2. Configure webhook in UniBee dashboard
3. Run migration scripts
4. Test and deploy

**Estimated Time to Production:** 1-2 hours (mostly configuration and testing)
