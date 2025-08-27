// ===================================================================
// FINAL CODE - "type": "module" COMPATIBLE VERSION
// ===================================================================
import { SmartAPI } from "smartapi-javascript";
import { TOTP } from "totp-generator";
import fetch from 'node-fetch'; // Modern import syntax

// In-memory cache to store symbol tokens for speed
const tokenCache = new Map();

export default async function handler(request, response) {
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

        // Dynamic Symbol Token Lookup
        if (tokenCache.has(ticker)) {
            symbolToken = tokenCache.get(ticker);
        } else {
            const instrumentListUrl = 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';
            const instrumentResponse = await fetch(instrumentListUrl);
            const instruments = await instrumentResponse.json();
            
            const instrument = instruments.find(inst => inst.symbol === tradingSymbol && inst.exch_seg === exchange);

            if (!instrument) {
                throw new Error(`Symbol token not found for ${ticker}`);
            }
            symbolToken = instrument.token;
            tokenCache.set(ticker, symbolToken);
        }

        // Fetch the full quote using the correct Symbol Token
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