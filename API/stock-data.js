// ===================================================================
// BACKEND UPGRADE with Technical Analysis
// ===================================================================
const { SmartAPI } = require("smartapi-javascript");
const { TOTP } = require("totp-generator");
const fetch = require('node-fetch');

// --- Technical Analysis Calculation Functions ---
function calculateEMA(closePrices, period) {
    if (!closePrices || closePrices.length < period) return null;
    const k = 2 / (period + 1);
    let ema = closePrices.slice(0, period).reduce((sum, val) => sum + val, 0) / period;
    for (let i = period; i < closePrices.length; i++) {
        ema = (closePrices[i] * k) + (ema * (1 - k));
    }
    return ema;
}

function calculateRSI(closePrices, period = 14) {
    if (!closePrices || closePrices.length <= period) return null;
    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = closePrices[i] - closePrices[i - 1];
        if (diff >= 0) { gains += diff; } else { losses -= diff; }
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    for (let i = period + 1; i < closePrices.length; i++) {
        const diff = closePrices[i] - closePrices[i - 1];
        if (diff >= 0) {
            avgGain = (avgGain * (period - 1) + diff) / period;
            avgLoss = (avgLoss * (period - 1)) / period;
        } else {
            avgGain = (avgGain * (period - 1)) / period;
            avgLoss = (avgLoss * (period - 1) - diff) / period;
        }
    }
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

function getRecommendation(price, rsi, ema20, ema50) {
    let score = 0;
    if (rsi) {
        if (rsi < 30) score += 2; else if (rsi < 50) score += 1;
        else if (rsi > 70) score -= 2; else if (rsi > 50) score -= 1;
    }
    if (price && ema50) { if (price > ema50) score += 2; else score -= 2; }
    if (price && ema20) { if (price > ema20) score += 1; else score -= 1; }
    
    if (score >= 4) return "Strong Buy"; if (score >= 2) return "Buy";
    if (score <= -4) return "Strong Sell"; if (score <= -2) return "Sell";
    return "Neutral";
}

// In-memory cache for instrument list
let instrumentCache = null;

// Main handler function
module.exports = async function handler(request, response) {
    const { ticker } = request.query;
    if (!ticker) { return response.status(400).json({ error: 'Ticker symbol is required' }); }

    try {
        let fullTicker = ticker.toUpperCase();
        if (!fullTicker.includes('-')) { fullTicker += '-NSE'; }

        const smart_api = new SmartAPI({ api_key: process.env.ANGEL_API_KEY });
        const totp = TOTP.generate(process.env.ANGEL_TOTP_SECRET).otp;
        const session = await smart_api.generateSession(process.env.ANGEL_CLIENT_ID, process.env.ANGEL_MPIN, totp);
        const jwtToken = session.data.jwtToken;

        const symbolParts = fullTicker.split('-');
        const tradingSymbol = symbolParts[0];
        const exchange = symbolParts[1];
        
        // Dynamic Symbol Token Lookup
        if (!instrumentCache) {
            const instrumentListUrl = 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';
            const instrumentResponse = await fetch(instrumentListUrl);
            instrumentCache = await instrumentResponse.json();
        }
        const instrument = instrumentCache.find(inst => inst.symbol.startsWith(tradingSymbol) && inst.exch_seg === exchange && inst.instrumenttype === "");
        if (!instrument) { throw new Error(`Symbol token not found for ${ticker}`); }
        const symbolToken = instrument.token;

        // --- FETCH BOTH LIVE DATA AND HISTORICAL DATA ---
        const fromDate = new Date();
        const toDate = new Date();
        fromDate.setMonth(fromDate.getMonth() - 6); // Fetch last 6 months for calculations
        const fromDateStr = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}-${String(fromDate.getDate()).padStart(2, '0')}`;
        const toDateStr = `${toDate.getFullYear()}-${String(toDate.getMonth() + 1).padStart(2, '0')}-${String(toDate.getDate()).padStart(2, '0')}`;

        const [quoteResponse, historyResponse] = await Promise.all([
            // Fetch live quote
            fetch('https://apiconnect.angelbroking.com/rest/secure/angelbroking/market/v1/quote/', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${jwtToken}`, 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-UserType': 'USER', 'X-SourceID': 'WEB', 'X-ClientLocalIP': '192.168.1.1', 'X-ClientPublicIP': '103.1.1.1', 'X-MACAddress': '00:00:00:00:00:00', 'X-PrivateKey': process.env.ANGEL_API_KEY },
                body: JSON.stringify({ "mode": "FULL", "exchangeTokens": { [exchange]: [symbolToken] } })
            }),
            // Fetch historical data
            smart_api.getCandleData({ "exchange": exchange, "symboltoken": symbolToken, "interval": "ONE_DAY", "fromdate": fromDateStr, "todate": toDateStr })
        ]);
        
        const quoteData = await quoteResponse.json();
        if (quoteData.status === false || !quoteData.data) { throw new Error(quoteData.message || "Invalid quote data from API."); }
        if (historyResponse.status === false || !historyResponse.data) { throw new Error(historyResponse.message || "Invalid history data from API."); }

        const stockInfo = quoteData.data.fetched[0];
        const candles = historyResponse.data;
        const closePrices = candles.map(c => c[4]); // O, H, L, Close, V -> index 4 is close

        // --- PERFORM CALCULATIONS ---
        const rsi = calculateRSI(closePrices);
        const ema20 = calculateEMA(closePrices, 20);
        const ema50 = calculateEMA(closePrices, 50);
        const recommendation = getRecommendation(stockInfo.ltp, rsi, ema20, ema50);
        
        // --- FORMAT FINAL RESPONSE ---
        const formattedData = {
            name: stockInfo.tradingSymbol,
            ticker: `${stockInfo.tradingSymbol}-${stockInfo.exchange}`,
            price: stockInfo.ltp, change: stockInfo.change, changePct: stockInfo.percChange,
            open: stockInfo.open, high: stockInfo.high, low: stockInfo.low,
            close: stockInfo.close, volume: stockInfo.tradeVolume,
            // New analysis data
            rsi: rsi, ema20: ema20, ema50: ema50, recommendation: recommendation
        };

        response.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate');
        return response.status(200).json(formattedData);

    } catch (error) {
        console.error("Caught Error:", error); 
        return response.status(500).json({ error: 'Failed to fetch data from Angel One API.', details: error.message });
    }
}