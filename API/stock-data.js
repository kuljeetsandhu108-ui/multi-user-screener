// ===================================================================
// DIAGNOSTIC TEST CODE for /api/stock-data.js
// This code's only purpose is to test the Angel One login.
// ===================================================================
const { SmartAPI } = require("smartapi-javascript");
const { TOTP } = require("totp-generator");

export default async function handler(request, response) {
    
    // We are ignoring the ticker for this test. We are only testing the login.

    try {
        console.log("--- Starting Login Test ---");

        // Step 1: Initialize the SmartAPI object.
        const smart_api = new SmartAPI({
            api_key: process.env.ANGEL_API_KEY,
        });
        console.log("SmartAPI object initialized.");

        // Step 2: Generate the Time-based One Time Password (TOTP).
        const totp = TOTP.generate(process.env.ANGEL_TOTP_SECRET).otp;
        console.log("TOTP generated successfully.");

        // Step 3: Attempt to generate a session (this is the login).
        console.log("Attempting to generate session...");
        const session = await smart_api.generateSession(
            process.env.ANGEL_CLIENT_ID, 
            process.env.ANGEL_PASSWORD,
            totp
        );
        console.log("Session generation was successful!");

        // If we reach this line, the login worked. Send a success message.
        return response.status(200).json({ 
            status: "SUCCESS", 
            message: "Login to Angel One was successful!",
            sessionData: session // This will show us the user data if successful
        });

    } catch (error) {
        // If ANY step above fails, we will end up here.
        console.error("--- LOGIN TEST FAILED ---");
        console.error(error); // This logs the detailed error on the Vercel server.
        
        // Send a clear error message back to the browser.
        return response.status(500).json({ 
            status: "FAILED",
            message: "The login process failed.", 
            details: error.message // This will tell us exactly what went wrong.
        });
    }
}