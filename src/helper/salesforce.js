const jsforce = require('jsforce');
const conn = new jsforce.Connection();
const moment = require('moment');
const salesForceInfo = {
    username: process.env.SALESFORCE_USERNAME,
    password: process.env.SALESFORCE_PASSWORD,
    token: process.env.SALESFORCE_TOKEN,
    contactModel: "Contact",
    userModel: "KPIUser__c",
    userLoginModel: "KPIUserLogin__c",
    kartaModel: "KPIKarta__c",
}

const salesForceModels = {
    fullName: "Name",
    userName: "Name",
    mobile: "MobilePhone",
    mobileVerified: "MobileVerified__c",
    _2faEnabled: "TwoFAVerified__c",
    emailVerified: "UserVerified__c",
    email: "Email",
    createdAt: "RegistrationDate__c",
    userUpdatedAt: "UserLastUpdated__c",
    companyName: "CompanyName__c",
    designation: "Designation__c",
    department: "Department",
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

exports.sales_user_details = async (user) => {
    try {
        let mobile = user.mobile ? user.mobile.e164Number.split(user.mobile.dialCode).join("") : ( user.__data.mobile ? user.__data.mobile.e164Number.split(user.__data.mobile.dialCode).join("") : null);
        let userObject = {
            FullName__c: user.fullName || user.userName || user.__data.fullName || user.__data.userName || "-",
            LastName: user.fullName || user.userName || user.__data.fullName || user.__data.userName || "-",
            MobilePhone: mobile || "-",
            MobileVerified__c: user.mobileVerified || user.__data.mobileVerified || "-",
            TwoFAVerified__c: user._2faEnabled || user.__data._2faEnabled || "-",
            Email: user.email || user.__data.email || "-",
            UserVerified__c: user.emailVerified || user.__data.emailVerified || "false",
            RegistrationDate__c: moment(user.createdAt).format('DD/MM/YYYY, HH:mm A') || moment(user.__data.createdAt).format('DD/MM/YYYY, HH:mm A'),
            UserLastUpdated__c: moment(user.updatedAt).format('DD/MM/YYYY, HH:mm A') || moment(user.__data.updatedAt).format('DD/MM/YYYY, HH:mm A'),
            CompanyName__c: user.companyName || "-",
            Designation__c: user.role || "-",
            Department: user.department || "-",
            License__c: user.license || user.__data.license || "-",
            Address__c: user.address || "-"
        }
        const ret = await conn.sobject(salesForceInfo.contactModel).insert( userObject );
        if (!ret.success) {
            return false;
        }
        return ret;
    } catch (err) {
        console.log(err);
        return err;
    }
}

exports.sales_update_user = (user, data) => {
    try {
        let timeValues = ["createdAt", "updatedAt", "kartaLastUpdate", "userUpdatedAt"];
        let updateObj = {
            Id : user.sforceId,
        };
        Object.keys(data).forEach(key => {
            if (salesForceModels[key]) {
                updateObj[salesForceModels[key]] = timeValues.includes(key) ? moment(data[key]).format('DD/MM/YYYY, HH:mm A') : data[key];
            }
        })
        conn.sobject(salesForceInfo.contactModel).update( updateObj , function(err, ret) {
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

exports.sales_delete_user = (sforceId) => {
    try {
        conn.sobject(salesForceInfo.contactModel).destroy(sforceId, function(err, ret) {
            if (err || !ret.success) { 
                return console.error(err, ret); 
            }
            return ret;
        });
    } catch (err) {
        console.log(err);
        return err;
    }
}