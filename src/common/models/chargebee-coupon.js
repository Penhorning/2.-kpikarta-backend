module.exports = function (Chargebeecoupon) {
    const chargebee = require('chargebee');
    
    // Configure Chargebee
    chargebee.configure({
        site: 'kpikarta',
        api_key: 'live_VvgLECrZ2S2Q1tR5Z4FCapuGm8Soxyrz'
    });

    // Method to verify a coupon code in both normal coupons and coupon sets
    Chargebeecoupon.verifyCoupon = function (data, cb) {
        const couponCode = data.couponCode;

        if (!couponCode || couponCode.trim() === '') {
            return cb({
                success: false,
                message: 'Coupon code is required',
                statusCode: 400
            });
        }

        console.log("Verifying Coupon Code: ", couponCode);

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

    // Fallback method to validate coupon codes in coupon sets if it's not found in normal coupons
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
        description: 'Verify a coupon code (Normal coupon and coupon sets)',
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
