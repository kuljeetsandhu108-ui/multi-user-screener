// ===================================================================
// FINAL, VERIFIED & COMPLETE: /api/market-data.js
// ===================================================================
const { SmartAPI } = require("smartapi-javascript");
const { TOTP } = require("otpauth");
const fetch = require('node-fetch');

let instrumentCache = null;

const getTodayDateStr = () => {
    const d = new Date();
    const offset = d.getTimezoneOffset() * 60000;
    const istOffset = 330 * 60000;
    const istTime = new Date(d.getTime() + offset + istOffset);
    return `${istTime.getFullYear()}-${String(istTime.getMonth() + 1).padStart(2, '0')}-${String(istTime.getDate()).padStart(2, '0')} 15:30`;
};

const getPastDateStr = (daysAgo) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    const offset = d.getTimezoneOffset() * 60000;
    const istOffset = 330 * 60000;
    const istTime = new Date(d.getTime() + offset + istOffset);
    return `${istTime.getFullYear()}-${String(istTime.getMonth() + 1).padStart(2, '0')}-${String(istTime.getDate()).padStart(2, '0')} 09:15`;
};

module.exports = async (request, response) => {
    try {
        const { ticker } = request.query;
        if (!ticker) throw new Error('Ticker symbol is required');

        let fullTicker = ticker.toUpperCase();
        if (!fullTicker.includes('-')) {
            fullTicker += '-NSE';
        }

        const tradingSymbol = fullTicker.split('-')[0];
        const exchange = fullTicker.split('-')[1] || 'NSE';
        
        const smart_api = new SmartAPI({ api_key: process.env.ANGEL_API_KEY });
        
        let totp = new TOTP({ 
            issuer: "AngelOne", 
            label: "SmartAPI", 
            algorithm: "SHA1", 
            digits: 6, 
            period: 30, 
            secret: process.env.ANGEL_TOTP_SECRET 
        });
        let generatedToken = totp.generate();

        const session = await smart_api.generateSession(process.env.ANGEL_CLIENT_ID, process.env.ANGEL_MPIN, generatedToken);

        if (!session || !session.data || !session.data.jwtToken) {
            throw new Error("Login failed. Please check credentials in Vercel. API Message: " + (session.message || "Unknown login error"));
        }
        
        const jwtToken = session.data.jwtToken;

        if (!instrumentCache) {
            const res = await fetch('https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json');
            if (!res.ok) throw new Error('Failed to download instrument list.');
            instrumentCache = await res.json();
        }
        if (!Array.isArray(instrumentCache)) {
            throw new Error('Instrument list is not valid.');
        }
        
        const instrument = instrumentCache.find(i => i.symbol.startsWith(tradingSymbol) && i.exch_seg === exchange && (i.instrumenttype === "" || i.instrumenttype === "AMX" || i.instrumenttype === "ACC"));
        if (!instrument) {
            throw new Error(`Symbol token not found for ${ticker}`);
        }
        const symbolToken = instrument.token;
        
        const [quoteRes, historyRes] = await Promise.all([
            fetch('https://apiconnect.angelbroking.com/rest/secure/angelbroking/market/v1/quote/', {
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
                body: JSON.stringify({ "mode": "FULL", "exchangeTokens": { [exchange]: [symbolToken] } })
            }),
            smart_api.getCandleData({ "exchange": exchange, "symboltoken": symbolToken, "interval": "ONE_DAY", "fromdate": getPastDateStr(365), "todate": getTodayDateStr() })
        ]);

        const quoteData = await quoteRes.json();
        if (quoteData.status === false || !quoteData.data) {
            throw new Error(quoteData.message || "Invalid quote data from Angel One.");
        }
        const stockInfo = quoteData.data.fetched[0];
        const candles = historyRes.data || [];
        const history = candles.map(c => ({ time: c[0].split('T')[0], open: c[1], high: c[2], low: c[3], close: c[4] }));
        
        const responseData = {
            name: stockInfo.tradingSymbol,
            ticker: `${stockInfo.tradingSymbol}-${stockInfo.exchange}`,
            price: stockInfo.ltp,
            change: stockInfo.change,
            changePct: stockInfo.percChange,
            open: stockInfo.open,
            high: stockInfo.high,
            low: stockInfo.low,
            close: stockInfo.close,
            volume: stockInfo.tradeVolume,
            history
        };
        
        response.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate');
        return response.status(200).json(responseData);

    } catch (error) {
        console.error("MARKET DATA ERROR:", error);
        return response.status(500).json({ error: 'Failed to fetch market data.', details: error.message });
    }
};