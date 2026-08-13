require("dotenv").config();

const fs = require("fs");
const path = require("path");

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

console.log("✅ [BILINGUAL] aiGenerator loaded — model:", MODEL);

// ---------- CACHE (version-checked) ----------
const CACHE_VERSION = "bilingual-v2"; // purana English cache isse invalid ho jayega
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
    if (data.version !== CACHE_VERSION) return null; // purana cache → ignore
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
      JSON.stringify({ version: CACHE_VERSION, createdAt: Date.now(), questions })
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

// ---------- GEMINI CALL ----------
async function callGemini(prompt, timeoutMs = 60000) {
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
              temperature: 0.9,
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

// ---------- HELPERS ----------
const hasHindi = (t) => /[\u0900-\u097F]/.test(t || "");
const hasEnglish = (t) => /[A-Za-z]/.test(t || "");

// "English text" + "हिंदी पाठ" → "English text / हिंदी पाठ"
function combine(en, hi) {
  const e = (en || "").trim();
  const h = (hi || "").trim();
  if (e && h) return `${e} / ${h}`;
  return e || h;
}

// ---------- NORMALIZATION (naya en/hi format + purana format dono handle) ----------
function normalizeOptions(rawOptions) {
  if (!rawOptions) return [];
  if (!Array.isArray(rawOptions)) rawOptions = Object.values(rawOptions);

  return rawOptions
    .map((o) => {
      if (typeof o === "string") return { text: o.trim(), explanation: "" };
      if (o && typeof o === "object") {
        const text = combine(o.text_en, o.text_hi) ||
          o.text || o.option || o.value || o.label || o.answer || "";
        const explanation = combine(o.explanation_en, o.explanation_hi) ||
          o.explanation || o.reason || o.description || o.why || "";
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

  const exact = options.find((o) => o.text === ca);
  if (exact) return exact.text;

  // Fuzzy — sirf English part match ("Faridabad" vs "Faridabad / फरीदाबाद")
  const caEn = ca.split(" / ")[0].trim().toLowerCase();
  if (caEn) {
    const byEn = options.find(
      (o) => o.text.split(" / ")[0].trim().toLowerCase() === caEn
    );
    if (byEn) return byEn.text;
  }

  return ca;
}

function normalizeQuestion(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!raw.question && !raw.Question && !raw.q && !raw.question_en && !raw.question_hi) return null;

  const question = combine(raw.question_en, raw.question_hi) ||
    String(raw.question || raw.Question || raw.q || "");

  const options = normalizeOptions(raw.options || raw.choices || raw.answers || raw.answerOptions);

  return {
    question: String(question).trim(),
    type: raw.type || "technical",
    topic: raw.topic || "",
    page: raw.page || 1,
    difficulty: raw.difficulty || "Medium",
    options,
    correctAnswer: normalizeCorrectAnswer(raw.correctAnswer || raw.answer, options)
  };
}

// Question bilingual hai? (English + Hindi dono hona chahiye)
function isBilingualQuestion(q) {
  if (!q || !q.question) return false;
  if (!hasHindi(q.question) || !hasEnglish(q.question)) return false;
  if (!q.options || q.options.length < 2) return false;
  // Kam se kam 2 options me bhi Hindi ho
  const hiOpts = q.options.filter((o) => hasHindi(o.text));
  return hiOpts.length >= 2;
}

// ---------- PROMPT BUILDER (alag en/hi fields — model ke liye aasaan) ----------
function buildPrompt(category, difficulty, batchCount, batchNo, totalBatches, extraHint = "") {
  return `
You are an expert exam question generator for Indian competitive exams.
Generate ${batchCount} HIGH QUALITY multiple choice questions for category "${category}" (difficulty: ${difficulty}).

🔤 LANGUAGE RULE (STRICT — MUST FOLLOW):
Every question and every option MUST be provided in BOTH English AND Hindi (Devanagari).
You will fill SEPARATE fields: question_en (English), question_hi (Hindi), text_en (English option), text_hi (Hindi option), explanation_en, explanation_hi.
- Hindi must be proper Devanagari (देवनागरी लिपि), NOT Roman/Hinglish.
- Never leave question_hi or text_hi empty. Empty Hindi = INVALID output.
${extraHint}
These are for a REAL EXAM PRACTICE TEST. Every question MUST be an IMPORTANT question from previous exams / previous year papers / common interview tests.

This is batch ${batchNo} of ${totalBatches} — questions MUST be DIFFERENT from other batches.

Rules:
1. ONLY important, frequently-asked exam questions.
2. Every question MUST have exactly 4 options.
3. Every option MUST have a SHORT explanation (max 12 words in English, max 12 words in Hindi).
4. correctAnswer must EXACTLY equal one option's text_en (English only).
5. No duplicate questions within this batch.
6. Return ONLY valid JSON array. No markdown. No extra text.

JSON FORMAT:
[
 {
  "question_en": "What is the capital of India?",
  "question_hi": "भारत की राजधानी क्या है?",
  "options": [
    { "text_en": "New Delhi", "text_hi": "नई दिल्ली", "explanation_en": "It is the national capital.", "explanation_hi": "यह राष्ट्रीय राजधानी है।" },
    { "text_en": "Mumbai", "text_hi": "मुंबई", "explanation_en": "It is the financial capital.", "explanation_hi": "यह वित्तीय राजधानी है।" },
    { "text_en": "Kolkata", "text_hi": "कोलकाता", "explanation_en": "It is the cultural capital.", "explanation_hi": "यह सांस्कृतिक राजधानी है।" },
    { "text_en": "Chennai", "text_hi": "चेन्नई", "explanation_en": "It is in Tamil Nadu.", "explanation_hi": "यह तमिलनाडु में है।" }
  ],
  "correctAnswer": "New Delhi",
  "difficulty": "${difficulty}"
 }
]
`;
}

// ---------- MAIN GENERATOR ----------
async function generateQuestions(category, difficulty = "Medium", count = 5, useCache = true) {
  if (useCache) {
    const cached = getCached(category, difficulty);
    if (cached && cached.length >= Math.min(count, 3)) {
      console.log(`CACHE HIT: ${category} (${cached.length} bilingual questions)`);
      return cached.slice(0, count);
    }
  }

  clearCache(category, difficulty);

  const BATCH_SIZE = 8;
  const CONCURRENCY = 2; // free tier ke liye 2 hi safe (rate limit)

  const batchCounts = [];
  let remainingCount = count;
  while (remainingCount > 0) {
    batchCounts.push(Math.min(BATCH_SIZE, remainingCount));
    remainingCount -= BATCH_SIZE;
  }
  const totalBatches = batchCounts.length;
  console.log(`🔨 ${totalBatches} batches (${CONCURRENCY} parallel) for ${category}`);

  const all = [];

  async function runBatch(batchNo, batchCount, tryNo = 1) {
    const extraHint = tryNo > 1
      ? "⚠️ PREVIOUS ATTEMPT WAS REJECTED because Hindi was missing. This time you MUST write proper Devanagari Hindi in EVERY question_hi and text_hi field. Double-check before responding."
      : "";
    const prompt = buildPrompt(category, difficulty, batchCount, batchNo, totalBatches, extraHint);
    const text = await callGemini(prompt, 60000);
    const arr = parseJsonArray(text);
    if (!Array.isArray(arr)) {
      console.log(`❌ Batch ${batchNo}: invalid JSON`);
      return [];
    }
    const normalized = arr.map(normalizeQuestion).filter(Boolean);
    const withFour = normalized.filter((q) => q.options.length === 4);
    const pool = withFour.length >= 2 ? withFour : normalized.filter((q) => q.options.length >= 2);
    const bilingual = pool.filter(isBilingualQuestion);

    if (bilingual.length < pool.length) {
      console.log(`⚠️ Batch ${batchNo}: ${pool.length - bilingual.length} English-only reject kiye`);
    }

    // Agar kaafi bilingual nahi mile → 1 retry
    if (bilingual.length < batchCount && tryNo < 2) {
      console.log(`🔁 Batch ${batchNo}: sirf ${bilingual.length} bilingual mile, retry...`);
      const retry = await runBatch(batchNo, batchCount, 2);
      return retry;
    }

    console.log(`✅ Batch ${batchNo}: ${bilingual.length} bilingual questions`);
    return bilingual.slice(0, batchCount);
  }

  let index = 0;
  while (index < totalBatches) {
    const slice = batchCounts.slice(index, index + CONCURRENCY);
    const settled = await Promise.allSettled(
      slice.map((c, i) => runBatch(index + i + 1, c))
    );
    settled.forEach((s, i) => {
      if (s.status === "fulfilled") {
        all.push(...s.value);
      } else {
        console.log(`❌ Batch ${index + i + 1} fail: ${s.reason?.message || s.reason}`);
      }
    });
    index += CONCURRENCY;
    if (index < totalBatches) await new Promise((r) => setTimeout(r, 1200));
  }

  const result = all.slice(0, count);
  if (!result.length) {
    throw new Error("AI ne bilingual (English+Hindi) questions nahi diye — dobara try karein");
  }

  saveCache(category, difficulty, result);
  console.log(`🎉 TOTAL: ${result.length} bilingual questions (English + Hindi)`);
  return result;
}

// ---------- RESUME QUESTIONS ----------
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
This is batch ${b} of ${batches}.
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

module.exports = {
  generateQuestions,
  generateResumeQuestions
};