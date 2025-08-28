// ===================================================================
// FINAL, VERIFIED BACKEND with Advanced Indicators
// ===================================================================
const { SmartAPI } = require("smartapi-javascript");
const { TOTP } = require("otpauth");
const fetch = require('node-fetch');
const indicator = require('technicalindicators');

let instrumentCache = null;

const getTodayDateStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} 15:30`;
};
const getPastDateStr = (daysAgo) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} 09:15`;
};

module.exports = async (request, response) => {
    try {
        const { ticker } = request.query;
        if (!ticker) throw new Error('Ticker symbol is required');

        let fullTicker = ticker.toUpperCase();
        if (!fullTicker.includes('-')) fullTicker += '-NSE';

        const tradingSymbol = fullTicker.split('-')[0];
        const exchange = fullTicker.split('-')[1] || 'NSE';
        
        const smart_api = new SmartAPI({ api_key: process.env.ANGEL_API_KEY });
        let totp = new TOTP({ secret: process.env.ANGEL_TOTP_SECRET });
        const generatedToken = totp.generate();
        const session = await smart_api.generateSession(process.env.ANGEL_CLIENT_ID, process.env.ANGEL_MPIN, generatedToken);
        const jwtToken = session.data.jwtToken;

        if (!instrumentCache) {
            const res = await fetch('https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json');
            instrumentCache = await res.json();
        }
        const instrument = instrumentCache.find(i => i.symbol.startsWith(tradingSymbol) && i.exch_seg === exchange && i.instrumenttype === "");
        if (!instrument) throw new Error(`Symbol token not found for ${ticker}`);
        const symbolToken = instrument.token;
        
        const [quoteRes, historyRes] = await Promise.all([
            fetch('https://apiconnect.angelbroking.com/rest/secure/angelbroking/market/v1/quote/', { method: 'POST', headers: { 'Authorization': `Bearer ${jwtToken}`, 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-UserType': 'USER', 'X-SourceID': 'WEB', 'X-ClientLocalIP': '192.168.1.1', 'X-ClientPublicIP': '103.1.1.1', 'X-MACAddress': '00:00:00:00:00:00', 'X-PrivateKey': process.env.ANGEL_API_KEY }, body: JSON.stringify({ "mode": "FULL", "exchangeTokens": { [exchange]: [symbolToken] } }) }),
            smart_api.getCandleData({ "exchange": exchange, "symboltoken": symbolToken, "interval": "ONE_DAY", "fromdate": getPastDateStr(200), "todate": getTodayDateStr() })
        ]);

        const quoteData = await quoteRes.json();
        if (quoteData.status === false || !quoteData.data) throw new Error(quoteData.message || "Invalid quote data.");
        const stockInfo = quoteData.data.fetched[0];
        const candles = historyRes.data || [];
        if (candles.length < 50) throw new Error("Not enough historical data to perform calculations.");
        
        const indicatorInput = {
            open: candles.map(c => c[1]), high: candles.map(c => c[2]),
            low: candles.map(c => c[3]), close: candles.map(c => c[4]),
            volume: candles.map(c => c[5]), period: 14
        };

        const rsi = indicator.RSI.calculate({ values: indicatorInput.close, period: 14 }).pop();
        const macd = indicator.MACD.calculate({ values: indicatorInput.close, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }).pop();
        const stochastic = indicator.Stochastic.calculate({ ...indicatorInput, period: 14, signalPeriod: 3 }).pop();
        const roc = indicator.ROC.calculate({ values: indicatorInput.close, period: 20 }).pop();
        const cci = indicator.CCI.calculate({ ...indicatorInput, period: 20 }).pop();
        const williamsr = indicator.WilliamsR.calculate({ ...indicatorInput, period: 14 }).pop();
        const mfi = indicator.MFI.calculate({ ...indicatorInput, period: 14 }).pop();
        const atr = indicator.ATR.calculate({ ...indicatorInput, period: 14 }).pop();
        const adx = indicator.ADX.calculate({ ...indicatorInput, period: 14 }).pop();
        const bb = indicator.BollingerBands.calculate({ values: indicatorInput.close, period: 20, stdDev: 2 }).pop();
        
        const prevDay = candles[candles.length - 2];
        const ppInput = { high: prevDay[2], low: prevDay[3], close: prevDay[4] };
        const classic = indicator.pivotpoints(ppInput);
        const fibonacci = indicator.pivotpoints(ppInput, true);
        const { high, low, close } = ppInput;
        const pp = (high + low + close) / 3;
        const range = high - low;
        const camarilla = { r3: close + range * 1.1 / 4, r2: close + range * 1.1 / 6, r1: close + range * 1.1 / 12, s1: close - range * 1.1 / 12, s2: close - range * 1.1 / 6, s3: close - range * 1.1 / 4, pp };

        const responseData = {
            name: stockInfo.tradingSymbol, ticker: `${stockInfo.tradingSymbol}-${stockInfo.exchange}`,
            price: stockInfo.ltp, change: stockInfo.change, changePct: stockInfo.percChange,
            open: stockInfo.open, high: stockInfo.high, low: stockInfo.low,
            close: stockInfo.close, volume: stockInfo.tradeVolume,
            history: candles.map(c => ({ time: c[0].split('T')[0], open: c[1], high: c[2], low: c[3], close: c[4] })),
            indicators: { rsi, macd, stochastic, roc, cci, williamsr, mfi, atr, adx, bollingerbands: bb },
            pivots: { classic, fibonacci, camarilla }
        };
        
        response.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
        return response.status(200).json(responseData);

    } catch (error) {
        console.error("--- FULL TRACE ---", error);
        return response.status(500).json({ error: 'An error occurred on the server.', details: error.message });
    }
};