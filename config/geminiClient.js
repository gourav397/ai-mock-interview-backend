// ============================================================
// config/geminiClient.js
// Reliable Gemini HTTP caller — key rotation, cooldown, 429,
// 401/403 invalidation, model-404 auto-fallback, 5xx retry,
// timeout handling.
// SECURITY: kabhi bhi full API key log/return nahi hoti.
// ============================================================

require("dotenv").config();

const { keyManager } = require("./geminiKeys");

const BASE_URL = "https://generativelanguage.googleapis.com";

// ---------- MODEL FALLBACK CHAIN ----------
// Agar model retire/404 ho jaye to agla model try hota hai —
// keys invalid NAHI hoti (404 model ka error hai, key ka nahi).
const MODEL_FALLBACKS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-2.5-flash",
  "gemini-flash-latest",
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Yeh model-specific 404 hai (key ki galti nahi)?
function isModelNotFound(bodyText) {
  return (
    /no longer available/i.test(bodyText) ||
    /models\/[\w.\-]+ is not found/i.test(bodyText) ||
    /model not found/i.test(bodyText) ||
    /is not supported/i.test(bodyText) ||
    /not found for API version/i.test(bodyText)
  );
}

async function geminiGenerate(prompt, options = {}) {
  const opts = {
    model: process.env.GEMINI_MODEL || "gemini-3.6-flash",
    temperature: 0.7,
    topP: 0.95,
    maxOutputTokens: 8192,
    responseMimeType: null,
    systemInstruction: null,
    timeoutMs: 60000,
    maxRounds: 10,
    maxPromptChars: 15000,
    ...options,
  };

  if (!keyManager.count) {
    const e = new Error(
      "GEMINI_API_KEYS missing — Render Dashboard → Environment me 'GEMINI_API_KEYS' add karo (comma separated)"
    );
    e.code = "GEMINI_KEYS_MISSING";
    throw e;
  }

  const safePrompt =
    prompt.length > opts.maxPromptChars
      ? prompt.slice(0, opts.maxPromptChars) + "\n...[text truncated]"
      : prompt;

  // ---------- MODEL RESOLUTION (with fallback) ----------
  let model = opts.model;
  const triedModels = new Set();

  // Agar env/config model pehle hi fail ho chuka hai to fallback chain se
  // pehla untried model uthao
  function pickNextModel() {
    for (const m of MODEL_FALLBACKS) {
      if (!triedModels.has(m)) {
        triedModels.add(m);
        return m;
      }
    }
    return null;
  }

  let lastError = null;

  for (let round = 1; round <= opts.maxRounds; round++) {
    if (keyManager.isQuotaExhausted()) {
      const e = new Error("QUOTA_EXHAUSTED: saari keys ki daily limit khatam");
      e.code = "QUOTA_EXHAUSTED";
      throw e;
    }

    const slot = keyManager.nextKey();

    if (!slot) {
      const waitMs = keyManager.minWaitMs();
      if (waitMs === null) {
        const e = new Error("QUOTA_EXHAUSTED: saari keys exhausted/blocked");
        e.code = "QUOTA_EXHAUSTED";
        throw e;
      }
      const s = Math.min(waitMs, 60000);
      console.log(`⏳ [GEMINI] Saari keys busy/cooldown — ${Math.round(s / 1000)}s wait (round ${round}/${opts.maxRounds})`);
      await sleep(s);
      continue;
    }

    const url = `${BASE_URL}/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

    const body = {
      contents: [{ role: "user", parts: [{ text: safePrompt }] }],
      generationConfig: {
        temperature: opts.temperature,
        topP: opts.topP,
        maxOutputTokens: opts.maxOutputTokens,
        ...(opts.responseMimeType ? { responseMimeType: opts.responseMimeType } : {}),
      },
      ...(opts.systemInstruction
        ? { systemInstruction: { parts: [{ text: opts.systemInstruction }] } }
        : {}),
    };

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": slot.key },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);

      // ---------- SUCCESS ----------
      if (res.ok) {
        keyManager.markSuccess(slot.index);
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts
          ?.map((p) => p.text || "")
          .join("")
          .trim();
        if (!text) {
          const reason = data?.candidates?.[0]?.finishReason || "unknown";
          lastError = new Error(`Gemini empty response on key #${slot.index + 1} (finishReason: ${reason})`);
          keyManager.markTimeout(slot.index, 5000);
          continue;
        }
        console.log(`✅ [GEMINI] Key #${slot.index + 1} OK (${keyManager.calls[slot.index]} calls) — model: ${model}`);
        return { text, keyIndex: slot.index, model };
      }

      const bodyText = await res.text().catch(() => "");
      console.log(`🔴 [GEMINI] Key #${slot.index + 1} HTTP ${res.status} (model: ${model}): ${bodyText.slice(0, 200)}`);

      // ---------- 404 MODEL NOT FOUND: model switch, key ko mat maro ----------
      if (res.status === 404 && isModelNotFound(bodyText)) {
        console.log(`🔄 [GEMINI] Model "${model}" available nahi hai — fallback try kar rahe hain (key #${slot.index + 1} theek hai)`);
        const next = pickNextModel();
        if (next) {
          model = next;
          continue; // same key, next model
        }
        lastError = new Error(`Koi working Gemini model nahi mila (tried: ${[...triedModels].join(", ")})`);
        continue;
      }

      // ---------- 429: rate limit ----------
      if (res.status === 429) {
        keyManager.markSuccess(slot.index); // call consumed
        const waitHint = parseFloat((bodyText.match(/retry in ([\d.]+)s/i) || [])[1]) || 0;
        const isDaily =
          /per day|daily|rpd|requests per day/i.test(bodyText) ||
          waitHint > 300 ||
          (/quota|resource_exhausted/i.test(bodyText) && waitHint > 60);
        keyManager.markRateLimited(slot.index, {
          isDaily,
          waitMs: isDaily ? null : Math.max(waitHint * 1000, keyManager.cooldownMs),
        });
        lastError = new Error(`Gemini key #${slot.index + 1} rate-limited (429)`);
        continue;
      }

      // ---------- 401/403: key genuinely invalid ----------
      if (res.status === 401 || res.status === 403) {
        keyManager.markInvalid(slot.index, `HTTP ${res.status}`);
        lastError = new Error(`Gemini key #${slot.index + 1} failed (HTTP ${res.status})`);
        continue;
      }

      // ---------- 404 (non-model): key/project issue ----------
      if (res.status === 404) {
        keyManager.markInvalid(slot.index, `HTTP 404 (non-model)`);
        lastError = new Error(`Gemini key #${slot.index + 1} failed (HTTP 404)`);
        continue;
      }

      // ---------- 5xx: server busy ----------
      if (res.status >= 500) {
        lastError = new Error(`Gemini HTTP ${res.status}: ${bodyText.slice(0, 200)}`);
        keyManager.markTimeout(slot.index, 15000);
        await sleep(15000);
        continue;
      }

      // ---------- other 4xx: retry pointless ----------
      keyManager.markInvalid(slot.index, `HTTP ${res.status}`);
      throw new Error(`Gemini HTTP ${res.status}: ${bodyText.slice(0, 500)}`);
    } catch (err) {
      clearTimeout(timer);
      lastError = err;

      if (err.name === "AbortError" || err.name === "TimeoutError") {
        console.log(`⏱️ [GEMINI] Timeout on key #${slot.index + 1} — 10s cooldown, next key`);
        keyManager.markTimeout(slot.index, 10000);
        continue;
      }
      if (!err.code || !["QUOTA_EXHAUSTED", "GEMINI_KEYS_MISSING"].includes(err.code)) {
        keyManager.markTimeout(slot.index, keyManager.cooldownMs);
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error(`Gemini call failed after ${opts.maxRounds} rounds`);
}

// ---------- JSON helper ----------
let jsonrepair = null;
try {
  ({ jsonrepair } = require("jsonrepair"));
} catch {}

function extractJSON(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {}
  const candidates = [text.indexOf("{"), text.indexOf("[")].filter((i) => i !== -1);
  if (candidates.length) {
    const start = Math.min(...candidates);
    const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
    if (end > start) {
      const slice = text.slice(start, end + 1);
      try {
        return JSON.parse(slice);
      } catch {}
      if (jsonrepair) {
        try {
          return JSON.parse(jsonrepair(slice));
        } catch {}
      }
    }
  }
  if (jsonrepair) {
    try {
      return JSON.parse(jsonrepair(text));
    } catch {}
  }
  return null;
}

async function geminiJSON(prompt, options = {}) {
  const { text } = await geminiGenerate(prompt, {
    responseMimeType: "application/json",
    ...options,
  });
  const parsed = extractJSON(text);
  if (!parsed) {
    console.error("JSON PARSE FAIL:", String(text).slice(0, 300));
    throw new Error("Gemini ne valid JSON nahi diya");
  }
  return parsed;
}

module.exports = { geminiGenerate, geminiJSON, extractJSON };