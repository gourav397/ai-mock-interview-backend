require("dotenv").config();

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = "gemini-3.5-flash"; // 404 aaye to "gemini-3-flash" try karo

async function callGemini(prompt, timeoutMs = 90000) {
  if (!API_KEY) throw new Error("GEMINI_API_KEY missing in .env");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 8192 }
        }),
        signal: controller.signal
      }
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 600)}`);
    }

    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p) => p.text || "").join("").trim();

    if (!text) {
      throw new Error(
        "Gemini empty reply. finishReason: " +
          (data?.candidates?.[0]?.finishReason || "?") +
          " | blocked: " +
          JSON.stringify(data?.promptFeedback || {})
      );
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function parseJsonArray(text) {
  if (!text) return null;
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start !== -1 && end > start) text = text.slice(start, end + 1);
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("❌ JSON PARSE FAIL:", e.message);
    console.error("RAW TEXT:", text.slice(0, 800));
    return null;
  }
}

async function generateQuestions(category, difficulty = "Medium", count = 10) {
  const prompt = `
Generate ${count} HIGH QUALITY multiple choice questions.

Category: ${category}
Difficulty: ${difficulty}

Rules:
1. Important exam level questions.
2. Every question must have exactly 4 options.
3. Every option needs a detailed explanation.
4. Correct answer must exactly match one option text.
5. No duplicate questions.
6. Return ONLY valid JSON array. No markdown.

JSON FORMAT:
[
 {
  "question": "",
  "options": [
    { "text": "", "explanation": "" },
    { "text": "", "explanation": "" },
    { "text": "", "explanation": "" },
    { "text": "", "explanation": "" }
  ],
  "correctAnswer": ""
 }
]
`;

  const text = await callGemini(prompt);
  const arr = parseJsonArray(text);
  if (!Array.isArray(arr)) throw new Error("Gemini ne valid JSON array nahi diya");
  return arr.map((q) => ({ category, difficulty, ...q }));
}

async function generateResumeQuestions(resumeText, count = 10) {
  const prompt = `
You are an AI technical interviewer.

Analyze this resume:

${resumeText}

Generate ${count} interview questions based on this resume.

Rules:
1. Questions must be related to candidate skills, projects and experience.
2. Mix technical and HR questions.
3. Return ONLY valid JSON array. No markdown.

JSON FORMAT:
[
 { "question": "", "type": "technical" },
 { "question": "", "type": "hr" }
]
`;

  const text = await callGemini(prompt);
  const arr = parseJsonArray(text);
  if (!Array.isArray(arr)) throw new Error("Gemini ne valid JSON array nahi diya");
  return arr;
}

module.exports = { generateQuestions, generateResumeQuestions };
