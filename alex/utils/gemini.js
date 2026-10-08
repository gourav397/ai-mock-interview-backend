// ============================================================
// ALEX Gemini Utility — FIXED
// (geminiGenerate import bug removed — uses getAlexGeminiClient)
// ============================================================

const { keyManager, envStatus } = require("../../config/geminiKeys");
const { getAlexGeminiClient } = require("../../config/geminiClient");

const MODEL =
  process.env.ALEX_GEMINI_MODEL ||
  process.env.GEMINI_MODEL ||
  "gemini-3.8-flash";

console.log(
  `🤖 [ALEX] Gemini utility loaded — model: ${MODEL} | ${envStatus.summary}`
);

async function callGemini(prompt, options = {}) {
  const chatMode = options.chatMode === true;

  const temperature =
    typeof options.temperature === "number"
      ? options.temperature
      : chatMode
        ? 0.8
        : 0.3;

  const maxOutputTokens =
    typeof options.maxOutputTokens === "number"
      ? options.maxOutputTokens
      : chatMode
        ? 2000
        : 4096;

  const timeoutMs =
    typeof options.timeoutMs === "number"
      ? options.timeoutMs
     : chatMode
  ? 120000
  : 30000;

  const retries =
    typeof options.retries === "number"
      ? Math.max(1, options.retries)
     : chatMode
  ? 4
  : 3;

  const responseMimeType =
    options.responseMimeType ||
    (chatMode ? "text/plain" : "application/json");

  const safePrompt = String(prompt || "");

  const finalPrompt =
    safePrompt.length > 15000
      ? safePrompt.slice(0, 15000) + "\n...[truncated]"
      : safePrompt;

  // ----------------------------------------------------------
  // Client se call karo (geminiGenerate exist hi nahi karta)
  // ----------------------------------------------------------
  let result;
  try {
    const client = getAlexGeminiClient();

    result = await client.call(finalPrompt, {
      model: MODEL,
      temperature,
      maxOutputTokens,
      timeoutMs,
      retries,
      responseMimeType,
      chatMode,
    });
  } catch (err) {
    return {
      raw: "",
      error: true,
      message: err?.message || "Gemini client call failed",
    };
  }

  // Client.call returns { error: true, message } on failure
  if (!result || result.error) {
    console.error(
  "❌ [ALEX] Gemini client error:",
  result?.message || "Unknown Gemini error"
);
  // --------------------------------------------------------
  // CHAT MODE:
  // Gemini temporarily unavailable/timeout ho to chat ko
  // FAILED mat banao. Safe fallback reply do.
  // Koi action complete hone ka false claim nahi karna.
  // --------------------------------------------------------
  if (chatMode) {
    return {
      error: false,
      degraded: true,
      aiUnavailable: true,
      text:
        "Haan, main yahin hoon. Gemini ka response abhi late ho raha hai, ek baar phir message bhejo.",
      reply:
        "Haan, main yahin hoon. Gemini ka response abhi late ho raha hai, ek baar phir message bhejo.",
      raw:
        "Haan, main yahin hoon. Gemini ka response abhi late ho raha hai, ek baar phir message bhejo.",
    };
  }

  return {
    raw: "",
    error: true,
    message: result?.message || "Gemini call failed",
    aiUnavailable: !!result?.aiUnavailable,
  };
}

const text =
  typeof result?.text === "string" ? result.text.trim() : "";

if (!text) {
  if (chatMode) {
    return {
      error: false,
      degraded: true,
      aiUnavailable: true,
      text:
        "Haan, main yahin hoon. Mujhe response generate karne mein thoda time lag raha hai.",
      reply:
        "Haan, main yahin hoon. Mujhe response generate karne mein thoda time lag raha hai.",
      raw:
        "Haan, main yahin hoon. Mujhe response generate karne mein thoda time lag raha hai.",
    };
  }

  return {
    raw: "",
    error: true,
    message: "Gemini returned an empty response",
  };
}

  // ----------------------------------------------------------
  // CHAT MODE — plain text reply
  // ----------------------------------------------------------
  if (chatMode) {
    return {
      error: false,
      text,
      reply: text,
      raw: text,
    };
  }

  // ----------------------------------------------------------
// COMMAND MODE — robust JSON parsing
// ----------------------------------------------------------
let parsed;

try {
  parsed = JSON.parse(text);
} catch {
  // Gemini kabhi ```json ... ``` ke andar JSON deta hai
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return {
      error: false,
      raw: text,
      text,
    };
  }
}

// Gemini ne valid object diya hai
if (parsed && typeof parsed === "object") {
  return {
    error: false,
    ...parsed,
    raw: text,
    text,
  };
}

return {
  error: false,
  raw: text,
  text,
};
}

function isQuotaExhausted() {
  try {
    return keyManager.isQuotaExhausted();
  } catch {
    return false;
  }
}

module.exports = {
  callGemini,
  isQuotaExhausted,
  MODEL,
};