// ===================================================================
// FINAL PRODUCTION CODE with STARTSWITH LOOKUP
// ===================================================================
const { SmartAPI } = require("smartapi-javascript");
const { TOTP } = require("totp-generator");
const fetch = require('node-fetch');

const tokenCache = new Map();

module.exports = async function handler(request, response) {
    const { ticker } = request.query;
    if (!ticker) {
        return response.status(400).json({ error: 'Ticker symbol is required' });
    }

    try {
        const smart_api = new SmartAPI({
            api_key: process.env.ANGEL_API_KEY,
        });
        
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
        
        let symbolToken;

        if (tokenCache.has(ticker)) {
            symbolToken = tokenCache.get(ticker);
        } else {
            const instrumentListUrl = 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';
            const instrumentResponse = await fetch(instrumentListUrl);
            const instruments = await instrumentResponse.json();
            
            // THE FIX IS HERE: Use startsWith to match symbols like "RELIANCE-EQ"
            const instrument = instruments.find(inst => 
                inst.symbol.startsWith(tradingSymbol) && inst.exch_seg === exchange && inst.instrumenttype === ""
            );

            if (!instrument) {
                throw new Error(`Symbol token not found for ${ticker}`);
            }
            symbolToken = instrument.token;
            tokenCache.set(ticker, symbolToken);
        }

        const quoteAPIEndpoint = 'https://apiconnect.angelbroking.com/rest/secure/angelbroking/market/v1/quote/';
        
        const apiResponse = await fetch(quoteAPIEndpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${jwtToken}`, 'Content-Type': 'application/json',
                'Accept': 'application/json', 'X-UserType': 'USER', 'X-SourceID': 'WEB',
                'X-ClientLocalIP': '192.168.1.1', 'X-ClientPublicIP': '103.1.1.1',
                'X-MACAddress': '00:00:00:00:00:00', 'X-PrivateKey': process.env.ANGEL_API_KEY
            },
            body: JSON.stringify({
                "mode": "FULL",
                "exchangeTokens": {
                    [exchange]: [symbolToken]
                }
            })
        });

        const quoteData = await apiResponse.json();

        if (quoteData.status === false || !quoteData.data) {
             throw new Error(quoteData.message || "Invalid data returned from API.");
        }

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