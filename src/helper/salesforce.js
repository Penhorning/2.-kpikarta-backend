const jsforce = require('jsforce');
const conn = new jsforce.Connection();
const salesForceInfo = {
    username: "tarun.kethwalia@otssolutions.com",
    password: "otssolutions18",
    token: "LxSfZRr4Roea0U5YLuMXRgImf",
    userModelName: "KPIUser__c"
}

exports.sales_login = () => {
    const username = salesForceInfo.username;
    const password = salesForceInfo.password;
    const token = salesForceInfo.token;

    conn.login(username, password+token, (err, userInfo) => {
        if (err) {
            console.log(err);
        } else {
            console.log('[SF] SALESFORCE -> READY');
        }
    });
}

exports.sales_user_details = async (user, companyName) => {
    try {
        let mobile = user.mobile.e164Number.split(user.mobile.dialCode).join("");
        let userObject = {
            Name: user.fullName,
            TwoFAVerified__c: user._2faEnabled,
            RegistrationDate__c: user.createdAt,
            MobileVerified__c: user.mobileVerified,
            Mobile__c: mobile,
            License__c: "Creator",
            LastUpdated__c: user.updatedAt,
            Email__c: user.email,
            Designation__c: "admin",
            CompanyName__c: companyName,
            // Department__c: "",
            // Address__c: ""
        }
        const ret = await conn.sobject(salesForceInfo.userModelName).insert( userObject );
        if (!ret.success) {
            return false;
        }
        return ret;
    } catch (err) {
        console.log(err);
        return err;
    }
}

exports.sales_update_user = (user, type) => {
    try {
        let updateObj = {
            Id : user.sforceId,
        }
        type == "email" ? updateObj["UserVerified__c"] = true : updateObj["LastUpdated__c"] = user.updatedAt;
        conn.sobject(salesForceInfo.userModelName).update( updateObj , function(err, ret) {
            if (err || !ret.success) { 
                console.error(err, ret); 
                return err; 
            }
            return ret;
        });
    } catch (err) {
        console.log(err);
        return err;
    }
}