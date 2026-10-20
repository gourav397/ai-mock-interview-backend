// ============================================================
// aiGenerator.js — AI Interview Question Generator
// Supports:
// - Any user-selected category/topic
// - English + Hindi bilingual questions
// - Question bank generation
// - Interview question generation with partial-result recovery
// - Resume-based questions
// - Gemini API error diagnostics
// - JSON repair and duplicate filtering
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
    console.warn(
      "[AI-GENERATOR] Optional ALEX Gemini client unavailable:",
      error.message
    );
  }
}

const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

const CACHE_VERSION = "bilingual-v3";
const CACHE_DIR = path.join(__dirname, "..", "cache");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const DEFAULT_TIMEOUT_MS = 45000;
const MAX_QUESTION_COUNT = 150;

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
  `✅ [AI-GENERATOR] Loaded | model=${MODEL} | ${envStatus?.summary || "Gemini status unavailable"}`
);

// ============================================================
// CACHE
// ============================================================

function cacheFile(category, difficulty) {
  const safeCategory = String(category || "general")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 100);

  const safeDifficulty = String(difficulty || "Medium")
    .replace(/[^a-zA-Z0-9_-]/g, "_");

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

    if (data.version !== CACHE_VERSION) return null;

    if (!Array.isArray(data.questions) || !data.questions.length) {
      return null;
    }

    if (
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
    if (!Array.isArray(questions) || questions.length === 0) return;

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

    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
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

  if (
    typeof result?.response?.text === "function"
  ) {
    const text = result.response.text();

    if (typeof text === "string" && text.trim()) {
      return text.trim();
    }
  }

  return "";
}

async function callGemini(prompt, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!prompt || typeof prompt !== "string") {
    throw new Error("Gemini prompt is empty or invalid");
  }

  let lastError = null;

  if (typeof geminiGenerate === "function") {
    try {
      const result = await geminiGenerate(prompt, timeoutMs);
      const text = extractGeminiText(result);

      if (text) return text;

      if (result?.error) {
        throw new Error(
          result.message || "Gemini generation returned an error"
        );
      }

      throw new Error("Gemini returned an empty response");
    } catch (error) {
      lastError = error;
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
        throw new Error(
          result.message || "Gemini client request failed"
        );
      }

      const text = extractGeminiText(result);

      if (text) return text;

      throw new Error("Gemini client returned an empty response");
    } catch (error) {
      lastError = error;
    }
  }

  const message = String(
    lastError?.message || "Gemini client is not configured"
  );

  console.error(
    `[AI-GENERATOR] Gemini request failed: ${message}`
  );

  throw new Error(message);
}

// ============================================================
// JSON PARSER AND REPAIR
// ============================================================

let jsonrepair = null;

try {
  ({ jsonrepair } = require("jsonrepair"));
} catch {
  // The built-in parser and truncated-output repair remain available.
}

function repairTruncatedJson(source) {
  try {
    let text = String(source || "");
    let inString = false;
    let escaped = false;
    const stack = [];

    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }

        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === "[") {
        stack.push("]");
      } else if (char === "{") {
        stack.push("}");
      } else if (char === "]" || char === "}") {
        if (stack[stack.length - 1] === char) {
          stack.pop();
        } else {
          return null;
        }
      }
    }

    if (inString) {
      if (escaped) {
        text = text.slice(0, -1);
      }

      text += '"';
    }

    text = text.replace(/,\s*$/, "");

    while (stack.length) {
      text = text.replace(/,\s*$/, "");
      text += stack.pop();
    }

    return text;
  } catch {
    return null;
  }
}

function parseJsonArray(source) {
  if (!source) return null;

  let text = String(source)
    .replace(/^\uFEFF/, "")
    .trim();

  text = text
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

  if (end >= 0) {
    text = text.slice(0, end + 1);
  }

  try {
    const parsed = JSON.parse(text);

    return Array.isArray(parsed) ? parsed : null;
  } catch {
    // Continue with repair methods.
  }

  if (jsonrepair) {
    try {
      const repaired = jsonrepair(text);
      const parsed = JSON.parse(repaired);

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
    // Return a diagnostic below.
  }

  console.error(
    "[AI-GENERATOR] JSON parsing failed:",
    text.slice(0, 250)
  );

  return null;
}

// ============================================================
// QUESTION NORMALIZATION
// ============================================================

function hasHindi(text) {
  return /[\u0900-\u097F]/.test(String(text || ""));
}

function hasEnglish(text) {
  return /[A-Za-z]/.test(String(text || ""));
}

function combine(en, hi) {
  const english = String(en || "").trim();
  const hindi = String(hi || "").trim();

  if (english && hindi) {
    return `${english} / ${hindi}`;
  }

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
        return {
          text: option.trim(),
          explanation: "",
        };
      }

      if (!option || typeof option !== "object") {
        return {
          text: String(option || "").trim(),
          explanation: "",
        };
      }

      const text =
        combine(option.text_en, option.text_hi) ||
        option.text ||
        option.option ||
        option.value ||
        option.label ||
        option.answer ||
        "";

      const explanation =
        combine(
          option.explanation_en,
          option.explanation_hi
        ) ||
        option.explanation ||
        option.reason ||
        option.description ||
        "";

      return {
        text: String(text).trim(),
        explanation: String(explanation).trim(),
      };
    })
    .filter((option) => option.text);
}

function normalizeCorrectAnswer(rawAnswer, options) {
  if (rawAnswer === null || rawAnswer === undefined) {
    return "";
  }

  if (typeof rawAnswer === "number") {
    rawAnswer = String(rawAnswer);
  }

  if (typeof rawAnswer !== "string") {
    return "";
  }

  const answer = rawAnswer.trim();

  if (!answer) return "";

  const letterIndex = ["A", "B", "C", "D"].indexOf(
    answer.toUpperCase()
  );

  if (letterIndex !== -1 && options[letterIndex]) {
    return options[letterIndex].text;
  }

  if (/^[0-3]$/.test(answer)) {
    const index = Number(answer);

    if (options[index]) return options[index].text;
  }

  const exact = options.find(
    (option) => option.text.toLowerCase() === answer.toLowerCase()
  );

  if (exact) return exact.text;

  const englishAnswer = answer
    .split(" / ")[0]
    .trim()
    .toLowerCase();

  const englishMatch = options.find(
    (option) =>
      option.text
        .split(" / ")[0]
        .trim()
        .toLowerCase() === englishAnswer
  );

  if (englishMatch) return englishMatch.text;

  return "";
}

function shuffleArray(items) {
  const result = [...items];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

function normalizeQuestion(raw) {
  if (!raw || typeof raw !== "object") return null;

  const question =
    combine(raw.question_en, raw.question_hi) ||
    String(raw.question || raw.q || "").trim();

  if (!question) return null;

  const options = normalizeOptions(
    raw.options ||
      raw.choices ||
      raw.answers ||
      raw.answerOptions
  );

  if (options.length !== 4) return null;

  const uniqueOptions = new Set(
    options.map((option) => option.text.toLowerCase())
  );

  if (uniqueOptions.size !== 4) return null;

  let correctAnswer = normalizeCorrectAnswer(
    raw.correctAnswer ??
      raw.correct_answer ??
      raw.answer ??
      raw.correctOption,
    options
  );

  // Never silently invent a correct answer when the answer does not
  // match any option. Reject the malformed question instead.
  if (!correctAnswer) return null;

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

function isBilingualQuestion(question) {
  if (!question?.question) return false;

  if (
    !hasHindi(question.question) ||
    !hasEnglish(question.question)
  ) {
    return false;
  }

  if (!Array.isArray(question.options) || question.options.length !== 4) {
    return false;
  }

  if (
    !question.options.some(
      (option) => option.text === question.correctAnswer
    )
  ) {
    return false;
  }

  const bilingualOptions = question.options.filter(
    (option) =>
      hasHindi(option.text) &&
      hasEnglish(option.text)
  );

  return bilingualOptions.length >= 2;
}

function qKey(question) {
  return String(question?.question || "")
    .split(" / ")[0]
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ");
}

// ============================================================
// CATEGORY-AWARE PROMPTS
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
You are an expert question writer for AI Interview, Indian exams,
competitive examinations, school subjects, technical interviews,
professional interviews, and user-defined topics.

USER-SELECTED CATEGORY: "${selectedCategory}"
DIFFICULTY: "${selectedDifficulty}"
NUMBER OF QUESTIONS: ${count}
BATCH: ${batchNo} of ${totalBatches}

IMPORTANT CATEGORY RULES:
1. Generate questions STRICTLY about the user's selected category.
2. The category may be any topic, including a custom category not in
   a predefined category list.
3. Do not replace, reinterpret, or broaden the selected category.
4. Ignore unrelated technology stack or role details.
5. If the category is Haryana GK, generate Haryana GK questions.
6. If the category is React, generate React questions.
7. If the category is SSC GD, generate relevant SSC GD questions.
8. For other user-provided topics, follow the actual topic.
9. Use factual, clear, useful, non-duplicated questions.
10. Do not claim a question appeared in a previous-year exam unless
    you can establish that fact.

${extraHint}

LANGUAGE REQUIREMENTS:
- Each question must have an English version and a Hindi version.
- Hindi must use Devanagari script.
- Each option must have English and Hindi text.
- Each option must include a short English and Hindi explanation.
- Do not leave bilingual fields empty.

QUESTION REQUIREMENTS:
- Generate exactly ${count} questions when possible.
- Each question must have exactly four distinct options.
- There must be exactly one correct option.
- correctAnswer must exactly equal one option's text_en value.
- The correct answer must be factually accurate.
- Difficulty must match "${selectedDifficulty}".
- Questions within this batch must be different from each other.
- Do not output introductory text, Markdown, or code fences.

RETURN ONLY A JSON ARRAY USING THIS SCHEMA:
[
  {
    "question_en": "What is the capital of India?",
    "question_hi": "भारत की राजधानी क्या है?",
    "options": [
      {
        "text_en": "New Delhi",
        "text_hi": "नई दिल्ली",
        "explanation_en": "It is India's national capital.",
        "explanation_hi": "यह भारत की राष्ट्रीय राजधानी है।"
      },
      {
        "text_en": "Mumbai",
        "text_hi": "मुंबई",
        "explanation_en": "It is Maharashtra's capital.",
        "explanation_hi": "यह महाराष्ट्र की राजधानी है।"
      },
      {
        "text_en": "Kolkata",
        "text_hi": "कोलकाता",
        "explanation_en": "It is West Bengal's capital.",
        "explanation_hi": "यह पश्चिम बंगाल की राजधानी है।"
      },
      {
        "text_en": "Chennai",
        "text_hi": "चेन्नई",
        "explanation_en": "It is Tamil Nadu's capital.",
        "explanation_hi": "यह तमिलनाडु की राजधानी है।"
      }
    ],
    "correctAnswer": "New Delhi",
    "type": "general",
    "topic": "${selectedCategory}",
    "difficulty": "${selectedDifficulty}"
  }
]
`;
}

// ============================================================
// VALIDATE, DEDUPLICATE, AND PRESERVE PARTIAL RESULTS
// ============================================================

function normalizeGeneratedArray(rawArray, seen = new Set()) {
  if (!Array.isArray(rawArray)) return [];

  const result = [];

  for (const raw of rawArray) {
    const normalized = normalizeQuestion(raw);

    if (!normalized) continue;

    if (!isBilingualQuestion(normalized)) continue;

    const key = qKey(normalized);

    if (!key || seen.has(key)) continue;

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

async function generateBatch(
  category,
  difficulty,
  requestedCount,
  batchNo,
  totalBatches,
  seen,
  extraHint = "",
  retry = true
) {
  const prompt = buildPrompt(
    category,
    difficulty,
    requestedCount,
    batchNo,
    totalBatches,
    extraHint
  );

  try {
    const response = await callGemini(prompt, DEFAULT_TIMEOUT_MS);
    const parsed = parseJsonArray(response);

    const valid = normalizeGeneratedArray(
      parsed,
      seen
    ).slice(0, requestedCount);

    if (valid.length > 0) return valid;

    console.warn(
      `[AI-GENERATOR] Empty valid batch: category="${category}" batch=${batchNo}`
    );

    if (retry && !isQuotaExhausted()) {
      return generateBatch(
        category,
        difficulty,
        requestedCount,
        batchNo,
        totalBatches,
        seen,
        "The previous response was invalid or empty. Return only valid JSON with four options and a matching correctAnswer.",
        false
      );
    }

    return [];
  } catch (error) {
    console.error(
      `[AI-GENERATOR] Batch failed: category="${category}" difficulty="${difficulty}" batch=${batchNo}/${totalBatches}:`,
      error.message
    );

    if (retry && !isQuotaExhausted()) {
      return generateBatch(
        category,
        difficulty,
        requestedCount,
        batchNo,
        totalBatches,
        seen,
        "Retry the previous request. Return a valid, non-empty JSON array.",
        false
      );
    }

    return [];
  }
}

// ============================================================
// QUESTION BANK GENERATION
// ============================================================

async function generateBankInternal(
  category,
  difficulty,
  targetSize
) {
  const requested = Math.min(
    Math.max(Number(targetSize) || 1, 1),
    MAX_QUESTION_COUNT
  );

  const batchSize = 8;
  const seen = new Set();
  const all = [];

  const totalBatches = Math.ceil(requested / batchSize);

  for (let batch = 1; batch <= totalBatches; batch++) {
    if (isQuotaExhausted()) {
      console.warn(
        `[AI-GENERATOR] Quota exhausted; preserving ${all.length} generated questions`
      );
      break;
    }

    const count = Math.min(
      batchSize,
      requested - all.length
    );

    if (count <= 0) break;

    const fresh = await generateBatch(
      category,
      difficulty,
      count,
      batch,
      totalBatches,
      seen
    );

    all.push(...fresh);

    console.log(
      `[AI-GENERATOR] Bank batch ${batch}/${totalBatches}: +${fresh.length}; total=${all.length}/${requested}`
    );

    if (all.length >= requested) break;

    if (batch < totalBatches && !isQuotaExhausted()) {
      await sleep(1000);
    }
  }

  // A small top-up is useful when the model returns fewer valid questions
  // than requested. Never discard valid questions if the top-up fails.
  let topUpRounds = 0;

  while (
    all.length < requested &&
    topUpRounds < 2 &&
    !isQuotaExhausted()
  ) {
    topUpRounds++;

    const missing = requested - all.length;
    const topUpCount = Math.min(missing, 8);

    const fresh = await generateBatch(
      category,
      difficulty,
      topUpCount,
      totalBatches + topUpRounds,
      totalBatches + topUpRounds,
      seen,
      "Generate new questions that are different from every previous batch."
    );

    all.push(...fresh);

    if (all.length < requested) {
      await sleep(1000);
    }
  }

  console.log(
    `[AI-GENERATOR] Bank result category="${category}" difficulty="${difficulty}" requested=${requested} valid=${all.length} quotaExhausted=${isQuotaExhausted()}`
  );

  return {
    questions: all.slice(0, requested),
    stats: {
      requested,
      valid: all.length,
      topUpRounds,
    },
  };
}

async function generateBank(
  category,
  difficulty = "Medium",
  targetSize = 100
) {
  const result = await generateBankInternal(
    category,
    difficulty,
    targetSize
  );

  console.log(
    `🎉 [AI-GENERATOR] Bank completed: ${result.questions.length}/${targetSize}`
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

    if (cached?.length) {
      console.log(
        `[AI-GENERATOR] Cache hit: ${category}/${difficulty}`
      );

      return cached.slice(0, requested);
    }
  }

  const result = await generateBankInternal(
    category,
    difficulty,
    requested
  );

  const questions = result.questions.slice(0, requested);

  if (!questions.length) {
    throw new Error(
      `No valid questions generated for "${category}" (${difficulty}). Check Gemini quota, API errors, and generation logs.`
    );
  }

  saveCache(category, difficulty, questions);

  return questions;
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

  const startTime = Date.now();
  const overallTimeout = 120000;
  const batchSize = 8;
  const totalBatches = Math.ceil(requested / batchSize);

  const seen = new Set();
  const all = [];

  console.log(
    `[AI-INTERVIEW] Starting category="${category}" difficulty="${difficulty}" requested=${requested}`
  );

  for (let batch = 1; batch <= totalBatches; batch++) {
    if (Date.now() - startTime >= overallTimeout) {
      console.warn("[AI-INTERVIEW] Overall generation timeout reached");
      break;
    }

    if (isQuotaExhausted()) {
      console.warn("[AI-INTERVIEW] Gemini quota exhausted");
      break;
    }

    const countForBatch = Math.min(
      batchSize,
      requested - all.length
    );

    if (countForBatch <= 0) break;

    const fresh = await generateBatch(
      category,
      difficulty,
      countForBatch,
      batch,
      totalBatches,
      seen,
      extraHint
    );

    all.push(...fresh);

    console.log(
      `[AI-INTERVIEW] Batch ${batch}/${totalBatches}: +${fresh.length}; total=${all.length}/${requested}`
    );

    if (all.length >= requested) break;

    if (batch < totalBatches && !isQuotaExhausted()) {
      await sleep(500);
    }
  }

  console.log(
    `[AI-INTERVIEW] Finished category="${category}" difficulty="${difficulty}" requested=${requested} valid=${all.length} quotaExhausted=${isQuotaExhausted()} elapsedMs=${Date.now() - startTime}`
  );

  // Partial valid results are deliberately returned instead of discarded.
  return all.slice(0, requested);
}

// ============================================================
// RESUME FAST GENERATION
// ============================================================

function resumeBatchPrompt(
  snippet,
  batchCount,
  batchNo,
  totalBatches,
  extraHint = ""
) {
  return `
You are an expert interviewer.

Analyze the candidate resume below and create interview questions
based on the actual skills, projects, tools, and experience mentioned.

RESUME:
"""
${String(snippet || "").slice(0, 4000)}
"""

Generate ${batchCount} questions.
Batch ${batchNo} of ${totalBatches}.

${extraHint}

Every question and option must include English and Hindi in Devanagari.
Each question must have exactly four distinct options.
Each option must have a short explanation in both languages.
correctAnswer must exactly match one option's text_en.

Return only a valid JSON array using this schema:
[
  {
    "question_en": "What does an operating system manage?",
    "question_hi": "ऑपरेटिंग सिस्टम किसका प्रबंधन करता है?",
    "options": [
      {
        "text_en": "Computer resources",
        "text_hi": "कंप्यूटर संसाधन",
        "explanation_en": "It manages hardware and software resources.",
        "explanation_hi": "यह हार्डवेयर और सॉफ्टवेयर संसाधन प्रबंधित करता है।"
      },
      {
        "text_en": "Only the monitor",
        "text_hi": "केवल मॉनिटर",
        "explanation_en": "Its responsibilities are broader.",
        "explanation_hi": "इसकी जिम्मेदारियाँ अधिक व्यापक हैं।"
      },
      {
        "text_en": "Only the keyboard",
        "text_hi": "केवल कीबोर्ड",
        "explanation_en": "It manages many system resources.",
        "explanation_hi": "यह कई सिस्टम संसाधन प्रबंधित करता है।"
      },
      {
        "text_en": "Only the mouse",
        "text_hi": "केवल माउस",
        "explanation_en": "It manages more than input devices.",
        "explanation_hi": "यह इनपुट डिवाइस से अधिक प्रबंधित करता है।"
      }
    ],
    "correctAnswer": "Computer resources",
    "type": "technical",
    "difficulty": "Medium"
  }
]
`;
}

async function runResumeBatch(
  snippet,
  batchNo,
  totalBatches,
  seen,
  retry = true
) {
  try {
    const prompt = resumeBatchPrompt(
      snippet,
      8,
      batchNo,
      totalBatches,
      retry ? "" : "Return valid, non-empty JSON only."
    );

    const response = await callGemini(prompt, DEFAULT_TIMEOUT_MS);
    const parsed = parseJsonArray(response);

    const fresh = normalizeGeneratedArray(parsed, seen);

    if (fresh.length) return fresh;

    if (retry && !isQuotaExhausted()) {
      return runResumeBatch(
        snippet,
        batchNo,
        totalBatches,
        seen,
        false
      );
    }

    return [];
  } catch (error) {
    console.error(
      `[RESUME-FAST] Batch ${batchNo} failed:`,
      error.message
    );

    if (retry && !isQuotaExhausted()) {
      return runResumeBatch(
        snippet,
        batchNo,
        totalBatches,
        seen,
        false
      );
    }

    return [];
  }
}

async function generateResumeQuestionsFast(
  resumeText,
  count = 30
) {
  if (!String(resumeText || "").trim()) {
    throw new Error("Resume text is empty");
  }

  const requested = Math.min(
    Math.max(Number(count) || 1, 1),
    MAX_QUESTION_COUNT
  );

  const snippet = String(resumeText).slice(0, 4000);
  const seen = new Set();
  const all = [];
  const batchSize = 8;
  const totalBatches = Math.ceil(requested / batchSize);

  for (let batch = 1; batch <= totalBatches; batch++) {
    if (isQuotaExhausted()) break;

    const batchCount = Math.min(
      batchSize,
      requested - all.length
    );

    const fresh = await runResumeBatch(
      snippet,
      batch,
      totalBatches,
      seen
    );

    all.push(...fresh.slice(0, batchCount));

    console.log(
      `[RESUME-FAST] Batch ${batch}: total=${all.length}/${requested}`
    );

    if (all.length >= requested) break;

    if (batch < totalBatches && !isQuotaExhausted()) {
      await sleep(500);
    }
  }

  if (!all.length) {
    throw new Error(
      "No valid resume questions generated. Check Gemini API, quota, and logs."
    );
  }

  return all.slice(0, requested);
}

// ============================================================
// RESUME TOPIC EXTRACTION
// ============================================================

async function extractResumeTopics(resumeText) {
  const snippet = String(resumeText || "").slice(0, 6000);

  if (!snippet.trim()) {
    return ["Technical Skills", "Problem Solving", "Core Concepts"];
  }

  const prompt = `
Analyze this resume and extract up to 8 specific interview topics.

Return only JSON:
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
    console.warn(
      "[RESUME] Topic extraction failed:",
      error.message
    );
  }

  return [
    "Technical Skills",
    "Problem Solving",
    "Core Concepts",
  ];
}

async function generateResumeQuestions(
  resumeText,
  count = 50
) {
  if (!String(resumeText || "").trim()) {
    throw new Error("Resume text is empty");
  }

  const requested = Math.min(
    Math.max(Number(count) || 1, 1),
    MAX_QUESTION_COUNT
  );

  const topics = await extractResumeTopics(resumeText);

  console.log("[RESUME] Topics:", topics.join(", "));

  const seen = new Set();
  const all = [];
  const startTime = Date.now();
  const maxRounds = Math.ceil(requested / 8) + 3;

  for (
    let round = 1;
    round <= maxRounds && all.length < requested;
    round++
  ) {
    if (isQuotaExhausted()) break;

    const topic = topics[(round - 1) % topics.length];
    const missing = requested - all.length;
    const batchCount = Math.min(8, missing);

    const prompt = `
You are an expert interviewer.

Generate ${batchCount} questions about "${topic}" based on this resume:
"""
${String(resumeText).slice(0, 5000)}
"""

Every question and option must be bilingual English and Hindi.
Use Devanagari for Hindi.
Exactly four options per question.
Each option needs an explanation in both languages.
correctAnswer must exactly match one option's text_en.
Generate questions specific to the topic.
Return only a valid JSON array.

Schema:
[
  {
    "question_en": "Example question?",
    "question_hi": "उदाहरण प्रश्न?",
    "options": [
      {
        "text_en": "Option A",
        "text_hi": "विकल्प A",
        "explanation_en": "Explanation.",
        "explanation_hi": "व्याख्या।"
      },
      {
        "text_en": "Option B",
        "text_hi": "विकल्प B",
        "explanation_en": "Explanation.",
        "explanation_hi": "व्याख्या।"
      },
      {
        "text_en": "Option C",
        "text_hi": "विकल्प C",
        "explanation_en": "Explanation.",
        "explanation_hi": "व्याख्या।"
      },
      {
        "text_en": "Option D",
        "text_hi": "विकल्प D",
        "explanation_en": "Explanation.",
        "explanation_hi": "व्याख्या।"
      }
    ],
    "correctAnswer": "Option A",
    "topic": "${topic}",
    "difficulty": "Medium"
  }
]
`;

    try {
      const response = await callGemini(prompt, DEFAULT_TIMEOUT_MS);
      const parsed = parseJsonArray(response);
      const fresh = normalizeGeneratedArray(parsed, seen);

      all.push(...fresh.slice(0, batchCount));

      console.log(
        `[RESUME] Round ${round}: +${fresh.length}; total=${all.length}/${requested}`
      );
    } catch (error) {
      console.error(
        `[RESUME] Round ${round} failed:`,
        error.message
      );
    }

    if (all.length < requested && !isQuotaExhausted()) {
      await sleep(500);
    }
  }

  console.log(
    `[RESUME] Finished: valid=${all.length}/${requested}; elapsedMs=${Date.now() - startTime}`
  );

  if (!all.length) {
    throw new Error(
      "No valid resume questions generated. Check Gemini API and quota."
    );
  }

  return all.slice(0, requested);
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  generateQuestions,
  generateResumeQuestions,
  generateResumeQuestionsFast,
  generateBank,
  generateInterviewQuestions,
  isQuotaExhausted,
};