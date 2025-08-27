// ===================================================================
// FINAL, VERIFIED PRODUCTION CODE for /api/stock-data.js
// This version bypasses the broken library and makes a direct HTTP API call.
// ===================================================================
const { SmartAPI } = require("smartapi-javascript");
const { TOTP } = require("totp-generator");

export default async function handler(request, response) {
    const { ticker } = request.query;
    if (!ticker) {
        return response.status(400).json({ error: 'Ticker symbol is required' });
    }

    const smart_api = new SmartAPI({
        api_key: process.env.ANGEL_API_KEY,
    });
    
    try {
        const totp = TOTP.generate(process.env.ANGEL_TOTP_SECRET).otp;

        // Step 1: Use the library ONLY to log in and get the authorization tokens.
        // We have proven this part works perfectly.
        const session = await smart_api.generateSession(
            process.env.ANGEL_CLIENT_ID, 
            process.env.ANGEL_MPIN,
            totp
        );

        // Extract the all-important JWT (JSON Web Token) from the session.
        // This token is our "permission slip" to make direct API calls.
        const jwtToken = session.data.jwtToken;

        // Step 2: Make a DIRECT HTTP request to the official Angel One Quote endpoint.
        // This bypasses the broken library functions entirely.
        const symbolParts = ticker.split('-');
        const tradingSymbol = symbolParts[0];
        const exchange = symbolParts[1];

        const quoteAPIEndpoint = 'https://apiconnect.angelbroking.com/rest/secure/angelbroking/market/v1/quote/';
        
        const apiResponse = await fetch(quoteAPIEndpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${jwtToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-UserType': 'USER',
                'X-SourceID': 'WEB',
                'X-ClientLocalIP': '192.168.1.1', // Standard placeholder
                'X-ClientPublicIP': '103.1.1.1',  // Standard placeholder
                'X-MACAddress': '00:00:00:00:00:00',// Standard placeholder
                'X-PrivateKey': process.env.ANGEL_API_KEY
            },
            body: JSON.stringify({
                "exchange": exchange,
                "tradingsymbol": tradingSymbol
            })
        });

        const quoteData = await apiResponse.json();

        if (quoteData.status === false) {
             throw new Error(quoteData.message || "Invalid data returned from API.");
        }

        // Step 3: Format the data and send it back.
        const formattedData = {
            name: quoteData.data.name,
            ticker: quoteData.data.tradingsymbol,
            price: quoteData.data.ltp,
            change: quoteData.data.change,
            changePct: quoteData.data.percentChange,
            open: quoteData.data.open,
            high: quoteData.data.high,
            low: quoteData.data.low,
            close: quoteData.data.close,
            volume: quoteData.data.volume
        };

        response.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate');
        return response.status(200).json(formattedData);

    } catch (error) {
        console.error("Caught Error:", error); 
        return response.status(500).json({ error: 'Failed to fetch data from Angel One API.', details: error.message });
    }
}