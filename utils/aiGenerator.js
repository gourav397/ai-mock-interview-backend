require("dotenv").config();

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = "gemini-3.5-flash";

// jsonrepair optional hai — installed ho to use hoga, warna fallback parser chalega
let jsonrepair = null;
try {
  ({ jsonrepair } = require("jsonrepair"));
} catch (e) {
  console.log("⚠️ jsonrepair installed nahi hai — fallback parser chalega");
}

async function callGemini(prompt, timeoutMs = 120000) {
  if (!API_KEY) throw new Error("GEMINI_API_KEY missing in .env");

  if (prompt.length > 10000) {
    prompt = prompt.slice(0, 10000) + "\n...[text truncated]";
  }

  let lastError;

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.5,
              maxOutputTokens: 32768,
              responseMimeType: "application/json"
            }
          }),
          signal: controller.signal
        }
      );

      clearTimeout(timer);

      if (res.status === 503 || res.status === 429) {
        const wait = 5000 * attempt;
        console.log(`⚠️ Gemini ${res.status} — retry ${attempt}/4 in ${wait / 1000}s`);
        await new Promise((r) => setTimeout(r, wait));
        lastError = new Error(`Gemini HTTP ${res.status} (after ${attempt} retries)`);
        continue;
      }

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 500)}`);
      }

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts
        ?.map((p) => p.text || "")
        .join("")
        .trim();

      if (!text) {
        throw new Error("Gemini empty response: " + (data?.candidates?.[0]?.finishReason || "?"));
      }
      return text;
    } catch (err) {
      lastError = err;
      if (err.name === "AbortError") {
        console.log(`⏰ Timeout — retry ${attempt}/4...`);
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

function parseJsonArray(text) {
  if (!text) return null;

  let start = text.indexOf("[");
  let end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return null;
  text = text.slice(start, end + 1);

  // 1) Seedha JSON
  try { return JSON.parse(text); } catch (e) {}

  // 2) jsonrepair — agar installed ho (missing commas, single quotes, unquoted keys sab theek)
  if (jsonrepair) {
    try {
      return JSON.parse(jsonrepair(text));
    } catch (e) {}
  }

  // 3) Last try — JS-style fixes
  try {
    const fixed = text
      .replace(/:\s*'([^']*)'/g, ': "$1"')
      .replace(/:\s*`([^`]*)`/g, ': "$1"')
      .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
    return JSON.parse(fixed);
  } catch (e) {}

  console.error("❌ JSON PARSE FAIL — raw text:", text.slice(0, 300));
  return null;
}

// ============ ROBUST NORMALIZATION ============

function normalizeOptions(rawOptions) {
  if (!rawOptions) return [];

  if (!Array.isArray(rawOptions)) {
    rawOptions = Object.values(rawOptions);
  }

  return rawOptions
    .map((o) => {
      if (typeof o === "string") {
        return { text: o.trim(), explanation: "" };
      }
      if (o && typeof o === "object") {
        const text = o.text || o.option || o.value || o.label || o.answer || "";
        const explanation = o.explanation || o.reason || o.description || o.why || "";
        return {
          text: String(text).trim(),
          explanation: String(explanation).trim()
        };
      }
      return { text: String(o).trim(), explanation: "" };
    })
    .filter((o) => o.text !== "");
}

function normalizeCorrectAnswer(ca, options) {
  if (typeof ca === "number") ca = String(ca);
  ca = (ca || "").trim();

  const letterIdx = ["A", "B", "C", "D"].indexOf(ca.toUpperCase());
  if (letterIdx !== -1 && options[letterIdx]) return options[letterIdx].text;

  if (/^[0-3]$/.test(ca) && options[parseInt(ca, 10)]) {
    return options[parseInt(ca, 10)].text;
  }

  return ca;
}

function normalizeQuestion(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!raw.question && !raw.Question && !raw.q) return null;

  const options = normalizeOptions(
    raw.options || raw.choices || raw.answers || raw.answerOptions
  );

  return {
    question: String(raw.question || raw.Question || raw.q || ""),
    type: raw.type || "technical",
    topic: raw.topic || "",
    page: raw.page || 1,
    difficulty: raw.difficulty || "Medium",
    options,
    correctAnswer: normalizeCorrectAnswer(
      raw.correctAnswer || raw.answer,
      options
    )
  };
}

async function generateQuestions(category, difficulty = "Medium", count = 10) {
  const prompt = `
Generate ${count} HIGH QUALITY multiple choice questions for category "${category}" (difficulty: ${difficulty}).

These questions are for a REAL EXAM PRACTICE TEST. Every question MUST be an IMPORTANT question that has appeared in previous exams, previous year papers, or common interview/certification tests for this topic.

Rules:
1. ONLY important, frequently-asked exam questions. No random/trivial questions.
2. Every question MUST have exactly 4 options.
3. Every option MUST have a detailed explanation (why it is correct/incorrect).
4. correctAnswer must exactly match one option text.
5. No duplicate questions.
6. Every time generate a DIFFERENT set of questions — do not repeat the same set.
7. Return ONLY valid JSON array. No markdown. No extra text.

JSON FORMAT:
[
 {
  "question": "Question here",
  "options": [
    { "text": "Option 1", "explanation": "Explanation of option 1" },
    { "text": "Option 2", "explanation": "Explanation of option 2" },
    { "text": "Option 3", "explanation": "Explanation of option 3" },
    { "text": "Option 4", "explanation": "Explanation of option 4" }
  ],
  "correctAnswer": "Option 1",
  "difficulty": "${difficulty}"
 }
]
`;

  const text = await callGemini(prompt);
  const arr = parseJsonArray(text);
  if (!Array.isArray(arr)) {
    throw new Error("Gemini ne valid JSON array nahi diya");
  }

  const normalized = arr
    .map((q) => {
      const n = normalizeQuestion(q);
      if (!n) return null;
      return { ...n, category, difficulty };
    })
    .filter(Boolean);

  // Pehle exactly 4 options wale prefer karo; agar kam mile to bhi test chalega
  const withFour = normalized.filter((q) => q.options.length === 4);
  const pool = withFour.length >= 3 ? withFour : normalized.filter((q) => q.options.length >= 2);

  return pool.slice(0, count);
}

async function generateResumeQuestions(resumeText, count = 50) {
  const BATCH_SIZE = 8;
  const all = [];
  const batches = Math.ceil(count / BATCH_SIZE);

  for (let b = 1; b <= batches; b++) {
    const prompt = `
You are an expert AI mock interviewer.
Analyze this resume content:
${resumeText}

Generate up to ${BATCH_SIZE} important interview questions (technical + HR).
Rules:
1. Every question MUST have exactly 4 options.
2. Every option MUST have an explanation.
3. correctAnswer must exactly match one option text.
4. Return ONLY valid JSON array. No markdown. No extra text.

JSON FORMAT:
[
 {
  "question": "Question here",
  "type": "technical",
  "topic": "Topic name",
  "page": 1,
  "options": [
    { "text": "Option 1", "explanation": "Why this is correct/incorrect" },
    { "text": "Option 2", "explanation": "..." },
    { "text": "Option 3", "explanation": "..." },
    { "text": "Option 4", "explanation": "..." }
  ],
  "correctAnswer": "Option 1",
  "difficulty": "Medium"
 }
]
`;

    const text = await callGemini(prompt);
    console.log(`🔥 BATCH ${b}/${batches} RAW:`);
    console.log(text.substring(0, 1500));

    const arr = parseJsonArray(text);
    if (Array.isArray(arr)) {
      all.push(...arr.map(normalizeQuestion).filter(Boolean));
      console.log(`✅ Batch ${b}: ${arr.length} questions`);
    } else {
      console.log(`❌ Batch ${b}: invalid JSON, skipping`);
    }

    if (all.length >= count) break;
  }

  console.log(`✅ TOTAL QUESTIONS GENERATED: ${all.length}`);
  return all.slice(0, count);
}

// ============ BACKWARD-COMPATIBLE EXPORTS ============
// Chahe koi bhi file kisi bhi tarah require kare — sab chalega:
//   const generateQuestions = require("../utils/aiGenerator");  ✅
//   const { generateQuestions } = require("../utils/aiGenerator");  ✅
//   const { generateResumeQuestions } = require("../utils/aiGenerator");  ✅

module.exports = generateQuestions;
module.exports.generateQuestions = generateQuestions;
module.exports.generateResumeQuestions = generateResumeQuestions;