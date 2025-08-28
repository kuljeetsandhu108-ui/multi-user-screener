// This is our local test script: test.js
require('dotenv').config(); // Load the secret keys from the .env file
const { SmartAPI } = require("smartapi-javascript");
const { TOTP } = require("totp-generator");

async function runTest() {
    console.log("--- Starting Local Login Test ---");
    
    // Check if all keys are loaded
    if (!process.env.ANGEL_API_KEY || !process.env.ANGEL_CLIENT_ID || !process.env.ANGEL_MPIN || !process.env.ANGEL_TOTP_SECRET) {
        console.error("ERROR: One or more secret keys are missing from your .env file.");
        return;
    }

    console.log("All secret keys found.");

    try {
        const smart_api = new SmartAPI({
            api_key: process.env.ANGEL_API_KEY,
        });
        
        const totp = TOTP.generate(process.env.ANGEL_TOTP_SECRET).otp;
        console.log(`Generated TOTP: ${totp}`);

        console.log("Attempting to generate session with MPIN...");
        const session = await smart_api.generateSession(
            process.env.ANGEL_CLIENT_ID, 
            process.env.ANGEL_MPIN,
            totp
        );

        console.log("--- SUCCESS! Login Successful! ---");
        console.log("Session Data:", session.data);

        // If login is successful, let's try to get user profile
        console.log("\n--- Attempting to Fetch Profile ---");
        const profile = await smart_api.getProfile();
        console.log("--- SUCCESS! Profile Fetched! ---");
        console.log("Profile Data:", profile.data);

    } catch (error) {
        console.error("\n--- TEST FAILED ---");
        console.error("An error occurred during the test.");
        console.error("Error Details:", error);
    }
}

runTest();