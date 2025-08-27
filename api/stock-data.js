// This is the FINAL corrected code for /api/stock-data.js
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

        // THE FINAL FIX IS HERE: The correct function is getQuote.
        // It also does not need a symboltoken, making it much simpler.
        const quoteRequest = {
            "exchange": exchange,
            "tradingsymbol": tradingSymbol
        };
        const quote = await smart_api.getQuote(quoteRequest);
        
        // Format the data into a clean structure for the frontend
        const formattedData = {
            name: quote.data.name,
            ticker: quote.data.tradingsymbol,
            price: quote.data.ltp,
            change: quote.data.change,
            changePct: quote.data.percentChange,
            open: quote.data.open,
            high: quote.data.high,
            low: quote.data.low,
            close: quote.data.close,
            volume: quote.data.volume
        };

        response.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate');
        return response.status(200).json(formattedData);

    } catch (error) {
        console.error(error); // This will show detailed errors in the Vercel logs
        return response.status(500).json({ error: 'Failed to fetch data from Angel One API.', details: error.message });
    }
}