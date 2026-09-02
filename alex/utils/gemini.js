// ============================================================
// ALEX Gemini Client — shared key pool + shared HTTP client
// Ek hi key-loading strategy: config/geminiKeys.js ✅
// ============================================================

const { keyManager, envStatus } = require("../../config/geminiKeys");
const { geminiGenerate } = require("../../config/geminiClient");

// Requirement: ALEX apna model env se leta hai, absent par default
const MODEL = process.env.ALEX_GEMINI_MODEL || process.env.GEMINI_MODEL || "gemini-3.5-flash";

console.log(`🤖 [ALEX] Gemini client loaded — model: ${MODEL} | ${envStatus.summary}`);

async function callGemini(prompt, options = {}) {
  const {
    temperature = 0.3,
    maxOutputTokens = 4096,
    timeoutMs = 30000,
    retries = 3,
  } = options;

  const safePrompt = prompt.length > 15000 ? prompt.slice(0, 15000) + "\n...[truncated]" : prompt;

  const { text } = await geminiGenerate(safePrompt, {
    model: MODEL,
    temperature,
    maxOutputTokens,
    timeoutMs,
    maxRounds: Math.max(retries, 3),
    responseMimeType: "application/json",
  });

  // ALEX ka contract preserve: object return (parsed JSON ya { raw })
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function isQuotaExhausted() {
  return keyManager.isQuotaExhausted();
}

module.exports = { callGemini, isQuotaExhausted, MODEL };