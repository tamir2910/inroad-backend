import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;

// IMPORTANT: set this in Railway as an environment variable
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!OPENROUTER_API_KEY) {
  console.warn("⚠️ OPENROUTER_API_KEY is not set. OpenRouter calls will fail.");
}

app.use(cors());
app.use(express.json());

// Health check
app.get("/", (req, res) => {
  res.json({ status: "ok", app: "inRoad-backend" });
});

// Main endpoint used by the iOS app
app.post("/v1/inroad/assist", async (req, res) => {
  try {
    const { userText, drivingState, locale } = req.body || {};

    if (!userText) {
      return res.status(400).json({ error: "userText is required" });
    }

    const systemPrompt = `
You are a professional car mechanic assistant for drivers in Israel.
The user describes dashboard warning lights or car symptoms in Hebrew, sometimes while driving.
Your goals:
1. Identify the likely warning light or problem.
2. Classify URGENCY as one of: "עצור מיד", "עצור בקרוב", "אפשר להמשיך בזהירות".
3. Give short, clear instructions in simple Hebrew, suitable for listening while driving.
4. If the car is still moving – always start by telling the driver what to do right now.
5. If you are not sure – say that clearly and suggest contacting a professional mechanic or roadside assistance.

You must respond in **strict JSON** with this exact shape (no extra fields, no explanations):

{
  "urgency": "<one of 'עצור מיד' | 'עצור בקרוב' | 'אפשר להמשיך בזהירות'>",
  "shortAnswer": "<1-3 short sentences in Hebrew with clear instructions>",
  "detailedExplanation": "<longer explanation in Hebrew, can be empty string if not needed>"
}
`.trim();

    const userPrompt = `
תיאור בעיה: ${userText}
מצב נהיגה: ${drivingState || "לא ידוע"}
שפה: ${locale || "he-IL"}
`.trim();

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "openrouter/auto",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenRouter error:", response.status, errorText);
      return res.status(502).json({ error: "OpenRouter request failed" });
    }

    const data = await response.json();

    const content = data?.choices?.[0]?.message?.content;
    let parsed;

    try {
      parsed = typeof content === "string" ? JSON.parse(content) : content;
    } catch (err) {
      console.error("Failed to parse JSON from OpenRouter:", content);
      return res.status(500).json({ error: "Invalid JSON from model" });
    }

    const inRoadResponse = {
      urgency: parsed.urgency || "עצור בקרוב",
      shortAnswer: parsed.shortAnswer || "קיימת תקלה כלשהי, מומלץ לעצור במקום בטוח ולהתייעץ עם מוסך.",
      detailedExplanation: parsed.detailedExplanation || ""
    };

    return res.json(inRoadResponse);
  } catch (err) {
    console.error("Unexpected error in /v1/inroad/assist:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(PORT, () => {
  console.log(`inRoad backend listening on port ${PORT}`);
});
