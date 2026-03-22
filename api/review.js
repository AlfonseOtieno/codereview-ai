export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const { code, language, mode, langLabel, langHints } = req.body;

  if (!code || !language) {
    return res.status(400).json({ error: "Missing code or language" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "API key not configured on server." });
  }

  const prompt = `You are an expert ${langLabel} code reviewer.

Respond ONLY with a valid JSON object — no markdown fences, no preamble, no trailing text.

Shape:
{
  "summary": "2-3 sentence assessment for ${langLabel}",
  "score": <integer 1-10>,
  "issues": [
    {
      "category": "naming"|"logic"|"improvement"|"security"|"performance"|"style",
      "title": "short title",
      "line": <integer — the 1-based line number of the problem, or null if not applicable>,
      "description": "clear explanation referencing the specific line/code if possible",
      "suggestion": "the corrected ${langLabel} code snippet showing exactly what to change"
    }
  ],
  "praise": "one specific thing done well, referencing the code, or 'Nothing notable'"
}

IMPORTANT for "suggestion": Always provide the corrected code, not just a description.

${
  mode === "eli5"
    ? `Use simple, encouraging language for a student just learning ${langLabel}. No jargon. Explain WHY the fix is better.`
    : `Be direct and technical. Use ${langLabel}-specific idioms and best practices. Reference line numbers in descriptions.`
}

Key concerns for ${langLabel}: ${langHints}

Return ONLY the raw JSON object.

Review this ${langLabel} code:

${code}`;

  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 1200,
          },
        }),
      }
    );

    if (!upstream.ok) {
      const errText = await upstream.text();
      console.error("Gemini error:", errText);
      return res
        .status(upstream.status)
        .json({ error: `Gemini API error: ${upstream.status}` });
    }

    const data = await upstream.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const clean = raw.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      return res
        .status(500)
        .json({ error: "AI returned unexpected format. Please try again." });
    }

    if (typeof parsed.score !== "number" || !Array.isArray(parsed.issues)) {
      return res
        .status(500)
        .json({ error: "Incomplete AI response. Please try again." });
    }

    return res.status(200).json(parsed);
  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: err.message || "Review failed." });
  }
}
