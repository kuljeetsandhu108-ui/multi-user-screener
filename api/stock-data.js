// This is the code for /api/stock-data.js
const { SmartAPI } = require("smartapi-javascript");
const { TOTP } = require("totp-generator");

// This is the main function that runs when a user makes a request
export default async function handler(request, response) {
    // 1. Get the ticker from the request URL (e.g., ?ticker=SBIN-NSE)
    const { ticker } = request.query;
    if (!ticker) {
        return response.status(400).json({ error: 'Ticker symbol is required' });
    }

    // 2. Initialize the SmartAPI connection using your secret keys
    const smart_api = new SmartAPI({
        api_key: process.env.ANGEL_API_KEY,
    });
    
    try {
        // Generate the Time-based One Time Password (TOTP)
        const totp = TOTP.generate(process.env.ANGEL_TOTP_SECRET).otp;

        // 3. Login to Angel One to get a session
        const session = await smart_api.generateSession(
            process.env.ANGEL_CLIENT_ID, 
            process.env.ANGEL_PASSWORD,
            totp
        );

        // 4. Fetch the real-time quote for the requested stock
        const symbolParts = ticker.split('-');
        const tradingSymbol = symbolParts[0];
        const exchange = symbolParts[1];

        const quoteRequest = {
            "exchange": exchange,
            "tradingsymbol": tradingSymbol
        };
        
        // This is a placeholder for a dynamic token lookup we will build later
        // Angel One's streaming API requires a "symboltoken"
        const symbolToken = "3045"; // Static token for SBIN-NSE for initial testing

        const quote = await smart_api.getLTP({
             "exchange": exchange,
             "tradingsymbol": tradingSymbol,
             "symboltoken": symbolToken
        });
        
        // 5. Format the data and send it back to the frontend
        const formattedData = {
            message: `Data fetched for ${tradingSymbol} using token ${symbolToken}`,
            data: quote.data
        };

        response.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate');
        return response.status(200).json(formattedData);

    } catch (error) {
        console.error(error); // This will show detailed errors in the Vercel logs
        return response.status(500).json({ error: 'Failed to fetch data from Angel One API.', details: error.message });
    }
}