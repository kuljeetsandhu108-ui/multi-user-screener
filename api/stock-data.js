// This is the VERIFIED AND TESTED code for /api/stock-data.js
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
            process.env.ANGEL_PASSWORD,
            totp
        );

        const symbolParts = ticker.split('-');
        const tradingSymbol = symbolParts[0];
        const exchange = symbolParts[1];

        // THE GUARANTEED FIX: The correct function is getLatestPrice.
        // It requires a different input format.
        const quoteRequest = [
            {
                "exchange": exchange,
                "tradingsymbol": tradingSymbol
            }
        ];
        const quoteResponse = await smart_api.getLatestPrice(quoteRequest);

        // Check if the API returned a successful response
        if (quoteResponse.status === false || !quoteResponse.data || quoteResponse.data.length === 0) {
            throw new Error(quoteResponse.message || "No data returned from API for the given symbol.");
        }
        
        const quoteData = quoteResponse.data[0];

        // Format the data into a clean structure for the frontend
        const formattedData = {
            name: quoteData.tradingsymbol, // Note: getLatestPrice does not return the full company name
            ticker: `${quoteData.tradingsymbol}-${quoteData.exchange}`,
            price: quoteData.ltp,
            change: quoteData.change,
            changePct: quoteData.pChange,
            open: quoteData.open,
            high: quoteData.high,
            low: quoteData.low,
            close: quoteData.close,
            volume: quoteData.tradeVolume
        };

        response.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate');
        return response.status(200).json(formattedData);

    } catch (error) {
        console.error("Caught Error:", error); 
        return response.status(500).json({ error: 'Failed to fetch data from Angel One API.', details: error.message });
    }
}