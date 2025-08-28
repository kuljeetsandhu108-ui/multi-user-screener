// ===================================================================
// BACKEND UPGRADE with Fundamental Scans (Piotroski, Graham, FII)
// ===================================================================
const { SmartAPI } = require("smartapi-javascript");
const { TOTP } = require("totp-generator");
const fetch = require('node-fetch');

// --- Fundamental Analysis Calculation Functions ---

// 1. Piotroski F-Score Logic
function calculatePiotroskiFScore(financials) {
    let score = 0;
    const { income, balance, cashflow } = financials;
    if (!income || !balance || !cashflow || income.length < 2 || balance.length < 2 || cashflow.length < 2) {
        return { score: null, checklist: {} };
    }
    const check = {};

    // Profitability
    check.netIncomePositive = income[0].netIncome > 0;
    if (check.netIncomePositive) score++;

    check.operatingCashFlowPositive = cashflow[0].operatingCashFlow > 0;
    if (check.operatingCashFlowPositive) score++;

    const roaCurrent = income[0].netIncome / ((balance[0].totalAssets + balance[1].totalAssets) / 2);
    const roaPrevious = income[1].netIncome / ((balance[1].totalAssets + (balance[2] ? balance[2].totalAssets : balance[1].totalAssets)) / 2);
    check.roaIncreasing = roaCurrent > roaPrevious;
    if (check.roaIncreasing) score++;
    
    check.cashFlowExceedsNetIncome = cashflow[0].operatingCashFlow > income[0].netIncome;
    if (check.cashFlowExceedsNetIncome) score++;

    // Leverage & Liquidity
    const leverageCurrent = balance[0].longTermDebt / balance[0].totalAssets;
    const leveragePrevious = balance[1].longTermDebt / balance[1].totalAssets;
    check.leverageDecreasing = leverageCurrent < leveragePrevious;
    if (check.leverageDecreasing) score++;

    const currentRatioCurrent = balance[0].totalCurrentAssets / balance[0].totalCurrentLiabilities;
    const currentRatioPrevious = balance[1].totalCurrentAssets / balance[1].totalCurrentLiabilities;
    check.currentRatioIncreasing = currentRatioCurrent > currentRatioPrevious;
    if (check.currentRatioIncreasing) score++;

    check.sharesNotDiluted = balance[0].commonStock <= (balance[1].commonStock || balance[0].commonStock);
    if (check.sharesNotDiluted) score++;

    // Operating Efficiency
    const grossMarginCurrent = (income[0].revenue - income[0].costOfRevenue) / income[0].revenue;
    const grossMarginPrevious = (income[1].revenue - income[1].costOfRevenue) / income[1].revenue;
    check.grossMarginIncreasing = grossMarginCurrent > grossMarginPrevious;
    if (check.grossMarginIncreasing) score++;

    const assetTurnoverCurrent = income[0].revenue / ((balance[0].totalAssets + balance[1].totalAssets) / 2);
    const assetTurnoverPrevious = income[1].revenue / ((balance[1].totalAssets + (balance[2] ? balance[2].totalAssets : balance[1].totalAssets)) / 2);
    check.assetTurnoverIncreasing = assetTurnoverCurrent > assetTurnoverPrevious;
    if (check.assetTurnoverIncreasing) score++;

    return { score, checklist: check };
}

// 2. Simplified Benjamin Graham Scan Logic
function runGrahamScan(metrics) {
    let passed = false;
    const { peRatio, pbRatio, currentRatio, debtToEquity } = metrics;
    // Rule 1: P/E < 15, Rule 2: P/B < 1.5, Rule 3: Graham Number Check
    if (peRatio && pbRatio && peRatio < 15 && pbRatio < 1.5 && (peRatio * pbRatio < 22.5)) {
        passed = true;
    }
    // Additional checks for stability
    if (currentRatio < 2.0 || debtToEquity > 0.5) {
        passed = false;
    }
    return { passed, details: { peRatio, pbRatio, currentRatio, debtToEquity } };
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
        
        const symbolParts = fullTicker.split('-');
        const tradingSymbol = symbolParts[0];
        
        // --- DUAL API FETCH ---
        // We will fetch from Angel One and Finnhub at the same time
        const finnhubSymbol = `${tradingSymbol}.NS`; // Finnhub uses a different format (e.g., RELIANCE.NS)
        const finnhubKey = process.env.FINNHUB_API_KEY;

        const [angelData, finnhubFinancials, finnhubMetrics, finnhubOwnership] = await Promise.all([
            // 1. Fetch from Angel One (as before)
            fetchAngelOneData(fullTicker),
            // 2. Fetch from Finnhub (new)
            fetch(`https://finnhub.io/api/v1/stock/financials-reported?symbol=${finnhubSymbol}&freq=annual&token=${finnhubKey}`).then(res => res.json()),
            fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${finnhubSymbol}&metric=all&token=${finnhubKey}`).then(res => res.json()),
            fetch(`https://finnhub.io/api/v1/stock/ownership?symbol=${finnhubSymbol}&limit=5&token=${finnhubKey}`).then(res => res.json())
        ]);
        
        // --- PERFORM FUNDAMENTAL SCANS ---
        const financials = {
            income: finnhubFinancials.data.map(item => item.report.ic).slice(0, 3), // Last 3 years of Income Statements
            balance: finnhubFinancials.data.map(item => item.report.bs).slice(0, 3), // Last 3 years of Balance Sheets
            cashflow: finnhubFinancials.data.map(item => item.report.cf).slice(0, 3)  // Last 3 years of Cash Flow Statements
        };
        const piotroskiResult = calculatePiotroskiFScore(financials);
        const grahamMetrics = {
            peRatio: finnhubMetrics.metric.peNormalizedAnnual,
            pbRatio: finnhubMetrics.metric.pbAnnual,
            currentRatio: finnhubMetrics.metric.currentRatioAnnual,
            debtToEquity: finnhubMetrics.metric.debtToEquityAnnual
        };
        const grahamResult = runGrahamScan(grahamMetrics);
        const fiiOwnership = finnhubOwnership.ownership.find(o => o.name.toLowerCase().includes("foreign"));
        const fiiPercentage = fiiOwnership ? fiiOwnership.share : null;

        // --- COMBINE ALL DATA ---
        const combinedData = {
            ...angelData, // Spread all the data from Angel One
            piotroskiFScore: piotroskiResult.score,
            grahamScanPassed: grahamResult.passed,
            fiiPercentage: fiiPercentage
        };
        
        response.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate'); // Increase cache time
        return response.status(200).json(combinedData);

    } catch (error) {
        console.error("Caught Error:", error); 
        return response.status(500).json({ error: 'Failed to fetch data.', details: error.message });
    }
}

// Helper function for Angel One data fetching (refactored from main handler)
async function fetchAngelOneData(fullTicker) {
    const smart_api = new SmartAPI({ api_key: process.env.ANGEL_API_KEY });
    const totp = TOTP.generate(process.env.ANGEL_TOTP_SECRET).otp;
    const session = await smart_api.generateSession(process.env.ANGEL_CLIENT_ID, process.env.ANGEL_MPIN, totp);
    const jwtToken = session.data.jwtToken;

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
        name: stockInfo.tradingSymbol,
        ticker: `${stockInfo.tradingSymbol}-${stockInfo.exchange}`,
        price: stockInfo.ltp, change: stockInfo.change, changePct: stockInfo.percChange,
        open: stockInfo.open, high: stockInfo.high, low: stockInfo.low,
        close: stockInfo.close, volume: stockInfo.tradeVolume,
        rsi: rsi, ema20: ema20, ema50: ema50, recommendation: recommendation
    };
}

// Date helper functions
function getTodayDateStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} 15:30`;
}
function getPastDateStr(daysAgo) {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} 09:15`;
}