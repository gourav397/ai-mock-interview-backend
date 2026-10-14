
"use strict";

// ============================================================
// ALEX Gemini Utility
// - Normal chat and command generation
// - Bounded retries and timeout handling
// - Safe fallback for unavailable Gemini
// - Robust JSON response parsing
// - Preserves existing exports
// ============================================================

const { keyManager, envStatus } = require("../../config/geminiKeys");
const { getAlexGeminiClient } = require("../../config/geminiClient");

const CONFIGURED_MODEL =
  process.env.ALEX_GEMINI_MODEL ||
  process.env.GEMINI_MODEL ||
  "gemini-3.8-flash";

const MODEL =
  /^(gemini-3\.5-flash|gemini-3\.7-flash)$/i.test(CONFIGURED_MODEL)
    ? "gemini-3.8-flash"
    : CONFIGURED_MODEL;

const CHAT_FALLBACK =
  "Haan, main yahin hoon. Gemini abhi response nahi de pa raha. Thodi der baad dobara try karo.";

console.log(
  `🤖 [ALEX] Gemini utility loaded | model: ${MODEL} | ${
    envStatus?.summary || "Environment status unavailable"
  }`
);

function getPositiveNumber(value, fallback, maximum) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(number), maximum);
}

function makeChatFallback(message = CHAT_FALLBACK) {
  return {
    error: false,
    degraded: true,
    aiUnavailable: true,
    text: message,
    reply: message,
    raw: message,
  };
}

function parseJsonResponse(text) {
  const source = String(text || "").trim();

  if (!source) {
    return null;
  }

  try {
    return JSON.parse(source);
  } catch {
    // Continue with fenced or embedded JSON extraction.
  }

  const cleaned = source
    .replace(/^\uFEFF/, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Continue with the first JSON object or array.
  }

  const startObject = cleaned.indexOf("{");
  const startArray = cleaned.indexOf("[");

  let start = -1;

  if (startObject === -1) {
    start = startArray;
  } else if (startArray === -1) {
    start = startObject;
  } else {
    start = Math.min(startObject, startArray);
  }

  if (start === -1) {
    return null;
  }

  const opening = cleaned[start];
  const closing = opening === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < cleaned.length; i += 1) {
    const character = cleaned[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }

      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === opening) {
      depth += 1;
    } else if (character === closing) {
      depth -= 1;

      if (depth === 0) {
        const candidate = cleaned.slice(start, i + 1);

        try {
          return JSON.parse(candidate);
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

async function callGemini(prompt, options = {}) {
  const chatMode = options.chatMode === true;

  const temperature =
    typeof options.temperature === "number"
      ? options.temperature
      : chatMode
        ? 0.8
        : 0.3;

  const maxOutputTokens = getPositiveNumber(
    options.maxOutputTokens,
    chatMode ? 2000 : 4096,
    8192
  );

  const timeoutMs = chatMode
    ? Math.min(getPositiveNumber(options.timeoutMs, 20000, 120000), 20000)
    : getPositiveNumber(options.timeoutMs, 30000, 120000);

  // retries means additional attempts after the first request.
  // Keep attempts bounded so a chat request cannot loop indefinitely.
  const retries = chatMode
    ? 0
    : typeof options.retries === "number"
      ? Math.min(2, Math.max(0, Math.floor(options.retries)))
      : 1;

  const responseMimeType =
    options.responseMimeType ||
    (chatMode ? "text/plain" : "application/json");

  const safePrompt = String(prompt || "").trim();

  if (!safePrompt) {
    return {
      error: true,
      message: "Gemini prompt is empty",
      raw: "",
    };
  }

  const finalPrompt =
    safePrompt.length > 15000
      ? safePrompt.slice(0, 15000) + "\n...[truncated]"
      : safePrompt;

  let client;

  try {
    client = getAlexGeminiClient();
  } catch (error) {
    console.error(
      "[ALEX] Gemini client initialization failed:",
      error?.message || error
    );

    if (chatMode) {
      return makeChatFallback();
    }

    return {
      error: true,
      message: error?.message || "Gemini client initialization failed",
      raw: "",
    };
  }

  if (!client || typeof client.call !== "function") {
    const message =
      "Invalid Gemini client: getAlexGeminiClient() must return an object with a call() method";

    console.error("[ALEX]", message);

    if (chatMode) {
      return makeChatFallback();
    }

    return {
      error: true,
      message,
      raw: "",
    };
  }

  let lastError = null;
  let result = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      result = await client.call(finalPrompt, {
        model: MODEL,
        temperature,
        maxOutputTokens,
        timeoutMs,
        retries: 0,
        responseMimeType,
        chatMode,
      });

      if (result && !result.error) {
        break;
      }

      lastError = new Error(
        result?.message || "Gemini returned an unsuccessful response"
      );

      console.error(
        `[ALEX] Gemini attempt ${attempt + 1}/${retries + 1} failed:`,
        lastError.message
      );
    } catch (error) {
      lastError = error;

      console.error(
        `[ALEX] Gemini attempt ${attempt + 1}/${retries + 1} threw:`,
        error?.message || error
      );
    }

    result = null;

    if (attempt < retries) {
      // Short, bounded backoff between attempts.
      const delayMs = Math.min(1000 * (attempt + 1), 2000);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  if (!result || result.error) {
    const message =
      result?.message ||
      lastError?.message ||
      "Gemini call failed without an error message";

    console.error("[ALEX] Gemini request exhausted:", {
      message,
      model: MODEL,
      chatMode,
      timeoutMs,
    });

    if (chatMode) {
      return {
        ...makeChatFallback(),
        diagnostic: message,
      };
    }

    return {
      error: true,
      message,
      raw: "",
      aiUnavailable: !!result?.aiUnavailable,
    };
  }

  const text =
    typeof result.text === "string"
      ? result.text.trim()
      : typeof result.reply === "string"
        ? result.reply.trim()
        : typeof result.raw === "string"
          ? result.raw.trim()
          : "";

  if (!text) {
    const message = "Gemini returned an empty response";

    console.error("[ALEX]", message);

    if (chatMode) {
      return makeChatFallback(
        "Haan, main yahin hoon. Mujhe response generate karne mein dikkat aa rahi hai. Dobara try karo."
      );
    }

    return {
      error: true,
      message,
      raw: "",
    };
  }

  // Normal conversation: return plain text in all expected fields.
  if (chatMode) {
    return {
      error: false,
      text,
      reply: text,
      raw: text,
    };
  }

  // Command mode: parse JSON when possible, otherwise preserve text.
  const parsed = parseJsonResponse(text);

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return {
      ...parsed,
      error: false,
      raw: text,
      text,
    };
  }

  if (Array.isArray(parsed)) {
    return {
      error: false,
      data: parsed,
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
    return typeof keyManager?.isQuotaExhausted === "function"
      ? keyManager.isQuotaExhausted()
      : false;
  } catch (error) {
    console.error(
      "[ALEX] Quota status check failed:",
      error?.message || error
    );

    return false;
  }
}

module.exports = {
  callGemini,
  isQuotaExhausted,
  MODEL,
};
