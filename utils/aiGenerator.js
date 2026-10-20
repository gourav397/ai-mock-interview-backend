
"use strict";

// ============================================================
// utils/aiGenerator.js — AI Interview Question Generator
// Supports arbitrary categories, bilingual MCQs, bank generation,
// retry/top-up, partial recovery, cache, and resume questions.
// ============================================================

require("dotenv").config();

const fs = require("fs");
const path = require("path");

const { keyManager, envStatus } = require("../config/geminiKeys");
const geminiClientModule = require("../config/geminiClient");

let geminiGenerate = geminiClientModule.geminiGenerate;
let getAlexGeminiClient = geminiClientModule.getAlexGeminiClient;

if (
  typeof geminiGenerate !== "function" &&
  typeof getAlexGeminiClient !== "function"
) {
  try {
    const alexModule = require("../config/alexGeminiClient");
    geminiGenerate = alexModule.geminiGenerate;
    getAlexGeminiClient = alexModule.getAlexGeminiClient;
  } catch (error) {
    console.warn("[AI-GENERATOR] Optional ALEX client unavailable:", error.message);
  }
}

const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const CACHE_VERSION = "bilingual-v4";
const CACHE_DIR = path.join(__dirname, "..", "cache");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 45000;
const MAX_QUESTION_COUNT = 150;
const MAX_RETRIES_PER_BATCH = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isQuotaExhausted() {
  try {
    return Boolean(keyManager?.isQuotaExhausted?.());
  } catch {
    return false;
  }
}

console.log(
  `✅ [AI-GENERATOR] Loaded | model=${MODEL} | ${
    envStatus?.summary || "Gemini status unavailable"
  }`
);

// ============================================================
// CACHE
// ============================================================

function cacheFile(category, difficulty) {
  const safeCategory = String(category || "general")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 100);

  const safeDifficulty = String(difficulty || "Medium")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 40);

  return path.join(
    CACHE_DIR,
    `${safeCategory}-${safeDifficulty}.json`
  );
}

function getCached(category, difficulty) {
  try {
    const file = cacheFile(category, difficulty);
    if (!fs.existsSync(file)) return null;

    const data = JSON.parse(fs.readFileSync(file, "utf8"));

    if (
      data.version !== CACHE_VERSION ||
      !Array.isArray(data.questions) ||
      !data.questions.length ||
      !Number.isFinite(data.createdAt) ||
      Date.now() - data.createdAt > CACHE_TTL_MS
    ) {
      return null;
    }

    return data.questions;
  } catch (error) {
    console.warn("[AI-GENERATOR] Cache read failed:", error.message);
    return null;
  }
}

function saveCache(category, difficulty, questions) {
  try {
    if (!Array.isArray(questions) || !questions.length) return;

    fs.mkdirSync(CACHE_DIR, { recursive: true });

    fs.writeFileSync(
      cacheFile(category, difficulty),
      JSON.stringify({
        version: CACHE_VERSION,
        createdAt: Date.now(),
        questions,
      }),
      "utf8"
    );
  } catch (error) {
    console.warn("[AI-GENERATOR] Cache save failed:", error.message);
  }
}

function clearCache(category, difficulty) {
  try {
    const file = cacheFile(category, difficulty);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (error) {
    console.warn("[AI-GENERATOR] Cache clear failed:", error.message);
  }
}

// ============================================================
// GEMINI CLIENT
// ============================================================

function extractGeminiText(result) {
  if (typeof result === "string" && result.trim()) {
    return result.trim();
  }

  if (typeof result?.text === "string" && result.text.trim()) {
    return result.text.trim();
  }

  if (typeof result?.response?.text === "function") {
    try {
      const value = result.response.text();
      if (typeof value === "string" && value.trim()) return value.trim();
    } catch {
      // Continue to other available clients.
    }
  }

  return "";
}

async function callGemini(prompt, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new Error("Gemini prompt is empty or invalid");
  }

  let lastError = null;

  if (typeof geminiGenerate === "function") {
    try {
      const result = await geminiGenerate(prompt, timeoutMs);
      const text = extractGeminiText(result);

      if (text) return text;

      if (result?.error) {
        throw new Error(result.message || "Gemini generation failed");
      }

      throw new Error("Gemini returned an empty response");
    } catch (error) {
      lastError = error;
      console.warn("[AI-GENERATOR] Primary Gemini client failed:", error.message);
    }
  }

  if (typeof getAlexGeminiClient === "function") {
    try {
      const client = getAlexGeminiClient();

      if (!client || typeof client.call !== "function") {
        throw new Error("Gemini client call() method is unavailable");
      }

      const result = await client.call(prompt, {
        timeoutMs,
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
      });

      if (result?.error) {
        throw new Error(result.message || "ALEX Gemini request failed");
      }

      const text = extractGeminiText(result);
      if (text) return text;

      throw new Error("ALEX Gemini client returned an empty response");
    } catch (error) {
      lastError = error;
    }
  }

  const message = String(
    lastError?.message || "No working Gemini client is configured"
  );

  console.error(`[AI-GENERATOR] Gemini request failed: ${message}`);
  throw new Error(message);
}

// ============================================================
// JSON PARSING AND REPAIR
// ============================================================

let jsonrepair = null;

try {
  ({ jsonrepair } = require("jsonrepair"));
} catch {
  // Built-in parsing and repair remain available.
}

function repairTruncatedJson(source) {
  let text = String(source || "");
  let inString = false;
  let escaped = false;
  const stack = [];

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === "[") stack.push("]");
    else if (char === "{") stack.push("}");
    else if (char === "]" || char === "}") {
      if (stack[stack.length - 1] !== char) return null;
      stack.pop();
    }
  }

  if (inString) {
    if (escaped) text = text.slice(0, -1);
    text += '"';
  }

  text = text.replace(/,\s*$/, "");

  while (stack.length) {
    text = text.replace(/,\s*$/, "");
    text += stack.pop();
  }

  return text;
}

function parseJsonArray(source) {
  if (!source) return null;

  let text = String(source)
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  const start = text.indexOf("[");
  if (start < 0) {
    console.error("[AI-GENERATOR] JSON array opening bracket missing");
    return null;
  }

  text = text.slice(start);

  const end = text.lastIndexOf("]");
  if (end >= 0) text = text.slice(0, end + 1);

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Try repair methods.
  }

  if (jsonrepair) {
    try {
      const parsed = JSON.parse(jsonrepair(text));
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Try built-in repair.
    }
  }

  try {
    const repaired = repairTruncatedJson(text);
    if (repaired) {
      const parsed = JSON.parse(repaired);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // Return null below.
  }

  console.error("[AI-GENERATOR] JSON parsing failed:", text.slice(0, 300));
  return null;
}

// ============================================================
// NORMALIZATION AND VALIDATION
// ============================================================

function hasHindi(value) {
  return /[\u0900-\u097F]/.test(String(value || ""));
}

function hasEnglish(value) {
  return /[A-Za-z]/.test(String(value || ""));
}

function combine(en, hi) {
  const english = String(en || "").trim();
  const hindi = String(hi || "").trim();

  if (english && hindi) return `${english} / ${hindi}`;
  return english || hindi;
}

function normalizeOptions(rawOptions) {
  if (!rawOptions) return [];

  if (!Array.isArray(rawOptions)) {
    if (typeof rawOptions === "object") {
      rawOptions = Object.values(rawOptions);
    } else {
      return [];
    }
  }

  return rawOptions
    .map((option) => {
      if (typeof option === "string") {
        return { text: option.trim(), explanation: "" };
      }

      if (!option || typeof option !== "object") return null;

      const text =
        combine(option.text_en, option.text_hi) ||
        String(
          option.text ??
          option.option ??
          option.value ??
          option.label ??
          option.answer ??
          ""
        ).trim();

      const explanation =
        combine(option.explanation_en, option.explanation_hi) ||
        String(
          option.explanation ??
          option.reason ??
          option.description ??
          ""
        ).trim();

      return {
        text: String(text).trim(),
        explanation: String(explanation).trim(),
      };
    })
    .filter((option) => option?.text);
}

function normalizeCorrectAnswer(rawAnswer, options) {
  if (rawAnswer === null || rawAnswer === undefined) return "";

  if (typeof rawAnswer === "number") rawAnswer = String(rawAnswer);
  if (typeof rawAnswer !== "string") return "";

  const answer = rawAnswer.trim();
  if (!answer) return "";

  const letterIndex = ["A", "B", "C", "D"].indexOf(answer.toUpperCase());
  if (letterIndex >= 0 && options[letterIndex]) {
    return options[letterIndex].text;
  }

  if (/^[0-3]$/.test(answer)) {
    const option = options[Number(answer)];
    if (option) return option.text;
  }

  const exact = options.find(
    (option) => option.text.toLowerCase() === answer.toLowerCase()
  );
  if (exact) return exact.text;

  const normalizedAnswer = answer
    .split(" / ")[0]
    .trim()
    .toLowerCase();

  const englishMatch = options.find(
    (option) =>
      option.text.split(" / ")[0].trim().toLowerCase() === normalizedAnswer
  );

  return englishMatch?.text || "";
}

function normalizeQuestion(raw) {
  if (!raw || typeof raw !== "object") return null;

  const question =
    combine(raw.question_en, raw.question_hi) ||
    String(raw.question || raw.q || "").trim();

  if (!question) return null;

  const options = normalizeOptions(
    raw.options || raw.choices || raw.answers || raw.answerOptions
  );

  if (options.length !== 4) return null;

  const optionTexts = options.map((option) =>
    option.text.trim().toLowerCase()
  );

  if (new Set(optionTexts).size !== 4) return null;

  const correctAnswer = normalizeCorrectAnswer(
    raw.correctAnswer ??
    raw.correct_answer ??
    raw.answer ??
    raw.correctOption,
    options
  );

  if (!correctAnswer) return null;

  // Keep the answer text stable while shuffling the options.
  const normalizedOptions = options.map((option) => ({
    text: option.text,
    explanation: option.explanation || "",
  }));

  return {
    question,
    type: raw.type || "technical",
    topic: raw.topic || "",
    page: raw.page || 1,
    difficulty: raw.difficulty || "Medium",
    options: shuffleArray(normalizedOptions),
    correctAnswer,
  };
}

function shuffleArray(items) {
  const result = [...items];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

function isBilingualQuestion(question) {
  if (!question?.question) return false;
  if (!hasHindi(question.question) || !hasEnglish(question.question)) return false;

  if (!Array.isArray(question.options) || question.options.length !== 4) {
    return false;
  }

  if (!question.options.some((option) => option.text === question.correctAnswer)) {
    return false;
  }

  return question.options.filter(
    (option) => hasHindi(option.text) && hasEnglish(option.text)
  ).length >= 2;
}

function qKey(question) {
  return String(question?.question || "")
    .split(" / ")[0]
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ");
}

function normalizeGeneratedArray(rawArray, seen = new Set()) {
  if (!Array.isArray(rawArray)) return [];

  const result = [];

  for (const raw of rawArray) {
    const question = normalizeQuestion(raw);
    if (!question || !isBilingualQuestion(question)) continue;

    const key = qKey(question);
    if (!key || seen.has(key)) continue;

    seen.add(key);
    result.push(question);
  }

  return result;
}

// ============================================================
// CATEGORY-AWARE PROMPT
// ============================================================

function buildPrompt(
  category,
  difficulty,
  count,
  batchNo = 1,
  totalBatches = 1,
  extraHint = ""
) {
  const selectedCategory = String(category || "General Knowledge").trim();
  const selectedDifficulty = String(difficulty || "Medium").trim();

  return `
You are the question-generation engine for AI Interview.

EXACT USER-SELECTED CATEGORY/TOPIC: ${JSON.stringify(selectedCategory)}
REQUESTED DIFFICULTY: ${JSON.stringify(selectedDifficulty)}
QUESTIONS REQUIRED IN THIS BATCH: ${count}
BATCH NUMBER: ${batchNo} of ${totalBatches}

CATEGORY RULES:
- Generate questions strictly about the exact user-selected category/topic above.
- The category can be ANY user-defined topic, even if it is absent from an existing question bank.
- Never substitute another category just because this category is unfamiliar.
- Do not infer the topic from the user's experience or techStack.
- For example, "Reasoning" means reasoning questions; "React" means React questions;
  "Haryana GK" means Haryana general knowledge.
- Do not include unrelated questions.
- Every question must be meaningful, factual, and different from others in this response.
- Match the requested difficulty.
- Do not invent claims about previous-year exams.

${extraHint || ""}

LANGUAGE AND ANSWER RULES:
- Every question must include English and Hindi in Devanagari.
- All four options must include English and Hindi in Devanagari.
- Include a short explanation in English and Hindi for every option.
- Exactly four distinct options per question.
- Exactly one correct answer.
- correctAnswer must exactly match the English text_en of its correct option.
- Avoid ambiguous questions and avoid multiple correct options.
- Do not return duplicate questions.
- Return exactly ${count} questions if possible.
- Return JSON only: no Markdown fences, commentary, or introductory text.

Required JSON schema:
[
  {
    "question_en": "Question in English?",
    "question_hi": "हिंदी में प्रश्न?",
    "options": [
      {
        "text_en": "Option A",
        "text_hi": "विकल्प A",
        "explanation_en": "Explanation in English.",
        "explanation_hi": "हिंदी में व्याख्या।"
      },
      {
        "text_en": "Option B",
        "text_hi": "विकल्प B",
        "explanation_en": "Explanation in English.",
        "explanation_hi": "हिंदी में व्याख्या।"
      },
      {
        "text_en": "Option C",
        "text_hi": "विकल्प C",
        "explanation_en": "Explanation in English.",
        "explanation_hi": "हिंदी में व्याख्या।"
      },
      {
        "text_en": "Option D",
        "text_hi": "विकल्प D",
        "explanation_en": "Explanation in English.",
        "explanation_hi": "हिंदी में व्याख्या।"
      }
    ],
    "correctAnswer": "Option A",
    "type": "general",
    "topic": ${JSON.stringify(selectedCategory)},
    "difficulty": ${JSON.stringify(selectedDifficulty)}
  }
]
`;
}

// ============================================================
// BATCH GENERATION WITH RETRIES AND PARTIAL RECOVERY
// ============================================================

async function generateBatch(
  category,
  difficulty,
  requestedCount,
  batchNo,
  totalBatches,
  seen,
  extraHint = "",
  retryLimit = MAX_RETRIES_PER_BATCH
) {
  const collected = [];
  let attempt = 0;

  while (
    collected.length < requestedCount &&
    attempt < retryLimit &&
    !isQuotaExhausted()
  ) {
    attempt++;

    const missing = requestedCount - collected.length;
    const retryHint = attempt > 1
      ? `
RETRY INSTRUCTIONS:
The previous attempt returned too few valid questions.
Generate ${missing} NEW valid questions now.
Use different question wording and different facts/problems.
Do not repeat questions from earlier attempts.
Make sure all bilingual fields, four options, and correctAnswer are valid.
`
      : "";

    const prompt = buildPrompt(
      category,
      difficulty,
      missing,
      batchNo,
      totalBatches,
      [extraHint, retryHint].filter(Boolean).join("\n")
    );

    try {
      const response = await callGemini(prompt, DEFAULT_TIMEOUT_MS);
      const parsed = parseJsonArray(response);
      const fresh = normalizeGeneratedArray(parsed, seen);

      collected.push(...fresh.slice(0, missing));

      console.log(
        `[AI-GENERATOR] Batch ${batchNo}/${totalBatches} attempt ${attempt}/${retryLimit}: +${fresh.length}, collected=${collected.length}/${requestedCount}`
      );
    } catch (error) {
      console.error(
        `[AI-GENERATOR] Batch ${batchNo} attempt ${attempt} failed:`,
        error.message
      );
    }

    if (collected.length < requestedCount && attempt < retryLimit) {
      await sleep(attempt * 700);
    }
  }

  return collected.slice(0, requestedCount);
}

// ============================================================
// SHARED QUESTION GENERATION LOOP
// ============================================================

async function generateQuestionsInternal(
  category,
  difficulty,
  targetSize,
  extraHint = "",
  timeLimitMs = 240000
) {
  const requested = Math.min(
    Math.max(Number(targetSize) || 1, 1),
    MAX_QUESTION_COUNT
  );

  const startTime = Date.now();
  const batchSize = 8;
  const seen = new Set();
  const all = [];
  let batchNo = 0;

  while (all.length < requested) {
    if (isQuotaExhausted()) {
      console.warn(
        `[AI-GENERATOR] Quota exhausted; keeping ${all.length}/${requested} valid questions`
      );
      break;
    }

    if (Date.now() - startTime >= timeLimitMs) {
      console.warn(
        `[AI-GENERATOR] Generation time limit reached; keeping ${all.length}/${requested}`
      );
      break;
    }

    batchNo++;

    const missing = requested - all.length;
    const count = Math.min(batchSize, missing);

    const fresh = await generateBatch(
      category,
      difficulty,
      count,
      batchNo,
      Math.ceil(requested / batchSize),
      seen,
      [
        extraHint,
        all.length
          ? `Already generated ${all.length} valid questions. Generate only new questions for the exact category "${category}".`
          : "",
      ].filter(Boolean).join("\n")
    );

    all.push(...fresh);

    console.log(
      `[AI-GENERATOR] Category="${category}" difficulty="${difficulty}" batch=${batchNo}: +${fresh.length}; total=${all.length}/${requested}`
    );

    if (!fresh.length && isQuotaExhausted()) break;

    // Do not spin forever if the model repeatedly returns no valid questions.
    if (!fresh.length && batchNo >= Math.ceil(requested / batchSize) + 3) {
      console.warn("[AI-GENERATOR] Stopping after repeated empty batches");
      break;
    }

    if (all.length < requested) await sleep(400);
  }

  console.log(
    `[AI-GENERATOR] Finished category="${category}" difficulty="${difficulty}" requested=${requested} valid=${all.length} quotaExhausted=${isQuotaExhausted()} elapsedMs=${Date.now() - startTime}`
  );

  return all.slice(0, requested);
}

// ============================================================
// QUESTION BANK GENERATION
// ============================================================

async function generateBankInternal(category, difficulty, targetSize) {
  const questions = await generateQuestionsInternal(
    category,
    difficulty,
    targetSize,
    "Generate a varied question-bank batch. Questions must remain strictly within the selected category.",
    240000
  );

  return {
    questions,
    stats: {
      requested: Math.min(
        Math.max(Number(targetSize) || 1, 1),
        MAX_QUESTION_COUNT
      ),
      valid: questions.length,
    },
  };
}

async function generateBank(
  category,
  difficulty = "Medium",
  targetSize = 100
) {
  const result = await generateBankInternal(category, difficulty, targetSize);

  console.log(
    `[AI-GENERATOR] Bank completed: ${result.questions.length}/${targetSize} for "${category}"`
  );

  return result.questions;
}

async function generateQuestions(
  category,
  difficulty = "Medium",
  count = 50,
  useCache = false
) {
  const requested = Math.min(
    Math.max(Number(count) || 1, 1),
    MAX_QUESTION_COUNT
  );

  if (useCache) {
    const cached = getCached(category, difficulty);

    if (cached?.length >= requested) {
      console.log(`[AI-GENERATOR] Cache hit: ${category}/${difficulty}`);
      return cached.slice(0, requested);
    }
  }

  const questions = await generateQuestionsInternal(
    category,
    difficulty,
    requested,
    "",
    240000
  );

  if (!questions.length) {
    throw new Error(
      `No valid questions generated for "${category}" (${difficulty}). Check Gemini quota, API errors, and generation logs.`
    );
  }

  if (questions.length < requested) {
    console.warn(
      `[AI-GENERATOR] Partial result: ${questions.length}/${requested} for "${category}". Valid questions preserved.`
    );
  }

  saveCache(category, difficulty, questions);
  return questions.slice(0, requested);
}

// ============================================================
// INTERVIEW QUESTION GENERATION
// ============================================================

async function generateInterviewQuestions(
  category,
  difficulty = "Medium",
  count = 30,
  extraHint = ""
) {
  const requested = Math.min(
    Math.max(Number(count) || 1, 1),
    MAX_QUESTION_COUNT
  );

  console.log(
    `[AI-INTERVIEW] Starting category="${category}" difficulty="${difficulty}" requested=${requested}`
  );

  const questions = await generateQuestionsInternal(
    category,
    difficulty,
    requested,
    extraHint,
    240000
  );

  console.log(
    `[AI-INTERVIEW] Finished category="${category}" difficulty="${difficulty}" requested=${requested} valid=${questions.length} quotaExhausted=${isQuotaExhausted()}`
  );

  // Preserve every valid result, even when provider quota/time limits prevent
  // reaching the requested count. The calling route should report the actual total.
  return questions.slice(0, requested);
}

// ============================================================
// RESUME QUESTION GENERATION
// ============================================================

async function extractResumeTopics(resumeText) {
  const snippet = String(resumeText || "").slice(0, 6000);

  if (!snippet.trim()) {
    return ["Technical Skills", "Problem Solving", "Core Concepts"];
  }

  const prompt = `
Analyze this resume and extract up to 8 specific interview topics.

Return JSON only:
{"topics":["topic1","topic2","topic3"]}

Resume:
"""
${snippet}
"""
`;

  try {
    const response = await callGemini(prompt, DEFAULT_TIMEOUT_MS);
    const start = response.indexOf("{");
    const end = response.lastIndexOf("}");

    if (start >= 0 && end > start) {
      const parsed = JSON.parse(response.slice(start, end + 1));

      if (Array.isArray(parsed.topics)) {
        const topics = parsed.topics
          .filter((topic) => typeof topic === "string")
          .map((topic) => topic.trim())
          .filter(Boolean)
          .slice(0, 8);

        if (topics.length) return topics;
      }
    }
  } catch (error) {
    console.warn("[RESUME] Topic extraction failed:", error.message);
  }

  return ["Technical Skills", "Problem Solving", "Core Concepts"];
}

async function generateResumeQuestions(resumeText, count = 50) {
  if (!String(resumeText || "").trim()) {
    throw new Error("Resume text is empty");
  }

  const requested = Math.min(
    Math.max(Number(count) || 1, 1),
    MAX_QUESTION_COUNT
  );

  const topics = await extractResumeTopics(resumeText);
  const seen = new Set();
  const all = [];
  const resume = String(resumeText).slice(0, 5000);

  console.log("[RESUME] Topics:", topics.join(", "));

  for (
    let round = 0;
    round < Math.ceil(requested / 8) + 3 && all.length < requested;
    round++
  ) {
    if (isQuotaExhausted()) break;

    const topic = topics[round % topics.length];
    const missing = Math.min(8, requested - all.length);

    const prompt = `
You are an expert interviewer.
Generate ${missing} distinct MCQ interview questions about "${topic}"
based on this resume:

"""
${resume}
"""

Every question and option must include English and Hindi in Devanagari.
Exactly four distinct options per question.
Each option needs English and Hindi explanations.
correctAnswer must exactly match the correct option's text_en.
Return only a JSON array. No Markdown or commentary.

Schema:
[
  {
    "question_en": "Example question?",
    "question_hi": "उदाहरण प्रश्न?",
    "options": [
      {"text_en":"Option A","text_hi":"विकल्प A","explanation_en":"Explanation","explanation_hi":"व्याख्या"},
      {"text_en":"Option B","text_hi":"विकल्प B","explanation_en":"Explanation","explanation_hi":"व्याख्या"},
      {"text_en":"Option C","text_hi":"विकल्प C","explanation_en":"Explanation","explanation_hi":"व्याख्या"},
      {"text_en":"Option D","text_hi":"विकल्प D","explanation_en":"Explanation","explanation_hi":"व्याख्या"}
    ],
    "correctAnswer":"Option A",
    "topic":${JSON.stringify(topic)},
    "difficulty":"Medium"
  }
]
`;

    try {
      const response = await callGemini(prompt, DEFAULT_TIMEOUT_MS);
      const parsed = parseJsonArray(response);
      const fresh = normalizeGeneratedArray(parsed, seen);
      all.push(...fresh.slice(0, missing));

      console.log(
        `[RESUME] Round ${round + 1}: +${fresh.length}; total=${all.length}/${requested}`
      );
    } catch (error) {
      console.error(`[RESUME] Round ${round + 1} failed:`, error.message);
    }

    if (all.length < requested) await sleep(400);
  }

  if (!all.length) {
    throw new Error(
      "No valid resume questions generated. Check Gemini API, quota, and logs."
    );
  }

  return all.slice(0, requested);
}

async function generateResumeQuestionsFast(resumeText, count = 30) {
  // Keep the fast export available to existing route imports.
  // The same validated generator is used to avoid inconsistent MCQ validation.
  return generateResumeQuestions(resumeText, count);
}

// ============================================================
// EXPORTS — keep names compatible with existing routes
// ============================================================

module.exports = {
  generateQuestions,
  generateResumeQuestions,
  generateResumeQuestionsFast,
  generateBank,
  generateInterviewQuestions,
  isQuotaExhausted,
};
