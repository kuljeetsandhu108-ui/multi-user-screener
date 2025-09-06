// ===================================================================
// FINAL, VERIFIED & COMPLETE: /api/ai-analysis.js
// ===================================================================
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Access your API key as an environment variable from Vercel
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

module.exports = async (request, response) => {
    // This function must only accept POST requests because the data object is large
    if (request.method !== 'POST') {
        return response.status(405).json({ error: "Method Not Allowed" });
    }

    try {
        // Get the full data object sent from the frontend
        const stockData = request.body;
        if (!stockData || !stockData.name) {
            throw new Error("Complete stock data is required to generate analysis.");
        }

        // Initialize the Generative Model, specifically Gemini 1.5 Flash
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        // --- This is the "Master Prompt" that instructs the AI ---
        const prompt = `
            You are a world-class, unbiased, data-driven stock market analyst. Your name is 'Gemini Analyst'.
            Your task is to generate a comprehensive, multi-part report based ONLY on the provided JSON data for the company ${stockData.name}.
            Do NOT use any external knowledge. Do NOT give financial advice or price targets.
            Your entire response must be formatted in clean, professional HTML.

            Here is the structure of the report you must generate:

            <h3>Overall Verdict</h3>
            <p>A single, powerful sentence summarizing the stock's current situation based on a blend of its technical and fundamental data points.</p>

            <h3>Technical Analysis</h3>
            <h4>Trend Analysis</h4>
            <p>Analyze the relationship between the current price and the 20-day and 50-day EMAs from the JSON data. State if the trend appears bullish, bearish, or mixed for the short to medium term.</p>
            <h4>Momentum Analysis</h4>
            <p>Analyze the RSI value from the JSON data. State whether momentum appears to be trending towards overbought, oversold, or is neutral, and explain what the RSI value implies.</p>
            
            <h3>Fundamental Analysis</h3>
            <h4>Valuation (Graham Model)</h4>
            <p>Analyze the company's valuation based on the "grahamScanPassed" result. Explain whether it passes or fails the classic criteria for a value investment based on the provided data.</p>
            <h4>Financial Health (Piotroski Model)</h4>
            <p>Analyze the company's financial strength using the "piotroskiFScore". A score of 7-9 is strong, 4-6 is neutral, and 0-3 is weak. Briefly explain what the score implies about the company's operational efficiency and health.</p>
            <h4>Institutional Ownership</h4>
            <p>Analyze the "fiiPercentage". State whether the current Foreign Institutional Investor shareholding is high, low, or moderate, and what this suggests about institutional confidence.</p>
            
            <h3>SWOT Analysis (Data-Driven)</h3>
            <ul>
                <li><strong>Strengths:</strong> List 2-3 key strengths based ONLY on positive data points from the JSON (e.g., "Currently in oversold territory (RSI < 30)", "Passes Graham value scan", "Strong Piotroski F-Score").</li>
                <li><strong>Weaknesses:</strong> List 2-3 key weaknesses based ONLY on negative data points (e.g., "Bearish trend with price below 50-day EMA", "Fails Graham value scan").</li>
                <li><strong>Opportunities:</strong> List 1-2 potential opportunities inferred purely from the data (e.g., "Oversold RSI conditions could present a potential mean-reversion opportunity for traders").</li>
                <li><strong>Threats:</strong> List 1-2 potential threats inferred purely from the data (e.g., "A price below key moving averages indicates a threat of continued downward momentum").</li>
            </ul>

            <hr>
            <p style="font-size: 12px; color: #888;"><em>Disclaimer: This analysis is auto-generated and is for informational purposes only. It is not financial advice.</em></p>

            JSON Data to be analyzed:
            ${JSON.stringify(stockData, null, 2)}
        `;

        const result = await model.generateContent(prompt);
        const aiResponse = await result.response;
        const analysisText = aiResponse.text();

        // Clean up markdown code fences in case the model adds them
        const cleanHtml = analysisText.replace(/```html/g, '').replace(/```/g, '');

        // Set the response header to indicate we are sending back HTML content
        response.setHeader('Content-Type', 'text/html');
        // Send the clean HTML as the response
        return response.status(200).send(cleanHtml);

    } catch (error) {
        console.error("AI ANALYSIS ERROR:", error);
        return response.status(500).json({ error: 'Failed to generate AI analysis.', details: error.message });
    }
};