// ===================================================================
// FINAL, VERIFIED & COMPLETE: /api/analysis-data.js
// ===================================================================
const { SmartAPI } = require("smartapi-javascript");
const { TOTP } = require("otpauth");
const fetch = require('node-fetch');
const indicator = require('technicalindicators');

let instrumentCache = null;

// --- All helper functions are defined first for stability ---
const getTodayDateStr = () => { const d = new Date(); const offset = d.getTimezoneOffset() * 60000; const istOffset = 330 * 60000; const istTime = new Date(d.getTime() + offset + istOffset); return `${istTime.getFullYear()}-${String(istTime.getMonth() + 1).padStart(2, '0')}-${String(istTime.getDate()).padStart(2, '0')} 15:30`; };
const getPastDateStr = (daysAgo) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); const offset = d.getTimezoneOffset() * 60000; const istOffset = 330 * 60000; const istTime = new Date(d.getTime() + offset + istOffset); return `${istTime.getFullYear()}-${String(istTime.getMonth() + 1).padStart(2, '0')}-${String(istTime.getDate()).padStart(2, '0')} 09:15`; };
const calculateEMA = (closePrices, period) => { if (!closePrices || closePrices.length < period) return null; const k = 2 / (period + 1); let ema = closePrices.slice(0, period).reduce((s, v) => s + v, 0) / period; for (let i = period; i < closePrices.length; i++) { ema = (closePrices[i] * k) + (ema * (1 - k)); } return ema; };
const calculateRSI = (closePrices, period = 14) => { if (!closePrices || closePrices.length <= period) return null; let gains = 0; let losses = 0; for (let i = 1; i <= period; i++) { const diff = closePrices[i] - closePrices[i - 1]; if (diff >= 0) { gains += diff; } else { losses -= diff; } } let avgGain = gains / period; let avgLoss = losses / period; for (let i = period + 1; i < closePrices.length; i++) { const diff = closePrices[i] - closePrices[i - 1]; if (diff >= 0) { avgGain = (avgGain * (period - 1) + diff) / period; avgLoss = (avgLoss * (period - 1)) / period; } else { avgGain = (avgGain * (period - 1)) / period; avgLoss = (avgLoss * (period - 1) - diff) / period; } } if (avgLoss === 0) return 100; const rs = avgGain / avgLoss; return 100 - (100 / (1 + rs)); };
const getRecommendation = (price, rsi, ema20, ema50) => { let s = 0; if (rsi) { if (rsi < 30) s += 2; else if (rsi < 50) s += 1; else if (rsi > 70) s -= 2; else if (rsi > 50) s -= 1; } if (price && ema50) { if (price > ema50) s += 2; else s -= 2; } if (price && ema20) { if (price > ema20) s += 1; else s -= 1; } if (s >= 4) return "Strong Buy"; if (s >= 2) return "Buy"; if (s <= -4) return "Strong Sell"; if (s <= -2) return "Sell"; return "Neutral"; };
const calculatePiotroskiFScore = (financials) => { let s = 0; const { income, balance, cashflow } = financials; if (!income || !balance || !cashflow || !income[0] || !income[1] || !balance[0] || !balance[1] || !cashflow[0]) return null; try { if (income[0].netIncome > 0) s++; if (cashflow[0].operatingCashFlow > 0) s++; const roaCurr = income[0].netIncome / ((balance[0].totalAssets + balance[1].totalAssets) / 2); const roaPrev = income[1].netIncome / ((balance[1].totalAssets + (balance[2] ? balance[2].totalAssets : balance[1].totalAssets)) / 2); if (roaCurr > roaPrev) s++; if (cashflow[0].operatingCashFlow > income[0].netIncome) s++; const levCurr = balance[0].longTermDebt / balance[0].totalAssets; const levPrev = balance[1].longTermDebt / balance[1].totalAssets; if (levCurr < levPrev) s++; const ratioCurr = balance[0].totalCurrentAssets / balance[0].totalCurrentLiabilities; const ratioPrev = balance[1].totalCurrentAssets / balance[1].totalCurrentLiabilities; if (ratioCurr > ratioPrev) s++; if (balance[0].commonStock <= (balance[1].commonStock || balance[0].commonStock)) s++; const marginCurr = (income[0].revenue - income[0].costOfRevenue) / income[0].revenue; const marginPrev = (income[1].revenue - income[1].costOfRevenue) / income[1].revenue; if (marginCurr > marginPrev) s++; const turnoverCurr = income[0].revenue / ((balance[0].totalAssets + balance[1].totalAssets) / 2); const turnoverPrev = income[1].revenue / ((balance[1].totalAssets + (balance[2] ? balance[2].totalAssets : balance[1].totalAssets)) / 2); if (turnoverCurr > turnoverPrev) s++; return s; } catch { return null; }};
const runGrahamScan = (metrics) => { let p = false; const { peRatio, pbRatio, currentRatio, debtToEquity } = metrics; try { if (peRatio && pbRatio && peRatio > 0 && peRatio < 15 && pbRatio < 1.5 && (peRatio * pbRatio < 22.5)) p = true; if (currentRatio < 2.0 || debtToEquity > 0.5) p = false; return p; } catch { return null; }};


module.exports = async (request, response) => {
    try {
        const { ticker, price } = request.query;
        if (!ticker || !price) throw new Error('Ticker and price are required');

        let fullTicker = ticker.toUpperCase();
        if (!fullTicker.includes('-')) fullTicker += '-NSE';
        
        const tradingSymbol = fullTicker.split('-')[0];
        const exchange = fullTicker.split('-')[1] || 'NSE';
        
        const [historyRes, finnhubMetricsRes, finnhubFinancialsRes, finnhubOwnershipRes] = await Promise.allSettled([
            (async () => {
                const smart_api = new SmartAPI({ api_key: process.env.ANGEL_API_KEY });
                let totp = new TOTP({ secret: process.env.ANGEL_TOTP_SECRET });
                const generatedToken = totp.generate();
                await smart_api.generateSession(process.env.ANGEL_CLIENT_ID, process.env.ANGEL_MPIN, generatedToken);
                
                if (!instrumentCache) {
                    const res = await fetch('https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json');
                    instrumentCache = await res.json();
                }
                const instrument = instrumentCache.find(i => i.symbol.startsWith(tradingSymbol) && i.exch_seg === exchange && (i.instrumenttype === "" || i.instrumenttype === "AMX" || i.instrumenttype === "ACC"));
                if (!instrument) return null;
                return await smart_api.getCandleData({ "exchange": exchange, "symboltoken": instrument.token, "interval": "ONE_DAY", "fromdate": getPastDateStr(300), "todate": getTodayDateStr() });
            })(),
            fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${tradingSymbol}.NS&metric=all&token=${process.env.FINNHUB_API_KEY}`),
            fetch(`https://finnhub.io/api/v1/stock/financials-reported?symbol=${tradingSymbol}.NS&freq=annual&token=${process.env.FINNHUB_API_KEY}`),
            fetch(`https://finnhub.io/api/v1/stock/ownership?symbol=${tradingSymbol}.NS&limit=5&token=${process.env.FINNHUB_API_KEY}`)
        ]);

        const candles = (historyRes.status === 'fulfilled' && historyRes.value && historyRes.value.data) ? historyRes.value.data : [];
        const closePrices = candles.map(c => c[4]);
        const rsi = calculateRSI(closePrices);
        const ema20 = calculateEMA(closePrices, 20);
        const ema50 = calculateEMA(closePrices, 50);
        const recommendation = getRecommendation(Number(price), rsi, ema20, ema50);

        const prevDay = candles.length > 1 ? candles[candles.length - 2] : null;
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

        let piotroskiFScore = null, grahamScanPassed = null, fiiPercentage = null;
        if (finnhubMetricsRes.status === 'fulfilled' && finnhubFinancialsRes.status === 'fulfilled' && finnhubOwnershipRes.status === 'fulfilled') {
            const finMetrics = await finnhubMetricsRes.value.json();
            const finFinancials = await finnhubFinancialsRes.value.json();
            const finOwnership = await finnhubOwnershipRes.value.json();
            if (finMetrics.metric && finFinancials.data) {
                piotroskiFScore = calculatePiotroskiFScore({ income: finFinancials.data.map(i => i.report.ic).slice(0, 3), balance: finFinancials.data.map(i => i.report.bs).slice(0, 3), cashflow: finFinancials.data.map(i => i.report.cf).slice(0, 3) });
                grahamScanPassed = runGrahamScan({ peRatio: finMetrics.metric.peNormalizedAnnual, pbRatio: finMetrics.metric.pbAnnual, currentRatio: finMetrics.metric.currentRatioAnnual, debtToEquity: finMetrics.metric.debtToEquityAnnual });
                const fiiOwner = finOwnership.ownership ? finOwnership.ownership.find(o => o.name.toLowerCase().includes("foreign")) : null;
                fiiPercentage = fiiOwner ? fiiOwner.share : null;
            }
        }
        
        const responseData = { rsi, ema20, ema50, recommendation, pivots, piotroskiFScore, grahamScanPassed, fiiPercentage };
        
        response.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
        return response.status(200).json(responseData);

    } catch (error) {
        console.error("ANALYSIS DATA ERROR:", error);
        return response.status(500).json({ error: 'Failed to fetch analysis data.', details: error.message });
    }
};