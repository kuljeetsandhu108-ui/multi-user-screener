// ===================================================================
// FINAL, VERIFIED BACKEND with Summary Calculations
// ===================================================================
const { SmartAPI } = require("smartapi-javascript");
const { TOTP } = require("otpauth");
const fetch = require('node-fetch');
const indicator = require('technicalindicators');

let instrumentCache = null;

const getTodayDateStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} 15:30`; };
const getPastDateStr = (daysAgo) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} 09:15`; };

// --- NEW SUMMARY CALCULATION LOGIC ---
function getSummaries(price, closePrices, indicators) {
    let maScore = 0;
    let indicatorScore = 0;

    // Moving Averages Summary
    const emas = [10, 20, 50, 100, 200].map(p => indicator.EMA.calculate({ values: closePrices, period: p }).pop());
    const smas = [10, 20, 50, 100, 200].map(p => indicator.SMA.calculate({ values: closePrices, period: p }).pop());
    emas.forEach(ema => { if (price > ema) maScore++; else maScore--; });
    smas.forEach(sma => { if (price > sma) maScore++; else maScore--; });
    const maSummary = maScore > 0 ? 'Bullish' : maScore < 0 ? 'Bearish' : 'Neutral';

    // Technical Indicators Summary
    if (indicators.rsi < 30) indicatorScore++; else if (indicators.rsi > 70) indicatorScore--;
    if (indicators.stochastic && indicators.stochastic.k < 20) indicatorScore++; else if (indicators.stochastic && indicators.stochastic.k > 80) indicatorScore--;
    if (indicators.cci < -100) indicatorScore++; else if (indicators.cci > 100) indicatorScore--;
    if (indicators.williamsr < -80) indicatorScore++; else if (indicators.williamsr > -20) indicatorScore--;
    if (indicators.macd && indicators.macd.MACD > indicators.macd.signal) indicatorScore++; else if (indicators.macd && indicators.macd.MACD < indicators.macd.signal) indicatorScore--;
    const indicatorSummary = indicatorScore > 0 ? 'Bullish' : indicatorScore < 0 ? 'Bearish' : 'Neutral';

    // Crossovers Summary
    const sma50 = smas[2]; const sma200 = smas[4];
    const prevSma50 = indicator.SMA.calculate({ values: closePrices.slice(0, -1), period: 50 }).pop();
    const prevSma200 = indicator.SMA.calculate({ values: closePrices.slice(0, -1), period: 200 }).pop();
    let crossoverSummary = 'Neutral';
    if (prevSma50 < prevSma200 && sma50 > sma200) crossoverSummary = 'Bullish (Golden Cross)';
    if (prevSma50 > prevSma200 && sma50 < sma200) crossoverSummary = 'Bearish (Death Cross)';

    return { ma: maSummary, indicators: indicatorSummary, crossovers: crossoverSummary };
}

module.exports = async (request, response) => {
    try {
        const { ticker, price } = request.query;
        if (!ticker || !price) throw new Error('Ticker and price are required');

        let fullTicker = ticker.toUpperCase();
        if (!fullTicker.includes('-')) fullTicker += '-NSE';
        
        const tradingSymbol = fullTicker.split('-')[0];
        const exchange = fullTicker.split('-')[1] || 'NSE';
        
        const historyRes = await (async () => {
            const smart_api = new SmartAPI({ api_key: process.env.ANGEL_API_KEY });
            let totp = new TOTP({ secret: process.env.ANGEL_TOTP_SECRET });
            const generatedToken = totp.generate();
            await smart_api.generateSession(process.env.ANGEL_CLIENT_ID, process.env.ANGEL_MPIN, generatedToken);
            if (!instrumentCache) {
                const res = await fetch('https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json');
                instrumentCache = await res.json();
            }
            const instrument = instrumentCache.find(i => i.symbol.startsWith(tradingSymbol) && i.exch_seg === exchange && i.instrumenttype === "");
            if (!instrument) return null;
            return await smart_api.getCandleData({ "exchange": exchange, "symboltoken": instrument.token, "interval": "ONE_DAY", "fromdate": getPastDateStr(300), "todate": getTodayDateStr() });
        })();

        const candles = (historyRes && historyRes.data) ? historyRes.data : [];
        if (candles.length < 200) throw new Error("Not enough historical data for full analysis.");

        const closePrices = candles.map(c => c[4]);
        const indicatorInput = { open: candles.map(c => c[1]), high: candles.map(c => c[2]), low: candles.map(c => c[3]), close: closePrices, volume: candles.map(c => c[5]), period: 14 };

        const rsi = indicator.RSI.calculate({ values: closePrices, period: 14 }).pop();
        const macd = indicator.MACD.calculate({ values: closePrices, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }).pop();
        const stochastic = indicator.Stochastic.calculate({ ...indicatorInput, period: 14, signalPeriod: 3 }).pop();
        const ema20 = indicator.EMA.calculate({ values: closePrices, period: 20 }).pop();
        const ema50 = indicator.EMA.calculate({ values: closePrices, period: 50 }).pop();
        const cci = indicator.CCI.calculate({ ...indicatorInput, period: 20 }).pop();
        const williamsr = indicator.WilliamsR.calculate({ ...indicatorInput, period: 14 }).pop();

        const allIndicators = { rsi, macd, stochastic, cci, williamsr };
        const summaries = getSummaries(Number(price), closePrices, allIndicators);
        const recommendation = getRecommendation(Number(price), rsi, ema20, ema50); // Assuming getRecommendation is defined
        
        const prevDay = candles[candles.length - 2];
        let pivots = null;
        if(prevDay) {
            const { high, low, close } = { high: prevDay[2], low: prevDay[3], close: prevDay[4] };
            const pp = (high + low + close) / 3; const range = high - low;
            pivots = {
                classic: { r3: pp + (range * 2), r2: pp + range, r1: (pp * 2) - low, pp, s1: (pp * 2) - high, s2: pp - range, s3: pp - (range * 2) },
                fibonacci: { r3: pp + (range * 1.000), r2: pp + (range * 0.618), r1: pp + (range * 0.382), pp, s1: pp - (range * 0.382), s2: pp - (range * 0.618), s3: pp - (range * 1.000) },
                camarilla: { r3: close + range * 1.1 / 4, r2: close + range * 1.1 / 6, r1: close + range * 1.1 / 12, pp, s1: close - range * 1.1 / 12, s2: close - range * 1.1 / 6, s3: close - range * 1.1 / 4 }
            };
        }

        const responseData = { rsi, ema20, ema50, recommendation, pivots, summaries };
        
        response.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
        return response.status(200).json(responseData);

    } catch (error) {
        console.error("ANALYSIS DATA ERROR:", error);
        return response.status(500).json({ error: 'Failed to fetch analysis data.', details: error.message });
    }
};

// Paste the getRecommendation helper function here if it's not already present.
const getRecommendation = (price, rsi, ema20, ema50) => { let s = 0; if (rsi) { if (rsi < 30) s += 2; else if (rsi < 50) s += 1; else if (rsi > 70) s -= 2; else if (rsi > 50) s -= 1; } if (price && ema50) { if (price > ema50) s += 2; else s -= 2; } if (price && ema20) { if (price > ema20) s += 1; else s -= 1; } if (s >= 4) return "Strong Buy"; if (s >= 2) return "Buy"; if (s <= -4) return "Strong Sell"; if (s <= -2) return "Sell"; return "Neutral"; };