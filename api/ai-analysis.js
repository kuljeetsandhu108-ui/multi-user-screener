// ===================================================================
// AI ANALYST UPGRADE with Web Scraping Capabilities
// ===================================================================
const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require('axios'); // Our new web scraping tool

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Helper function to fetch the raw HTML from a URL
async function fetchWebsiteContent(url) {
    try {
        const response = await axios.get(url, {
            headers: { // Use a common user-agent to look like a real browser
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        // We will simplify the HTML to only include the main content to save tokens
        const bodyContent = response.data.match(/<body[^>]*>([\s\S]*)<\/body>/);
        return bodyContent ? bodyContent[1] : '';
    } catch (error) {
        console.error(`Failed to fetch content from ${url}:`, error.message);
        return `Could not fetch content from ${url}.`;
    }
}

module.exports = async (request, response) => {
    if (request.method !== 'POST') {
        return response.status(405).json({ error: "Method Not Allowed" });
    }

    try {
        const stockData = request.body;
        if (!stockData || !stockData.name) {
            throw new Error("Stock data is missing.");
        }

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        // --- STEP 1: Define the target websites ---
        const tradingSymbol = stockData.ticker.split('-')[0];
        const screenerUrl = `https://www.screener.in/company/${tradingSymbol}/consolidated/`;
        const moneyControlUrl = `https://www.moneycontrol.com/india/stockpricequote/it-services/${tradingSymbol}/TCS`; // This part needs to be dynamic, but we'll start with a static example

        // --- STEP 2: Fetch content from the websites in parallel ---
        console.log("Fetching website content for AI analysis...");
        const [screenerContent, moneyControlContent] = await Promise.all([
            fetchWebsiteContent(screenerUrl),
            // fetchWebsiteContent(moneyControlUrl) // We'll add the second one later to keep it simple first
        ]);
        console.log("Website content fetched.");

        // --- STEP 3: Construct the new Master Prompt ---
        const prompt = `
            You are an expert financial data analyst. Your task is to generate a comprehensive report on ${stockData.name}.
            
            First, use the provided "Quantitative Data" JSON for precise numbers like the current price and calculated indicators.
            Second, use the provided "Website HTML Content" to extract qualitative information like pros, cons, and to construct data tables.

            Your entire response must be in clean HTML.

            Here is the report structure:
            1.  **Financial Metrics:** A table of the most important ratios from the Quantitative Data.
            2.  **Quarterly Results Table:** Extract the latest quarterly results from the Website HTML Content and format it as an HTML table (<table>).
            3.  **Balance Sheet Table:** Extract the latest balance sheet data from the Website HTML Content and format it as an HTML table (<table>).
            4.  **Pros & Cons Summary:** Based on the Website HTML Content, create two unordered lists (<ul>) for the company's Pros and Cons.
            5.  **SWOT Analysis:** Combine all information to provide a final SWOT analysis.

            Quantitative Data (for reference):
            \`\`\`json
            ${JSON.stringify(stockData, null, 2)}
            \`\`\`

            Website HTML Content from Screener.in:
            \`\`\`html
            ${screenerContent}
            \`\`\`
        `;

        const result = await model.generateContent(prompt);
        const aiResponse = await result.response;
        const analysisText = aiResponse.text();

        const cleanHtml = analysisText.replace(/```html/g, '').replace(/```/g, '');

        response.setHeader('Content-Type', 'text/html');
        return response.status(200).send(cleanHtml);

    } catch (error) {
        console.error("AI ANALYSIS ERROR:", error);
        return response.status(500).json({ error: 'Failed to generate AI analysis.', details: error.message });
    }
};