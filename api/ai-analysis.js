// ===================================================================
// FINAL, VERIFIED BACKEND 3: /api/ai-analysis.js
// This function acts as the AI Analyst Brain.
// ===================================================================
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Access your API key as an environment variable
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

module.exports = async (request, response) => {
    // We need to use POST to send a large amount of data
    if (request.method !== 'POST') {
        return response.status(405).json({ error: "Method Not Allowed" });
    }

    try {
        const stockData = request.body;
        if (!stockData || !stockData.name) {
            throw new Error("Stock data is missing.");
        }

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `
            You are an expert, data-driven stock market analyst providing a neutral, factual summary.
            Your audience is an experienced trader who wants insights, not financial advice.
            Based ONLY on the JSON data provided below for the company ${stockData.name}, generate a concise analysis.

            The analysis must have the following sections, formatted in clean HTML:
            1.  A short "Quantitative Summary" paragraph explaining what the key technical and fundamental numbers suggest (e.g., RSI is neutral, Piotroski score is strong, Graham scan fails).
            2.  A "Potential Strengths" section as an unordered list (<ul><li>...</li></ul>) based on positive data points.
            3.  A "Potential Risks" section as an unordered list (<ul><li>...</li></ul>) based on negative data points.

            RULES:
            - Do NOT give any financial advice or price predictions.
            - Do NOT use any information that is not present in the JSON data.
            - Keep the language professional, neutral, and concise.
            - Do not include the JSON data itself in your response.
            - Respond only with the HTML content. Do not wrap it in markdown or other formatting.

            JSON Data:
            ${JSON.stringify(stockData, null, 2)}
        `;

        const result = await model.generateContent(prompt);
        const aiResponse = await result.response;
        const analysisText = aiResponse.text();

        response.setHeader('Content-Type', 'text/html');
        return response.status(200).send(analysisText);

    } catch (error) {
        console.error("AI ANALYSIS ERROR:", error);
        return response.status(500).json({ error: 'Failed to generate AI analysis.', details: error.message });
    }
};