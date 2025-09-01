const { SmartAPI } = require("smartapi-javascript");
const { TOTP } = require("otpauth");
const fetch = require('node-fetch');
let instrumentCache = null;
const getTodayDateStr = () => { /* ... */ };
const getPastDateStr = (daysAgo) => { /* ... */ };
module.exports = async (request, response) => {
    try {
        const { ticker } = request.query;
        if (!ticker) throw new Error('Ticker required');
        let fullTicker = ticker.toUpperCase();
        if (!fullTicker.includes('-')) fullTicker += '-NSE';
        const tradingSymbol = fullTicker.split('-')[0];
        const exchange = fullTicker.split('-')[1] || 'NSE';
        const smart_api = new SmartAPI({ api_key: process.env.ANGEL_API_KEY });
        let totp = new TOTP({ secret: process.env.ANGEL_TOTP_SECRET });
        const generatedToken = totp.generate();
        const session = await smart_api.generateSession(process.env.ANGEL_CLIENT_ID, process.env.ANGEL_MPIN, generatedToken);
        if (!session.data) throw new Error("Login failed. Check credentials.");
        const jwtToken = session.data.jwtToken;
        if (!instrumentCache) {
            const res = await fetch('https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json');
            instrumentCache = await res.json();
        }
        const instrument = instrumentCache.find(i => i.symbol.startsWith(tradingSymbol) && i.exch_seg === exchange && (i.instrumenttype === "" || i.instrumenttype === "AMX" || i.instrumenttype === "ACC"));
        if (!instrument) throw new Error(`Token not found for ${ticker}`);
        const symbolToken = instrument.token;
        const [quoteRes, historyRes] = await Promise.all([
            fetch('https://apiconnect.angelbroking.com/rest/secure/angelbroking/market/v1/quote/', { method: 'POST', headers: { 'Authorization': `Bearer ${jwtToken}`, 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-UserType': 'USER', 'X-SourceID': 'WEB', 'X-ClientLocalIP': '192.168.1.1', 'X-ClientPublicIP': '103.1.1.1', 'X-MACAddress': '00:00:00:00:00:00', 'X-PrivateKey': process.env.ANGEL_API_KEY }, body: JSON.stringify({ "mode": "FULL", "exchangeTokens": { [exchange]: [symbolToken] } }) }),
            smart_api.getCandleData({ "exchange": exchange, "symboltoken": symbolToken, "interval": "ONE_DAY", "fromdate": getPastDateStr(365), "todate": getTodayDateStr() })
        ]);
        const quoteData = await quoteRes.json();
        if (!quoteData.data) throw new Error(quoteData.message);
        const stockInfo = quoteData.data.fetched[0];
        const candles = historyRes.data || [];
        const history = candles.map(c => ({ time: c[0].split('T')[0], open: c[1], high: c[2], low: c[3], close: c[4] }));
        const responseData = { name: stockInfo.tradingSymbol, ticker: `${stockInfo.tradingSymbol}-${stockInfo.exchange}`, price: stockInfo.ltp, change: stockInfo.change, changePct: stockInfo.percChange, open: stockInfo.open, high: stockInfo.high, low: stockInfo.low, close: stockInfo.close, volume: stockInfo.tradeVolume, history };
        return response.status(200).json(responseData);
    } catch (error) {
        return response.status(500).json({ details: error.message });
    }
};