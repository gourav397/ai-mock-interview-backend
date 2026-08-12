require("dotenv").config();

const fs = require("fs");
const path = require("path");

const API_KEY = process.env.GEMINI_API_KEY;
// SPEED TIP: lite model isse kaafi fast hai
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

// ---------- CACHE SETUP (optional — sirf tab use hoga jab explicitly kaha jaye) ----------
const CACHE_DIR = path.join(__dirname, "..", "cache");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function cacheFile(category, difficulty) {
  const safe = category.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(CACHE_DIR, `${safe}-${difficulty}.json`);
}

function getCached(category, difficulty) {
  try {
    const file = cacheFile(category, difficulty);
    if (!fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(data.questions) || !data.questions.length) return null;
    if (Date.now() - data.createdAt > CACHE_TTL_MS) return null;
    return data.questions;
  } catch {
    return null;
  }
}

function saveCache(category, difficulty, questions) {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(
      cacheFile(category, difficulty),
      JSON.stringify({ createdAt: Date.now(), questions })
    );
  } catch (e) {
    console.log("Cache save fail:", e.message);
  }
}

function clearCache(category, difficulty) {
  try {
    const file = cacheFile(category, difficulty);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {}
}

// ---------- GEMINI CALL (backoff + jitter + Retry-After) ----------
async function callGemini(prompt, timeoutMs = 90000) {
  if (!API_KEY) throw new Error("GEMINI_API_KEY missing in .env");

  if (prompt.length > 10000) {
    prompt = prompt.slice(0, 10000) + "\n...[text truncated]";
  }

  let lastError;

  for (let attempt = 1; attempt <= 5; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": API_KEY
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.9,   // 🔥 variation ke liye
              topP: 0.95,
              maxOutputTokens: 8192,
              responseMimeType: "application/json"
            }
          }),
          signal: controller.signal
        }
      );

      clearTimeout(timer);

      if (res.status === 429 || res.status === 503) {
        const retryAfter = parseInt(res.headers.get("retry-after") || "0", 10);
        const wait = (retryAfter || 2000 * attempt) + Math.floor(Math.random() * 1500);
        console.log(`Gemini ${res.status} — retry ${attempt}/5 in ${Math.round(wait / 1000)}s`);
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
      clearTimeout(timer);
      lastError = err;
      if (err.name === "AbortError") {
        console.log(`Timeout — retry ${attempt}/5...`);
        await new Promise((r) => setTimeout(r, 4000));
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

// ---------- JSON PARSING ----------
let jsonrepair = null;
try {
  ({ jsonrepair } = require("jsonrepair"));
} catch (e) {}

function parseJsonArray(text) {
  if (!text) return null;

  let start = text.indexOf("[");
  let end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return null;
  text = text.slice(start, end + 1);

  try { return JSON.parse(text); } catch (e) {}

  if (jsonrepair) {
    try { return JSON.parse(jsonrepair(text)); } catch (e) {}
  }

  try {
    const fixed = text
      .replace(/:\s*'([^']*)'/g, ': "$1"')
      .replace(/:\s*`([^`]*)`/g, ': "$1"')
      .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
    return JSON.parse(fixed);
  } catch (e) {}

  console.error("JSON PARSE FAIL:", text.slice(0, 300));
  return null;
}

function normalizeOptions(rawOptions) {
  if (!rawOptions) return [];
  if (!Array.isArray(rawOptions)) rawOptions = Object.values(rawOptions);

  return rawOptions
    .map((o) => {
      if (typeof o === "string") return { text: o.trim(), explanation: "" };
      if (o && typeof o === "object") {
        const text = o.text || o.option || o.value || o.label || o.answer || "";
        const explanation = o.explanation || o.reason || o.description || o.why || "";
        return { text: String(text).trim(), explanation: String(explanation).trim() };
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

  const options = normalizeOptions(raw.options || raw.choices || raw.answers || raw.answerOptions);

  return {
    question: String(raw.question || raw.Question || raw.q || ""),
    type: raw.type || "technical",
    topic: raw.topic || "",
    page: raw.page || 1,
    difficulty: raw.difficulty || "Medium",
    options,
    correctAnswer: normalizeCorrectAnswer(raw.correctAnswer || raw.answer, options)
  };
}

// ---------- BATCH PROMPT BUILDER ----------
function buildPrompt(category, difficulty, batchCount, batchNo, totalBatches) {
  return `
You are an expert exam question generator.
Generate ${batchCount} HIGH QUALITY multiple choice questions for category "${category}" (difficulty: ${difficulty}).

These are for a REAL EXAM PRACTICE TEST. Every question MUST be an IMPORTANT question that has appeared in previous exams / previous year papers / common interview tests.

This is batch ${batchNo} of ${totalBatches} — questions MUST be DIFFERENT from other batches (different subtopics, different concepts).

Rules:
1. ONLY important, frequently-asked exam questions. No random/trivial questions.
2. Every question MUST have exactly 4 options.
3. Every option MUST have a SHORT explanation (maximum 15 words, one line only).
4. correctAnswer must exactly match one option text.
5. No duplicate questions within this batch.
6. Return ONLY valid JSON array. No markdown. No extra text.

JSON FORMAT:
[
 {
  "question": "Question here",
  "options": [
    { "text": "Option 1", "explanation": "short reason" },
    { "text": "Option 2", "explanation": "short reason" },
    { "text": "Option 3", "explanation": "short reason" },
    { "text": "Option 4", "explanation": "short reason" }
  ],
  "correctAnswer": "Option 1",
  "difficulty": "${difficulty}"
 }
]
`;
}

// ---------- MAIN GENERATOR (BATCH-BASED — 8 per call, fresh by default) ----------
async function generateQuestions(category, difficulty = "Medium", count = 5, useCache = false) {
  // Cache SIRF tab use karo jab explicitly kaha jaye (useCache = true)
  if (useCache) {
    const cached = getCached(category, difficulty);
    if (cached && cached.length >= Math.min(count, 3)) {
      console.log(`CACHE HIT: ${category} (${cached.length} questions)`);
      return cached.slice(0, count);
    }
  }

  // 🔥 Fresh generation — purana cache hatao
  clearCache(category, difficulty);

  const BATCH_SIZE = 8; // har call mein 8 questions — Gemini truncation se bachao
  const all = [];
  const batches = Math.ceil(count / BATCH_SIZE);

  for (let b = 1; b <= batches; b++) {
    const remaining = count - all.length;
    if (remaining <= 0) break;
    const batchCount = Math.min(BATCH_SIZE, remaining);

    console.log(`🔨 Batch ${b}/${batches}: ${batchCount} questions (${category})`);

    const prompt = buildPrompt(category, difficulty, batchCount, b, batches);
    const text = await callGemini(prompt, 90000);
    const arr = parseJsonArray(text);

    if (Array.isArray(arr)) {
      const normalized = arr.map(normalizeQuestion).filter(Boolean);
      const withFour = normalized.filter((q) => q.options.length === 4);
      const pool = withFour.length >= 2 ? withFour : normalized.filter((q) => q.options.length >= 2);
      all.push(...pool.slice(0, batchCount));
      console.log(`✅ Batch ${b}: ${pool.length} questions`);
    } else {
      console.log(`❌ Batch ${b}: invalid JSON, skipping`);
    }

    // Rate limit se bachne ke liye chhota delay
    if (b < batches) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  const result = all.slice(0, count);
  if (!result.length) {
    throw new Error("AI se valid questions nahi mile");
  }

  saveCache(category, difficulty, result);
  return result;
}

// ---------- RESUME QUESTIONS (batch — same upgraded callGemini use karta hai) ----------
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
This is batch ${b} of ${batches} — questions MUST be DIFFERENT from other batches.
Rules:
1. Every question MUST have exactly 4 options.
2. Every option MUST have a SHORT explanation (max 15 words).
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
    { "text": "Option 1", "explanation": "short reason" },
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
    const arr = parseJsonArray(text);
    if (Array.isArray(arr)) {
      all.push(...arr.map(normalizeQuestion).filter(Boolean));
      console.log(`Batch ${b}: ${arr.length} questions`);
    } else {
      console.log(`Batch ${b}: invalid JSON, skipping`);
    }

    if (all.length >= count) break;
    if (b < batches) await new Promise((r) => setTimeout(r, 1500));
  }

  return all.slice(0, count);
}

// ✅ Clean export — route mein destructure isi se kaam karega
module.exports = {
  generateQuestions,
  generateResumeQuestions
};