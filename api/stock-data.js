// ===================================================================
// FINAL FORMAT FIX for /api/stock-data.js
// This version uses the correct body format for the API request.
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

        const session = await smart_api.generateSession(
            process.env.ANGEL_CLIENT_ID, 
            process.env.ANGEL_MPIN,
            totp
        );

        const jwtToken = session.data.jwtToken;
        const symbolParts = ticker.split('-');
        const tradingSymbol = symbolParts[0];
        const exchange = symbolParts[1];
        
        const quoteAPIEndpoint = 'https://apiconnect.angelbroking.com/rest/secure/angelbroking/market/v1/quote/';
        
        // THE FINAL FORMAT FIX IS HERE:
        // The API expects a different structure inside the body.
        const apiResponse = await fetch(quoteAPIEndpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${jwtToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-UserType': 'USER',
                'X-SourceID': 'WEB',
                'X-ClientLocalIP': '192.168.1.1',
                'X-ClientPublicIP': '103.1.1.1',
                'X-MACAddress': '00:00:00:00:00:00',
                'X-PrivateKey': process.env.ANGEL_API_KEY
            },
            body: JSON.stringify({
                "mode": "FULL", // Changed from "exchange"
                "exchangeTokens": {
                    [exchange]: [tradingSymbol] // Changed structure
                }
            })
        });

        const quoteData = await apiResponse.json();

        if (quoteData.status === false || !quoteData.data) {
             throw new Error(quoteData.message || "Invalid data returned from API.");
        }

        // The data is nested inside the 'fetched' array
        const stockInfo = quoteData.data.fetched[0];

        const formattedData = {
            name: stockInfo.tradingSymbol,
            ticker: `${stockInfo.tradingSymbol}-${stockInfo.exchange}`,
            price: stockInfo.ltp,
            change: stockInfo.change,
            changePct: stockInfo.percChange,
            open: stockInfo.open,
            high: stockInfo.high,
            low: stockInfo.low,
            close: stockInfo.close,
            volume: stockInfo.tradeVolume
        };

        response.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate');
        return response.status(200).json(formattedData);

    } catch (error) {
        console.error("Caught Error:", error); 
        return response.status(500).json({ error: 'Failed to fetch data from Angel One API.', details: error.message });
    }
}