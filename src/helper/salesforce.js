const jsforce = require('jsforce');
const conn = new jsforce.Connection();
const moment = require('moment');
const salesForceInfo = {
    username: "tarun.kethwalia@otssolutions.com",
    password: "otssolutions18",
    token: "LxSfZRr4Roea0U5YLuMXRgImf",
    userModel: "KPIUser__c",
    userLoginModel: "KPIUserLogin__c",
    kartaModel: "KPIKarta__c",
}

const salesForceModels = {
    fullName: "Name",
    userName: "Name",
    mobile: "Mobile__c",
    mobileVerified: "MobileVerified__c",
    _2faEnabled: "TwoFAVerified__c",
    emailVerified: "UserVerified__c",
    email: "Email__c",
    createdAt: "RegistrationDate__c",
    userUpdatedAt: "UserLastUpdated__c",
    companyName: "CompanyName__c",
    designation: "Designation__c",
    department: "Department__c",
    licenseType: "License__c",
    address: "Address__c",
    userLastLogin: "LastLogin__c",
    activeKarta: "ActiveKarta__c",
    deleteKarta: "DeletedKarta__c",
    kartaLastUpdate: "KartaLastUpdated__c"
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
        const ret = await conn.sobject(salesForceInfo.userModel).insert( userObject );
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
        conn.sobject(salesForceInfo.userModel).update( updateObj , function(err, ret) {
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

exports.sales_last_login = async (user) => {
    try {
        let createObj = {
            Name: user.fullName || user.name,
            UserId__c : user.id || user.userId,
            LastLogin__c : moment().format('YYYY-MM-DD, HH:mm:ss'),
        };

        const ret = await conn.sobject(salesForceInfo.userLoginModel).insert( createObj );
        if (!ret.success) {
            return false;
        }

        return ret;
    } catch (err) {
        console.log(err);
        return err;
    }
}

exports.sales_karta_details = async (karta) => {
    try {
        let createObj = {
            Name: karta.name,
            KartaId__c : karta.id,
            LastUpdated__c : karta.updatedAt,
            IsActive__c : karta.status,
            IsDeleted__c : karta.is_deleted,
        };

        const ret = await conn.sobject(salesForceInfo.kartaModel).insert( createObj );
        if (!ret.success) {
            return false;
        }

        return ret;
    } catch (err) {
        console.log(err);
        return err;
    }
}

exports.sales_update_karta = (karta_sforceId, upadatedValue) => {
    try {
        let keyValues = {
            updatedAt: "LastUpdated__c",
            status: "IsActive__c",
            is_deleted: "IsDeleted__c",
        };
        let updateObj = {
            Id : karta_sforceId,
        }
        Object.keys(upadatedValue).forEach(key => {
            updateObj[keyValues[key]] = upadatedValue[key];
        });
        
        conn.sobject(salesForceInfo.kartaModel).update( updateObj , function(err, ret) {
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