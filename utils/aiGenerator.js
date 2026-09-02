// ============================================================
// aiGenerator.js — Bilingual Exam Question Generator
// FIXED: shared key pool (config/geminiKeys) — Render-safe ✅
// Sab functionality preserved: cache, batching, dedupe, top-up.
// ============================================================

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { keyManager, envStatus } = require("../config/geminiKeys");
const { geminiGenerate } = require("../config/geminiClient");
// Requirement: env config ko respect karo — sirf absent hone par default
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";

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

// ================= GEMINI CALL (shared client) =================
async function callGemini(prompt, timeoutMs = 60000) {
  const { text } = await geminiGenerate(prompt, {
    model: MODEL,
    temperature: 0.9,
    topP: 0.95,
    maxOutputTokens: 8192,
    responseMimeType: "application/json",
    timeoutMs,
    maxRounds: 10,
    maxPromptChars: 10000, // original 10k truncation preserve
  });
  return text;
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
  try {
    return JSON.parse(text);
  } catch (e) {}
  if (jsonrepair) {
    try {
      return JSON.parse(jsonrepair(text));
    } catch (e) {}
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

function combine(en, hi) {
  const e = (en || "").trim();
  const h = (hi || "").trim();
  if (e && h) return `${e} / ${h}`;
  return e || h;
}

function qKey(q) {
  return (q?.question || "").split(" / ")[0].trim().toLowerCase();
}

function normalizeOptions(rawOptions) {
  if (!rawOptions) return [];
  if (!Array.isArray(rawOptions)) rawOptions = Object.values(rawOptions);
  return rawOptions
    .map((o) => {
      if (typeof o === "string") return { text: o.trim(), explanation: "" };
      if (o && typeof o === "object") {
        const text = combine(o.text_en, o.text_hi) || o.text || o.option || o.value || o.label || o.answer || "";
        const explanation = combine(o.explanation_en, o.explanation_hi) || o.explanation || o.reason || o.description || o.why || "";
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
  if (!raw.question && !raw.Question && !raw.q && !raw.question_en && !raw.question_hi) return null;
  const question = combine(raw.question_en, raw.question_hi) || String(raw.question || raw.Question || raw.q || "");
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

function isBilingualQuestion(q) {
  if (!q || !q.question) return false;
  if (!hasHindi(q.question) || !hasEnglish(q.question)) return false;
  if (!q.options || q.options.length < 2) return false;
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

async function generateQuestions(category, difficulty = "Medium", count = 50, useCache = false) {
  if (useCache) {
    const cached = getCached(category, difficulty);
    if (cached && cached.length >= Math.min(count, 3)) {
      console.log(`CACHE HIT: ${category} (${cached.length} bilingual questions)`);
      return cached.slice(0, count);
    }
  }
  clearCache(category, difficulty);
  const BATCH_SIZE = 8;
  const CONCURRENCY = 1;
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
    const extraHint = tryNo > 1 ? "⚠️ PREVIOUS ATTEMPT WAS REJECTED because Hindi was missing." : "";
    const prompt = buildPrompt(category, difficulty, batchCount, batchNo, totalBatches, extraHint);
    const text = await callGemini(prompt, 60000);
    const arr = parseJsonArray(text);
    if (!Array.isArray(arr)) { console.log(`❌ Batch ${batchNo}: invalid JSON`); return []; }
    const normalized = arr.map(normalizeQuestion).filter(Boolean);
    const withFour = normalized.filter((q) => q.options.length === 4);
    const pool = withFour.length >= 2 ? withFour : normalized.filter((q) => q.options.length >= 2);
    const bilingual = pool.filter(isBilingualQuestion);
    if (bilingual.length < pool.length) console.log(`⚠️ Batch ${batchNo}: ${pool.length - bilingual.length} English-only reject kiye`);
    if (bilingual.length < batchCount && tryNo < 2) return runBatch(batchNo, batchCount, 2);
    console.log(`✅ Batch ${batchNo}: ${bilingual.length} bilingual questions`);
    return bilingual.slice(0, batchCount);
  }
  let index = 0;
  while (index < totalBatches) {
    const slice = batchCounts.slice(index, index + CONCURRENCY);
    const settled = await Promise.allSettled(slice.map((c, i) => runBatch(index + i + 1, c)));
    settled.forEach((s, i) => { if (s.status === "fulfilled") all.push(...s.value); else console.log(`❌ Batch ${index + i + 1} fail: ${s.reason?.message || s.reason}`); });
    index += CONCURRENCY;
    if (isQuotaExhausted()) break;
    if (index < totalBatches) await new Promise((r) => setTimeout(r, 5000));
  }
  const seen = new Set();
  const deduped = all.filter((q) => { const key = q.question.split(" / ")[0].trim().toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
  let result = deduped.slice(0, count);
  let topUpRounds = 0;
  while (result.length < count && topUpRounds < 2 && !isQuotaExhausted()) {
    topUpRounds++;
    const missing = count - result.length;
    const hint = "⚠️ These questions MUST be NEW.";
    const prompt = buildPrompt(category, difficulty, missing, 1, 1, hint);
    const text = await callGemini(prompt, 60000);
    const arr = parseJsonArray(text);
    if (Array.isArray(arr)) {
      const normalized = arr.map(normalizeQuestion).filter(Boolean);
      const pool = normalized.filter((q) => q.options.length === 4);
      const bilingual = pool.filter(isBilingualQuestion);
      const existing = new Set(result.map((q) => q.question.split(" / ")[0].trim().toLowerCase()));
      const freshOnes = bilingual.filter((q) => !existing.has(q.question.split(" / ")[0].trim().toLowerCase()));
      result.push(...freshOnes.slice(0, missing));
    }
    if (topUpRounds < 2 && !isQuotaExhausted()) await new Promise((r) => setTimeout(r, 3000));
  }
  if (!result.length) throw new Error("AI ne bilingual questions nahi diye");
  saveCache(category, difficulty, result);
  console.log(`🎉 TOTAL: ${result.length} bilingual questions`);
  return result;
}

async function generateResumeQuestions(resumeText, count = 50) {
  const BATCH_SIZE = 8;
  const all = [];
  const batches = Math.ceil(count / BATCH_SIZE);
  for (let b = 1; b <= batches; b++) {
    if (isQuotaExhausted()) break;
    const prompt = `You are an expert AI mock interviewer.\nAnalyze this resume:\n${resumeText}\n\nGenerate ${BATCH_SIZE} interview questions.\nRules:\n1. Each question has exactly 4 options.\n2. Each option has a SHORT explanation.\n3. correctAnswer must match one option text.\n4. Return ONLY valid JSON array.\n\nJSON FORMAT: [{"question":"...","type":"technical","options":[{"text":"...","explanation":"..."}],"correctAnswer":"...","difficulty":"Medium"}]`;
    const text = await callGemini(prompt);
    const arr = parseJsonArray(text);
    if (Array.isArray(arr)) { all.push(...arr.map(normalizeQuestion).filter(Boolean)); console.log(`Batch ${b}: ${arr.length} questions`); }
    if (all.length >= count) break;
    if (b < batches) await new Promise((r) => setTimeout(r, 3000));
  }
  return all.slice(0, count);
}

async function generateBank(category, difficulty = "Medium", targetSize = 100) {
  const BATCH_SIZE = 8;
  const CONCURRENCY = 1;
  const all = [];
  const seen = new Set();
  const batchCounts = [];
  let remaining = targetSize;
  while (remaining > 0) { batchCounts.push(Math.min(BATCH_SIZE, remaining)); remaining -= BATCH_SIZE; }
  const totalBatches = batchCounts.length;
  async function runBatch(batchNo, batchCount, tryNo = 1) {
    const extraHint = tryNo > 1 ? "⚠️ PREVIOUS ATTEMPT WAS REJECTED." : "";
    const prompt = buildPrompt(category, difficulty, batchCount, batchNo, totalBatches, extraHint);
    const text = await callGemini(prompt, 60000);
    const arr = parseJsonArray(text);
    if (!Array.isArray(arr)) return [];
    const normalized = arr.map(normalizeQuestion).filter(Boolean);
    const pool = normalized.filter((q) => q.options.length === 4);
    const bilingual = pool.filter(isBilingualQuestion);
    if (bilingual.length < batchCount && tryNo < 2) return runBatch(batchNo, batchCount, 2);
    return bilingual;
  }
  let index = 0;
  while (index < totalBatches) {
    const slice = batchCounts.slice(index, index + CONCURRENCY);
    const settled = await Promise.allSettled(slice.map((c, i) => runBatch(index + i + 1, c)));
    settled.forEach((s) => { if (s.status === "fulfilled") all.push(...s.value); });
    index += CONCURRENCY;
    if (isQuotaExhausted()) break;
    if (index < totalBatches) await new Promise((r) => setTimeout(r, 5000));
  }
  const deduped = all.filter((q) => { const key = q.question.split(" / ")[0].trim().toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
  let rounds = 0;
  while (deduped.length < targetSize && rounds < 3 && !isQuotaExhausted()) {
    rounds++;
    const missing = targetSize - deduped.length;
    const hint = "⚠️ NEW questions only.";
    const prompt = buildPrompt(category, difficulty, Math.min(missing, 8), 99, 99, hint);
    try {
      const text = await callGemini(prompt, 60000);
      const arr = parseJsonArray(text);
      if (Array.isArray(arr)) {
        const fresh = arr.map(normalizeQuestion).filter(Boolean).filter((q) => q.options.length === 4).filter(isBilingualQuestion).filter((q) => !seen.has(q.question.split(" / ")[0].trim().toLowerCase()));
        fresh.forEach((q) => seen.add(q.question.split(" / ")[0].trim().toLowerCase()));
        deduped.push(...fresh);
      }
    } catch (e) { console.log("Top-up fail:", e.message); }
    if (!isQuotaExhausted()) await new Promise((r) => setTimeout(r, 3000));
  }
  console.log(`🎉 Bank ready: ${deduped.length} unique bilingual questions`);
  return deduped;
}

async function generateInterviewQuestions(category, difficulty = "Medium", count = 30, extraHint = "") {
  const BATCH_SIZE = 8;
  const MAX_CONCURRENCY = 3;
  const PER_CALL_TIMEOUT = 15000;
  const OVERALL_TIMEOUT = 15000;
  const startTime = Date.now();
  const all = [];
  const seen = new Set();
  const batchCounts = [];
  let remaining = count;
  while (remaining > 0) { batchCounts.push(Math.min(BATCH_SIZE, remaining)); remaining -= BATCH_SIZE; }
  const totalBatches = batchCounts.length;
  let index = 0;
  while (index < totalBatches) {
    if (Date.now() - startTime > OVERALL_TIMEOUT) break;
    const slice = batchCounts.slice(index, Math.min(index + MAX_CONCURRENCY, totalBatches));
    if (slice.length === 0) break;
    const results = await Promise.allSettled(slice.map((c, i) => {
      const batchNo = index + i + 1;
      const prompt = buildPrompt(category, difficulty, c, batchNo, totalBatches, extraHint);
      return callGemini(prompt, PER_CALL_TIMEOUT).then(text => {
        if (!text) return [];
        const arr = parseJsonArray(text);
        if (!Array.isArray(arr)) return [];
        return arr.map(normalizeQuestion).filter(Boolean).filter(q => q.options.length === 4).filter(isBilingualQuestion);
      }).catch(err => { console.log(`⚡ Batch ${batchNo} failed: ${err.message.slice(0, 80)}`); return []; });
    }));
    results.forEach(s => { if (s.status === "fulfilled") all.push(...s.value); });
    index += MAX_CONCURRENCY;
    if (isQuotaExhausted()) break;
  }
  const deduped = all.filter(q => { const key = qKey(q); if (!key || seen.has(key)) return false; seen.add(key); return true; });
  return deduped.slice(0, count);
}

module.exports = { generateQuestions, generateResumeQuestions, generateBank, generateInterviewQuestions, isQuotaExhausted };