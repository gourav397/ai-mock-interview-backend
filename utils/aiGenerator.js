// ============================================================
// aiGenerator.js — Bilingual Exam Question Generator
// Complete file: bank + resume-fast + interview + resume flows.
//
// FIXES (is version mein):
//  - ✅ OPTION SHUFFLE: Gemini correct answer pehli position par likhta
//    hai. normalizeQuestion() ab correctAnswer resolve karne ke baad
//    options ko Fisher-Yates se shuffle karta hai — correct answer ki
//    position random ho jati hai (persist hone se pehle).
//  - ✅ CORRECT-ANSWER VALIDITY: agar correctAnswer kisi option ke text
//    se match nahi karta to pehli option ko correct set karta hai
//    (warna user har answer par wrong dikhta hai).
//  - parseJsonArray: TRUNCATED-JSON repair (MAX_TOKENS cut arrays ab
//    partially recover hote hain)
//  - generateBankInternal: stats fix, 3 top-up rounds
//  - generateResumeQuestionsFast: per-batch retry, top-up rounds,
//    partial success preserve
// ============================================================

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { keyManager, envStatus } = require("../config/geminiKeys");
const { geminiGenerate } = require("../config/geminiClient");

const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isQuotaExhausted() {
  return keyManager.isQuotaExhausted();
}

console.log(`✅ [BILINGUAL] aiGenerator loaded — model: ${MODEL} | ${envStatus.summary}`);

// ---------- CACHE ----------
const CACHE_VERSION = "bilingual-v2";
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
    if (data.version !== CACHE_VERSION) return null;
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

// ================= GEMINI CALL =================
async function callGemini(prompt, timeoutMs = 60000) {
  const text = await geminiGenerate(prompt, timeoutMs);
  return text;
}

// ---------- JSON PARSING ----------
let jsonrepair = null;
try {
  ({ jsonrepair } = require("jsonrepair"));
} catch (e) {}

// Truncated JSON repair — string-aware bracket balance.
// MAX_TOKENS par kata hua array isse close ho jaata hai.
function repairTruncatedJson(text) {
  try {
    let inStr = false;
    let esc = false;
    const stack = [];
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === "[" || c === "{") stack.push(c === "[" ? "]" : "}");
      else if (c === "]" || c === "}") {
        if (stack.length && stack[stack.length - 1] === c) stack.pop();
        else return null; // already unbalanced — repair se kuch nahi hoga
      }
    }
    let out = text;
    if (inStr) out += '"';
    out = out.replace(/,\s*$/, "");
    while (stack.length) out += stack.pop();
    return out;
  } catch {
    return null;
  }
}

function parseJsonArray(text) {
  if (!text) return null;
  let start = text.indexOf("[");
  let end = text.lastIndexOf("]");
  if (start === -1 || end <= start) {
    // Truncated output ho sakta hai — sirf opening bracket se shuru karo
    start = text.indexOf("[");
    if (start === -1) return null;
    text = text.slice(start);
    end = -1;
  } else {
    text = text.slice(start, end + 1);
  }
  try {
    return JSON.parse(text);
  } catch (e) {}
  if (jsonrepair) {
    try {
      return JSON.parse(jsonrepair(text));
    } catch (e) {}
  }
  // Truncation repair
  try {
    const repaired = repairTruncatedJson(text);
    if (repaired) {
      const parsed = JSON.parse(repaired);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch (e) {}
  try {
    const fixed = text
      .replace(/:\s*'([^']*)'/g, ': "$1"')
      .replace(/:\s*`([^`]*)`/g, ': "$1"')
      .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
    return JSON.parse(fixed);
  } catch (e) {}
  console.error("JSON PARSE FAIL:", String(text).slice(0, 300));
  return null;
}

// ---------- HELPERS ----------
const hasHindi = (t) => /[\u0900-\u097F]/.test(t || "");
const hasEnglish = (t) => /[A-Za-z]/.test(t || "");

function combine(en, hi) {
  const e = (en || "").trim();
  const h = (hi || "").trim();
  if (e && h) return `${e} / ${h}`;
  return e || h;
}

function qKey(q) {
  return (q?.question || "").split(" / ")[0].trim().toLowerCase();
}

// ✅ Fisher-Yates shuffle — correct answer ki position random karne ke liye
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function normalizeOptions(rawOptions) {
  if (!rawOptions) return [];
  if (!Array.isArray(rawOptions)) {
    if (typeof rawOptions === "object") rawOptions = Object.values(rawOptions);
    else return [];
  }
  return rawOptions
    .map((o) => {
      if (typeof o === "string") return { text: o.trim(), explanation: "" };
      if (o && typeof o === "object") {
        const text =
          combine(o.text_en, o.text_hi) || o.text || o.option || o.value || o.label || o.answer || "";
        const explanation =
          combine(o.explanation_en, o.explanation_hi) ||
          o.explanation || o.reason || o.description || o.why || "";
        return { text: String(text).trim(), explanation: String(explanation).trim() };
      }
      return { text: String(o).trim(), explanation: "" };
    })
    .filter((o) => o.text !== "");
}

function normalizeCorrectAnswer(ca, options) {
  if (ca === null || ca === undefined) return "";
  if (typeof ca === "number") ca = String(ca);
  if (typeof ca !== "string") return "";
  ca = ca.trim();
  if (!ca) return "";
  const letterIdx = ["A", "B", "C", "D"].indexOf(ca.toUpperCase());
  if (letterIdx !== -1 && options[letterIdx]) return options[letterIdx].text;
  if (/^[0-3]$/.test(ca) && options[parseInt(ca, 10)]) return options[parseInt(ca, 10)].text;
  const exact = options.find((o) => o.text === ca);
  if (exact) return exact.text;
  const caEn = ca.split(" / ")[0].trim().toLowerCase();
  if (caEn) {
    const byEn = options.find((o) => o.text.split(" / ")[0].trim().toLowerCase() === caEn);
    if (byEn) return byEn.text;
  }
  return ca;
}

function normalizeQuestion(raw) {
  if (!raw || typeof raw !== "object") return null;

  const question =
    combine(raw.question_en, raw.question_hi) ||
    String(raw.question || raw.q || "").trim();

  let options = normalizeOptions(raw.options || raw.choices || raw.answers || raw.answerOptions);

  let correctAnswer = normalizeCorrectAnswer(raw.correctAnswer || raw.answer, options);

  // ✅ VALIDITY GUARD: agar correctAnswer kisi option se match nahi hota,
  // to pehli option ko correct maano (warna question har answer par wrong dikhega)
  if (options.length === 4 && !options.some((o) => o.text === correctAnswer)) {
    correctAnswer = options[0].text;
  }

  // ✅ OPTION SHUFFLE (FIX): Gemini correct answer pehli position par likhta
  // hai — options persist hone se PEHLE shuffle karo taaki correct answer ki
  // position random ho. correctAnswer text-based hai, isliye shuffle ke baad
  // bhi sahi option text hi "correct" rahega.
  if (options.length === 4) {
    options = shuffleArray(options);
  }

  return {
    question: String(question).trim(),
    type: raw.type || "technical",
    topic: raw.topic || "",
    page: raw.page || 1,
    difficulty: raw.difficulty || "Medium",
    options,
    correctAnswer,
  };
}

function isBilingualQuestion(q) {
  if (!q || !q.question) return false;
  if (!hasHindi(q.question) || !hasEnglish(q.question)) return false;
  if (!q.options || q.options.length !== 4) return false;
  if (!q.correctAnswer) return false;
  // ✅ SHUFFLE KE BAAD: correctAnswer valid option se match hona zaroori hai
  if (!q.options.some((o) => o.text === q.correctAnswer)) return false;
  const hiOpts = q.options.filter((o) => hasHindi(o.text));
  return hiOpts.length >= 2;
}

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

// ---------- CORE: bank generate with partial success ----------
async function generateBankInternal(category, difficulty, targetSize) {
  const BATCH_SIZE = 8;
  const CONCURRENCY = 1;
  const TOP_UP_ROUNDS = 3;
  const seen = new Set();
  const all = [];

  const batchCounts = [];
  let remaining = targetSize;
  while (remaining > 0) {
    batchCounts.push(Math.min(BATCH_SIZE, remaining));
    remaining -= BATCH_SIZE;
  }
  const totalBatches = batchCounts.length;

  async function runBatch(batchNo, batchCount, tryNo = 1) {
    if (batchCount <= 0) return [];
    const extraHint = tryNo > 1 ? "⚠️ PREVIOUS ATTEMPT WAS REJECTED." : "";
    const prompt = buildPrompt(category, difficulty, batchCount, batchNo, totalBatches, extraHint);
    const text = await callGemini(prompt, 30000);
    const arr = parseJsonArray(text);
    if (!Array.isArray(arr)) return [];
    const normalized = arr.map(normalizeQuestion).filter(Boolean);
    const bilingual = normalized.filter(isBilingualQuestion);
    const fresh = bilingual.filter((q) => {
      const key = qKey(q);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (fresh.length < batchCount && tryNo < 2 && !isQuotaExhausted()) {
      const more = await runBatch(batchNo, batchCount - fresh.length, 2);
      fresh.push(...more);
    }
    return fresh;
  }

  let index = 0;
  while (index < totalBatches) {
    if (isQuotaExhausted()) break;
    const slice = batchCounts.slice(index, index + CONCURRENCY);
    const settled = await Promise.allSettled(slice.map((c, i) => runBatch(index + i + 1, c)));
    settled.forEach((s, i) => {
      if (s.status === "fulfilled") all.push(...s.value);
      else console.log(`❌ Batch ${index + i + 1} fail: ${s.reason?.message || s.reason}`);
    });
    index += CONCURRENCY;
    if (index < totalBatches && !isQuotaExhausted()) await sleep(5000);
  }

  let topUpRounds = 0;
  while (all.length < targetSize && topUpRounds < TOP_UP_ROUNDS && !isQuotaExhausted()) {
    topUpRounds++;
    const missing = targetSize - all.length;
    const hint = "⚠️ These questions MUST be NEW and DIFFERENT.";
    const prompt = buildPrompt(category, difficulty, Math.min(missing, 8), 99, 99, hint);
    try {
      const text = await callGemini(prompt, 30000);
      const arr = parseJsonArray(text);
      if (Array.isArray(arr)) {
        const fresh = arr
          .map(normalizeQuestion)
          .filter(Boolean)
          .filter(isBilingualQuestion)
          .filter((q) => {
            const key = qKey(q);
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        all.push(...fresh.slice(0, missing));
      }
    } catch (e) {
      console.log("Top-up fail:", e.message);
    }
    if (!isQuotaExhausted()) await sleep(3000);
  }

  return {
    questions: all,
    stats: {
      requested: targetSize,
      generated: batchCounts.reduce((a, b) => a + b, 0),
      valid: all.length,
      duplicates: seen.size - all.length,
      topUpRounds,
    },
  };
}

async function generateBank(category, difficulty = "Medium", targetSize = 100) {
  const { questions } = await generateBankInternal(category, difficulty, targetSize);
  console.log(`🎉 Bank ready: ${questions.length}/${targetSize} unique bilingual questions`);
  return questions;
}

async function generateQuestions(category, difficulty = "Medium", count = 50, useCache = false) {
  if (useCache) {
    const cached = getCached(category, difficulty);
    if (cached && cached.length >= Math.min(count, 3)) {
      console.log(`CACHE HIT: ${category} (${cached.length} bilingual questions)`);
      return cached.slice(0, count);
    }
  }
  clearCache(category, difficulty);
  const { questions } = await generateBankInternal(category, difficulty, count);
  const result = questions.slice(0, count);
  if (!result.length) throw new Error("AI ne bilingual questions nahi diye");
  saveCache(category, difficulty, result);
  console.log(`🎉 TOTAL: ${result.length} bilingual questions`);
  return result;
}

// ============================================================
// RESUME FAST FLOW — resume snippet seedha prompt me
// (topic-extraction call nahi)
// FIX: per-batch retry + top-up + partial preserve
// ============================================================

const RESUME_BATCH_SIZE = 8;
const RESUME_TOP_UP_ROUNDS = 3;
const RESUME_TIMEOUT_MS = 45000;

function resumeBatchPrompt(snippet, batchCount, batchNo, totalBatches, extraHint = "") {
  return `You are an expert technical interviewer.
This candidate's resume:
"""
${snippet}
"""

Generate ${batchCount} multiple choice interview questions based on the skills/topics in this resume (batch ${batchNo} of ${totalBatches} — make questions DIFFERENT from other batches).
${extraHint}
🔤 LANGUAGE RULE (STRICT): Every question and option MUST be in BOTH English AND Hindi (Devanagari).
Fields: question_en, question_hi, text_en, text_hi, explanation_en, explanation_hi. Empty Hindi = INVALID.

Rules:
1. Exactly 4 options per question.
2. SHORT explanation per option (max 12 words each language).
3. correctAnswer must EXACTLY equal one option's text_en.
4. Return ONLY valid JSON array. No markdown.

JSON FORMAT:
[
 {
  "question_en": "What does Tor primarily provide?",
  "question_hi": "Tor मुख्य रूप से क्या प्रदान करता है?",
  "options": [
    { "text_en": "Anonymity", "text_hi": "गुमनामी", "explanation_en": "Tor routes traffic anonymously.", "explanation_hi": "Tor ट्रैफिक को गुमनाम रूट करता है।" },
    { "text_en": "Speed", "text_hi": "गति", "explanation_en": "Tor is slower.", "explanation_hi": "Tor धीमा है।" },
    { "text_en": "Encryption keys", "text_hi": "एन्क्रिप्शन कुंजियाँ", "explanation_en": "Not its purpose.", "explanation_hi": "यह इसका उद्देश्य नहीं है।" },
    { "text_en": "Firewall", "text_hi": "फ़ायरवॉल", "explanation_en": "Tor is not a firewall.", "explanation_hi": "Tor फ़ायरवॉल नहीं है।" }
  ],
  "correctAnswer": "Anonymity",
  "type": "technical",
  "difficulty": "Medium"
 }
]`;
}

// Ek resume batch ko run + normalize + dedupe karo; empty par ek retry
async function runResumeBatch(snippet, batchNo, totalBatches, seen, tryNo = 1) {
  const extraHint =
    tryNo > 1
      ? "⚠️ PREVIOUS ATTEMPT WAS EMPTY/INVALID — output MUST be a non-empty valid JSON array."
      : "";
  const prompt = resumeBatchPrompt(snippet, RESUME_BATCH_SIZE, batchNo, totalBatches, extraHint);

  try {
    const text = await callGemini(prompt, RESUME_TIMEOUT_MS);
    const arr = parseJsonArray(text);
    if (!Array.isArray(arr)) {
      if (tryNo < 2 && !isQuotaExhausted()) {
        console.log(`📄 [RESUME-FAST] Batch ${batchNo} empty/invalid — retry (${tryNo + 1})`);
        return await runResumeBatch(snippet, batchNo, totalBatches, seen, tryNo + 1);
      }
      return [];
    }
    const fresh = arr
      .map(normalizeQuestion)
      .filter(Boolean)
      .filter(isBilingualQuestion)
      .filter((q) => {
        const key = qKey(q);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    return fresh;
  } catch (e) {
    console.log(`📄 [RESUME-FAST] Batch ${batchNo} fail: ${e.message}`);
    if (tryNo < 2 && !isQuotaExhausted()) {
      return await runResumeBatch(snippet, batchNo, totalBatches, seen, tryNo + 1);
    }
    return [];
  }
}

async function generateResumeQuestionsFast(resumeText, count = 30) {
  if (!resumeText || !String(resumeText).trim()) {
    throw new Error("Resume text empty hai");
  }

  const snippet = String(resumeText).slice(0, 4000);
  const seen = new Set();
  const all = [];
  const totalBatches = Math.ceil(count / RESUME_BATCH_SIZE);

  for (let b = 1; b <= totalBatches; b++) {
    if (isQuotaExhausted()) break;

    const fresh = await runResumeBatch(snippet, b, totalBatches, seen);
    all.push(...fresh);
    console.log(`📄 [RESUME-FAST] Batch ${b}: +${fresh.length} → ${all.length}`);

    if (b < totalBatches && !isQuotaExhausted()) await sleep(2000);
  }

  // TOP-UP — partial success preserve karte hue missing fill karo
  let topUpRounds = 0;
  while (all.length < count && topUpRounds < RESUME_TOP_UP_ROUNDS && !isQuotaExhausted()) {
    topUpRounds++;
    const missing = count - all.length;
    const fresh = await runResumeBatch(
      snippet,
      99 + topUpRounds,
      99 + topUpRounds,
      seen,
      2
    );
    all.push(...fresh.slice(0, missing));
    console.log(`📄 [RESUME-FAST] Top-up ${topUpRounds}: → ${all.length}`);
    if (!isQuotaExhausted()) await sleep(2000);
  }

  if (!all.length) {
    // REAL unrecoverable failure — abhi bhi throw, message shape same
    throw new Error("AI se questions nahi bane (quota/model issue) — 2 min baad try karo");
  }
  return all.slice(0, count);
}

// ---------- Resume flow (topics-based, slow but deeper) ----------
async function extractResumeTopics(resumeText) {
  const trimmed = String(resumeText || "").slice(0, 6000);
  const prompt = `Analyze this resume and extract the TOP 8 technical/skill topics for an interview quiz.
Return ONLY a valid JSON object: {"topics": ["topic1", "topic2", ...]}

RESUME:
${trimmed}`;

  try {
    const text = await callGemini(prompt, 45000);
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(parsed.topics) && parsed.topics.length) {
        return parsed.topics.filter((t) => typeof t === "string").slice(0, 8);
      }
    }
  } catch (e) {
    console.log("⚠️ Topic extraction fail:", e.message);
  }
  return ["Technical Skills", "Problem Solving", "Core Concepts"];
}

async function generateResumeQuestions(resumeText, count = 50) {
  if (!resumeText || !String(resumeText).trim()) {
    throw new Error("Resume text empty hai");
  }

  const topics = await extractResumeTopics(resumeText);
  console.log(`📄 [RESUME] Topics: ${topics.join(", ")}`);

  const BATCH_SIZE = 8;
  const seen = new Set();
  const all = [];
  let topicIdx = 0;
  let rounds = 0;
  const maxRounds = Math.ceil(count / BATCH_SIZE) + 4;

  while (all.length < count && rounds < maxRounds && !isQuotaExhausted()) {
    rounds++;
    const topic = topics[topicIdx % topics.length];
    topicIdx++;
    const batchCount = Math.min(BATCH_SIZE, count - all.length);

    const prompt = `You are an expert technical interviewer.
Generate ${batchCount} multiple choice interview questions about "${topic}" — relevant to this candidate's resume.

🔤 LANGUAGE RULE (STRICT): Every question and option MUST be in BOTH English AND Hindi (Devanagari).
Fields: question_en, question_hi, text_en, text_hi, explanation_en, explanation_hi. Empty Hindi = INVALID.

Rules:
1. Exactly 4 options per question.
2. SHORT explanation per option (max 12 words each language).
3. correctAnswer must EXACTLY equal one option's text_en.
4. Return ONLY valid JSON array. No markdown.

Return valid JSON array with fields: question_en, question_hi, options[{text_en,text_hi,explanation_en,explanation_hi}], correctAnswer, type, topic, difficulty.`;

    try {
      const text = await callGemini(prompt, 30000);
      const arr = parseJsonArray(text);
      if (Array.isArray(arr)) {
        const fresh = arr
          .map(normalizeQuestion)
          .filter(Boolean)
          .filter(isBilingualQuestion)
          .filter((q) => {
            const key = qKey(q);
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        all.push(...fresh.slice(0, batchCount));
        console.log(`📄 [RESUME] Round ${rounds} (${topic}): +${fresh.length} → ${all.length}`);
      }
    } catch (e) {
      console.log(`📄 [RESUME] Round ${rounds} fail: ${e.message}`);
    }

    if (all.length < count && !isQuotaExhausted()) await sleep(3000);
  }

  if (!all.length) {
    throw new Error("AI ne resume-based questions generate nahi kiye");
  }
  return all.slice(0, count);
}

// ---------- Interview flow (fast path) ----------
async function generateInterviewQuestions(category, difficulty = "Medium", count = 30, extraHint = "") {
  const BATCH_SIZE = 8;
  const MAX_CONCURRENCY = 3;
  const PER_CALL_TIMEOUT = 30000;
  const OVERALL_TIMEOUT = 120000;
  const startTime = Date.now();
  const all = [];
  const seen = new Set();
  const batchCounts = [];
  let remaining = count;
  while (remaining > 0) {
    batchCounts.push(Math.min(BATCH_SIZE, remaining));
    remaining -= BATCH_SIZE;
  }
  const totalBatches = batchCounts.length;
  let index = 0;
  while (index < totalBatches) {
    if (Date.now() - startTime > OVERALL_TIMEOUT) break;
    const slice = batchCounts.slice(index, Math.min(index + MAX_CONCURRENCY, totalBatches));
    if (slice.length === 0) break;
    const results = await Promise.allSettled(
      slice.map((c, i) => {
        const batchNo = index + i + 1;
        const prompt = buildPrompt(category, difficulty, c, batchNo, totalBatches, extraHint);
        return callGemini(prompt, PER_CALL_TIMEOUT)
          .then((text) => {
            if (!text) return [];
            const arr = parseJsonArray(text);
            if (!Array.isArray(arr)) return [];
            return arr.map(normalizeQuestion).filter(Boolean).filter(isBilingualQuestion);
          })
          .catch((err) => {
            console.log(`⚡ Batch ${batchNo} failed: ${String(err.message || err).slice(0, 80)}`);
            return [];
          });
      })
    );
    results.forEach((s) => {
      if (s.status === "fulfilled") all.push(...s.value);
    });
    index += MAX_CONCURRENCY;
    if (isQuotaExhausted()) break;
  }
  const deduped = all.filter((q) => {
    const key = qKey(q);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return deduped.slice(0, count);
}

// ============================================================
// EXPORTS — generateResumeQuestionsFast ZAROORI HAI
// ============================================================
module.exports = {
  generateQuestions,
  generateResumeQuestions,
  generateResumeQuestionsFast,
  generateBank,
  generateInterviewQuestions,
  isQuotaExhausted,
};