const jsforce = require('jsforce');
const conn = new jsforce.Connection();

exports.sales_login = () => {
    const username = "tarun.kethwalia@otssolutions.com";
    const password = "otssolutions18";
    const token = "LxSfZRr4Roea0U5YLuMXRgImf";

    conn.login(username, password+token, (err, userInfo) => {
        if (err) {
            console.log(err);
        } else {
            console.log('Salesforce connection successful..!!');
        }
    });
}