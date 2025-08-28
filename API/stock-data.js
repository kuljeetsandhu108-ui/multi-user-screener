// ===================================================================
// FINAL STABLE BACKEND - with Correct Function Order
// ===================================================================
const { SmartAPI } = require("smartapi-javascript");
const { TOTP } = require("totp-generator");
const fetch = require('node-fetch');

// --- THE FIX: All helper functions are now defined at the top before they are called ---
function getTodayDateStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} 15:30`; }
function getPastDateStr(daysAgo) { const d = new Date(); d.setDate(d.getDate() - daysAgo); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} 09:15`; }
function calculateEMA(closePrices, period) { if (!closePrices || closePrices.length < period) return null; const k = 2 / (period + 1); let ema = closePrices.slice(0, period).reduce((sum, val) => sum + val, 0) / period; for (let i = period; i < closePrices.length; i++) { ema = (closePrices[i] * k) + (ema * (1 - k)); } return ema; }
function calculateRSI(closePrices, period = 14) { if (!closePrices || closePrices.length <= period) return null; let gains = 0; let losses = 0; for (let i = 1; i <= period; i++) { const diff = closePrices[i] - closePrices[i - 1]; if (diff >= 0) { gains += diff; } else { losses -= diff; } } let avgGain = gains / period; let avgLoss = losses / period; for (let i = period + 1; i < closePrices.length; i++) { const diff = closePrices[i] - closePrices[i - 1]; if (diff >= 0) { avgGain = (avgGain * (period - 1) + diff) / period; avgLoss = (avgLoss * (period - 1)) / period; } else { avgGain = (avgGain * (period - 1)) / period; avgLoss = (avgLoss * (period - 1) - diff) / period; } } if (avgLoss === 0) return 100; const rs = avgGain / avgLoss; return 100 - (100 / (1 + rs)); }
function getRecommendation(price, rsi, ema20, ema50) { let score = 0; if (rsi) { if (rsi < 30) score += 2; else if (rsi < 50) score += 1; else if (rsi > 70) score -= 2; else if (rsi > 50) score -= 1; } if (price && ema50) { if (price > ema50) score += 2; else score -= 2; } if (price && ema20) { if (price > ema20) score += 1; else score -= 1; } if (score >= 4) return "Strong Buy"; if (score >= 2) return "Buy"; if (score <= -4) return "Strong Sell"; if (score <= -2) return "Sell"; return "Neutral"; }
function calculatePiotroskiFScore(financials) { let score = 0; const { income, balance, cashflow } = financials; if (!income || !balance || !cashflow || income.length < 2 || balance.length < 2 || cashflow.length < 2) { return { score: null }; } if (income[0].netIncome > 0) score++; if (cashflow[0].operatingCashFlow > 0) score++; const roaCurrent = income[0].netIncome / ((balance[0].totalAssets + balance[1].totalAssets) / 2); const roaPrevious = income[1].netIncome / ((balance[1].totalAssets + (balance[2] ? balance[2].totalAssets : balance[1].totalAssets)) / 2); if (roaCurrent > roaPrevious) score++; if (cashflow[0].operatingCashFlow > income[0].netIncome) score++; const leverageCurrent = balance[0].longTermDebt / balance[0].totalAssets; const leveragePrevious = balance[1].longTermDebt / balance[1].totalAssets; if (leverageCurrent < leveragePrevious) score++; const currentRatioCurrent = balance[0].totalCurrentAssets / balance[0].totalCurrentLiabilities; const currentRatioPrevious = balance[1].totalCurrentAssets / balance[1].totalCurrentLiabilities; if (currentRatioCurrent > currentRatioPrevious) score++; if (balance[0].commonStock <= (balance[1].commonStock || balance[0].commonStock)) score++; const grossMarginCurrent = (income[0].revenue - income[0].costOfRevenue) / income[0].revenue; const grossMarginPrevious = (income[1].revenue - income[1].costOfRevenue) / income[1].revenue; if (grossMarginCurrent > grossMarginPrevious) score++; const assetTurnoverCurrent = income[0].revenue / ((balance[0].totalAssets + balance[1].totalAssets) / 2); const assetTurnoverPrevious = income[1].revenue / ((balance[1].totalAssets + (balance[2] ? balance[2].totalAssets : balance[1].totalAssets)) / 2); if (assetTurnoverCurrent > assetTurnoverPrevious) score++; return { score }; }
function runGrahamScan(metrics) { let passed = false; const { peRatio, pbRatio, currentRatio, debtToEquity } = metrics; if (peRatio && pbRatio && peRatio < 15 && pbRatio < 1.5 && (peRatio * pbRatio < 22.5)) { passed = true; } if (currentRatio < 2.0 || debtToEquity > 0.5) { passed = false; } return { passed }; }
// --- END OF HELPER FUNCTIONS ---

let instrumentCache = null;

async function fetchAngelOneData(fullTicker, smart_api, jwtToken) {
    const symbolParts = fullTicker.split('-');
    const tradingSymbol = symbolParts[0];
    const exchange = symbolParts[1];
    if (!instrumentCache) {
        const instrumentListUrl = 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';
        const instrumentResponse = await fetch(instrumentListUrl);
        instrumentCache = await instrumentResponse.json();
    }
    const instrument = instrumentCache.find(inst => inst.symbol.startsWith(tradingSymbol) && inst.exch_seg === exchange && inst.instrumenttype === "");
    if (!instrument) { throw new Error(`Symbol token not found for ${fullTicker}`); }
    const symbolToken = instrument.token;
    
    const [quoteResponse, historyResponse] = await Promise.all([
        fetch('https://apiconnect.angelbroking.com/rest/secure/angelbroking/market/v1/quote/', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${jwtToken}`, 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-UserType': 'USER', 'X-SourceID': 'WEB', 'X-ClientLocalIP': '192.168.1.1', 'X-ClientPublicIP': '103.1.1.1', 'X-MACAddress': '00:00:00:00:00:00', 'X-PrivateKey': process.env.ANGEL_API_KEY },
            body: JSON.stringify({ "mode": "FULL", "exchangeTokens": { [exchange]: [symbolToken] } })
        }),
        smart_api.getCandleData({ "exchange": exchange, "symboltoken": symbolToken, "interval": "ONE_DAY", "fromdate": getPastDateStr(100), "todate": getTodayDateStr() })
    ]);
    
    const quoteData = await quoteResponse.json();
    if (quoteData.status === false || !quoteData.data) { throw new Error(quoteData.message || "Invalid quote data."); }
    if (historyResponse.status === false || !historyResponse.data) { throw new Error(historyResponse.message || "Invalid history data."); }
    
    const stockInfo = quoteData.data.fetched[0];
    const closePrices = historyResponse.data.map(c => c[4]);
    const rsi = calculateRSI(closePrices);
    const ema20 = calculateEMA(closePrices, 20);
    const ema50 = calculateEMA(closePrices, 50);
    const recommendation = getRecommendation(stockInfo.ltp, rsi, ema20, ema50);
    
    return {
        name: stockInfo.tradingSymbol, ticker: `${stockInfo.tradingSymbol}-${stockInfo.exchange}`,
        price: stockInfo.ltp, change: stockInfo.change, changePct: stockInfo.percChange,
        open: stockInfo.open, high: stockInfo.high, low: stockInfo.low,
        close: stockInfo.close, volume: stockInfo.tradeVolume,
        rsi: rsi, ema20: ema20, ema50: ema50, recommendation: recommendation
    };
}

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
        
        const angelData = await fetchAngelOneData(fullTicker, smart_api, jwtToken);

        let fundamentalData = { piotroskiFScore: null, grahamScanPassed: null, fiiPercentage: null };
        try {
            const tradingSymbol = fullTicker.split('-')[0];
            const finnhubSymbol = `${tradingSymbol}.NS`;
            const finnhubKey = process.env.FINNHUB_API_KEY;
            const [finnhubFinancials, finnhubMetrics, finnhubOwnership] = await Promise.all([
                fetch(`https://finnhub.io/api/v1/stock/financials-reported?symbol=${finnhubSymbol}&freq=annual&token=${finnhubKey}`).then(res => res.json()),
                fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${finnhubSymbol}&metric=all&token=${finnhubKey}`).then(res => res.json()),
                fetch(`https://finnhub.io/api/v1/stock/ownership?symbol=${finnhubSymbol}&limit=5&token=${finnhubKey}`).then(res => res.json())
            ]);
            const financials = {
                income: finnhubFinancials.data.map(item => item.report.ic).slice(0, 3),
                balance: finnhubFinancials.data.map(item => item.report.bs).slice(0, 3),
                cashflow: finnhubFinancials.data.map(item => item.report.cf).slice(0, 3)
            };
            const piotroskiResult = calculatePiotroskiFScore(financials);
            const grahamMetrics = {
                peRatio: finnhubMetrics.metric.peNormalizedAnnual, pbRatio: finnhubMetrics.metric.pbAnnual,
                currentRatio: finnhubMetrics.metric.currentRatioAnnual, debtToEquity: finnhubMetrics.metric.debtToEquityAnnual
            };
            const grahamResult = runGrahamScan(grahamMetrics);
            const fiiOwnership = finnhubOwnership.ownership.find(o => o.name.toLowerCase().includes("foreign"));
            fundamentalData = {
                piotroskiFScore: piotroskiResult.score,
                grahamScanPassed: grahamResult.passed,
                fiiPercentage: fiiOwnership ? fiiOwnership.share : null
            };
        } catch (e) {
            console.warn("Could not fetch fundamental data:", e.message);
        }

        const combinedData = { ...angelData, ...fundamentalData };
        response.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
        return response.status(200).json(combinedData);

    } catch (error) {
        console.error("Caught Error:", error); 
        return response.status(500).json({ error: 'Failed to fetch data.', details: error.message });
    }
}