// ===================================================================
// FINAL BACKEND - Now serves historical data for our new chart
// ===================================================================
const { SmartAPI } = require("smartapi-javascript");
const { TOTP } = require("totp-generator");
const fetch = require('node-fetch');

// All helper functions remain the same and are at the top
function getTodayDateStr() { /*...*/ }
function getPastDateStr(daysAgo) { /*...*/ }
function calculateEMA(closePrices, period) { /*...*/ }
function calculateRSI(closePrices, period = 14) { /*...*/ }
function getRecommendation(price, rsi, ema20, ema50) { /*...*/ }
function calculatePiotroskiFScore(financials) { /*...*/ }
function runGrahamScan(metrics) { /*...*/ }

let instrumentCache = null;

async function fetchAngelOneData(fullTicker, smart_api, jwtToken) {
    const symbolParts = fullTicker.split('-');
    const tradingSymbol = symbolParts[0];
    const exchange = symbolParts[1];
    if (!instrumentCache) { /* ... same as before ... */ }
    const instrument = instrumentCache.find(inst => inst.symbol.startsWith(tradingSymbol) && inst.exch_seg === exchange && inst.instrumenttype === "");
    if (!instrument) { throw new Error(`Symbol token not found for ${fullTicker}`); }
    const symbolToken = instrument.token;
    
    const [quoteResponse, historyResponse] = await Promise.all([
        fetch('https://apiconnect.angelbroking.com/rest/secure/angelbroking/market/v1/quote/', { /* ... same as before ... */ }),
        smart_api.getCandleData({ "exchange": exchange, "symboltoken": symbolToken, "interval": "ONE_DAY", "fromdate": getPastDateStr(365), "todate": getTodayDateStr() })
    ]);
    
    const quoteData = await quoteResponse.json();
    if (quoteData.status === false || !quoteData.data) { throw new Error(quoteData.message || "Invalid quote data."); }
    if (historyResponse.status === false || !historyResponse.data) { throw new Error(historyResponse.message || "Invalid history data."); }
    
    const stockInfo = quoteData.data.fetched[0];
    const candles = historyResponse.data;
    
    // --- NEW: Format historical data for our new chart ---
    const formattedHistory = candles.map(c => ({
        time: c[0].split('T')[0], // "time": "YYYY-MM-DD"
        open: c[1],
        high: c[2],
        low: c[3],
        close: c[4]
    }));
    
    const closePrices = candles.map(c => c[4]);
    const rsi = calculateRSI(closePrices);
    const ema20 = calculateEMA(closePrices, 20);
    const ema50 = calculateEMA(closePrices, 50);
    const recommendation = getRecommendation(stockInfo.ltp, rsi, ema20, ema50);
    
    return {
        // ... all previous data points ...
        name: stockInfo.tradingSymbol, ticker: `${stockInfo.tradingSymbol}-${stockInfo.exchange}`,
        price: stockInfo.ltp, change: stockInfo.change, changePct: stockInfo.percChange,
        open: stockInfo.open, high: stockInfo.high, low: stockInfo.low,
        close: stockInfo.close, volume: stockInfo.tradeVolume,
        rsi: rsi, ema20: ema20, ema50: ema50, recommendation: recommendation,
        // --- ADD THE NEW HISTORY DATA ---
        history: formattedHistory
    };
}

module.exports = async function handler(request, response) {
    // ... This main handler function remains exactly the same as the previous correct version ...
    // It calls fetchAngelOneData and the Finnhub logic.
    // For brevity, I am omitting it here, but please use the full, correct code from the last version.
}

// Full helper functions need to be pasted here to avoid "not defined" errors.
// For brevity, they are omitted here, but ensure they are in your final file.