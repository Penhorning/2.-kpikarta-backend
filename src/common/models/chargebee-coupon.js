module.exports = function (Chargebeecoupon) {
    // Billing provider abstraction layer
    const { verify_coupon, isUniBee, BILLING_PROVIDER } = require('../../helper/billingProvider');
    
    // ChargeBee SDK for legacy support (only load if using ChargeBee)
    let chargebee;
    if (!isUniBee) {
        chargebee = require('chargebee');
        // Configure Chargebee - Use environment variable instead of hardcoded key
        chargebee.configure({
            site: process.env.CHARGEBEE_SITE_NAME || 'kpikarta',
            api_key: process.env.CHARGEBEE_API_KEY || 'live_VvgLECrZ2S2Q1tR5Z4FCapuGm8Soxyrz'
        });
    }

    // Method to verify a coupon code - supports both ChargeBee and UniBee
    Chargebeecoupon.verifyCoupon = function (data, cb) {
        const couponCode = data.couponCode;

        if (!couponCode || couponCode.trim() === '') {
            return cb({
                success: false,
                message: 'Coupon code is required',
                statusCode: 400
            });
        }

        console.log(`Verifying Coupon Code: ${couponCode} using ${BILLING_PROVIDER}`);

        // Use UniBee verification if UniBee is the billing provider
        if (isUniBee) {
            // Call async function and handle promise
            Chargebeecoupon.verifyUniBee(couponCode)
                .then(result => cb(null, result))
                .catch(err => cb(err));
            return;
        }

        // Otherwise, use ChargeBee verification
        return Chargebeecoupon.verifyChargeBee(couponCode, cb);
    };

    // UniBee coupon verification (returns Promise, not callback)
    // Supports both regular discounts and advanced discounts (with quantity limits like AppSumo)
    Chargebeecoupon.verifyUniBee = async function (couponCode) {
        const response = await verify_coupon(couponCode.trim());
        
        if (response.status === 200 && response.data.coupon) {
            const coupon = response.data.coupon;
            
            // Return response compatible with both regular coupons and AppSumo-style coupon codes
            return {
                success: true,
                message: 'Valid coupon code.',
                statusCode: 200,
                data: {
                    id: coupon.id,
                    code: coupon.code,
                    name: coupon.name,
                    discount_type: coupon.discount_type,
                    discount_percentage: coupon.discount_percentage,
                    discount_amount: coupon.discount_amount,
                    status: coupon.status,
                    // Advanced discount info (for AppSumo-like limited quantity codes)
                    is_advanced: coupon.is_advanced,
                    quantity: coupon.quantity,
                    quantity_used: coupon.quantity_used,
                    live_quantity: coupon.live_quantity,
                    // UniBee specific data
                    _unibee: coupon._unibee
                },
                // For AppSumo flow compatibility - include couponCodeDetails like ChargeBee
                couponCodeDetails: response.data.couponCodeDetails
            };
        } else {
            const error = new Error(response.data?.message || 'Invalid or expired coupon code.');
            error.statusCode = response.status || 404;
            error.success = false;
            throw error;
        }
    };

    // ChargeBee coupon verification (legacy)
    Chargebeecoupon.verifyChargeBee = function (couponCode, cb) {
        console.log("Verifying coupon in ChargeBee:", couponCode);

        // First, try to verify the coupon in the normal coupon list
        chargebee.coupon.retrieve(couponCode.trim()).request((error, result) => {
            if (error) {
                // If the coupon is not found in the normal coupon list, check the coupon code in coupon sets
                if (error.api_error_code === 'resource_not_found') {
                    console.log("Coupon not found in normal coupons, checking in coupon sets.");
                    return Chargebeecoupon.validateCouponCode(couponCode, cb); // Fallback to coupon sets validation
                } else {
                    return cb({
                        success: false,
                        message: 'Error validating coupon',
                        error: error.message,
                        statusCode: error.http_status_code || 500
                    });
                }
            }

            const coupon = result.coupon;
            console.log("Coupon found in normal coupon list:", coupon);

            // If the coupon is found and valid, return its details
            return cb(null, {
                success: true,
                message: 'Valid coupon code in normal coupon list.',
                statusCode: 200,
                data: {
                    id: coupon.id,
                    name: coupon.name,
                    discount_type: coupon.discount_type,
                    discount_percentage: coupon.discount_percentage,
                    discount_amount: coupon.discount_amount,
                    duration_type: coupon.duration_type,
                    status: coupon.status,
                    apply_on: coupon.apply_on
                }
            });
        });
    };

    // Fallback method to validate coupon codes in coupon sets if it's not found in normal coupons (ChargeBee only)
    Chargebeecoupon.validateCouponCode = function (couponCode, cb) {
        console.log("Validating coupon code in coupon sets: ", couponCode);

        // Check if the coupon code exists in Chargebee's coupon sets
        chargebee.coupon_code.retrieve(couponCode).request((error, result) => {
            if (error) {
                console.log("Error validating coupon code in coupon sets:", error);
                return cb({
                    success: false,
                    message: 'Invalid or expired coupon code.',
                    error: error.message,
                    statusCode: error.http_status_code || 500
                });
            }

            // Debug: Log the response for better visibility
            console.log("Coupon Code Details from coupon sets:", result.coupon_code);

            const couponCodeDetails = result.coupon_code;

            // Check if the coupon code is valid (not redeemed, not expired)
            if (!couponCodeDetails) {
                console.log(`Coupon code ${couponCode} does not exist in coupon sets.`);
                return cb({
                    success: false,
                    message: `Coupon code ${couponCode} is invalid or does not exist in coupon sets.`,
                    statusCode: 404
                });
            }

            // Check the status of the coupon code
            if (couponCodeDetails.status === 'not_redeemed') {
                console.log(`Coupon code ${couponCode} is valid and not redeemed in coupon sets.`);
                return cb(null, {
                    success: true,
                    message: `Coupon code ${couponCode} is valid in coupon sets.`,
                    couponCodeDetails: couponCodeDetails,
                    statusCode: 200
                });
            } else if (couponCodeDetails.status === 'redeemed') {
                console.log(`Coupon code ${couponCode} has already been redeemed.`);
                return cb({
                    success: false,
                    message: `Coupon code ${couponCode} has already been redeemed.`,
                    statusCode: 400
                });
            } else if (couponCodeDetails.status === 'expired') {
                console.log(`Coupon code ${couponCode} has expired.`);
                return cb({
                    success: false,
                    message: `Coupon code ${couponCode} has expired.`,
                    statusCode: 400
                });
            } else {
                console.log(`Coupon code ${couponCode} is not valid in coupon sets.`);
                return cb({
                    success: false,
                    message: `Coupon code ${couponCode} is not valid in coupon sets.`,
                    statusCode: 400
                });
            }
        });
    };

    // Remote Method for verifying a coupon code
    Chargebeecoupon.remoteMethod('verifyCoupon', {
        description: 'Verify a coupon code (supports both ChargeBee and UniBee)',
        accepts: [{
            arg: 'data',
            type: 'object',
            required: true,
            http: { source: 'body' },
            description: 'Coupon code data'
        }],
        returns: {
            arg: 'response',
            type: 'object',
            root: true
        },
        http: {
            path: '/verify-coupon',
            verb: 'post'
        }
    });
};
