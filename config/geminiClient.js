// ============================================================
// geminiClient.js — Gemini REST client with:
//  - Key rotation (keyManager)
//  - MODEL-404 fallback (retired models) — keys NOT killed
//  - 503 high-demand fallback to alternate models — keys NOT killed
//  - Only 401/403 marks a key invalid
// ============================================================

require("dotenv").config();

const { keyManager } = require("./geminiKeys");

// ---------- MODEL FALLBACK CHAIN ----------
const MODEL_CHAIN = [
  process.env.GEMINI_MODEL || "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-2.5-flash",
  "gemini-flash-latest",
].filter((m, i, a) => a.indexOf(m) === i);

let currentModelIndex = 0;

function currentModel() {
  return MODEL_CHAIN[currentModelIndex];
}

function nextModel() {
  currentModelIndex = (currentModelIndex + 1) % MODEL_CHAIN.length;
  console.log(`🔄 [GEMINI] Switching model → ${currentModel()}`);
  return currentModel();
}

// Helper: key ki index (keyManager par indexOf method NAHI hai)
function keyIndex(key) {
  try {
    const idx = (keyManager.keys || []).indexOf(key);
    return idx === -1 ? "?" : idx + 1;
  } catch {
    return "?";
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extractJSON(text) {
  if (!text) return null;
  let t = String(text).trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(t);
  } catch (_) {}
  const start = t.search(/[\[{]/);
  if (start === -1) return null;
  const open = t[start];
  const close = open === "[" ? "]" : "}";
  const end = t.lastIndexOf(close);
  if (end <= start) return null;
  const slice = t.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch (_) {}
  try {
    const { jsonrepair } = require("jsonrepair");
    return JSON.parse(jsonrepair(slice));
  } catch (_) {
    return null;
  }
}

// Single REST call with one key.
async function callWithKey(key, prompt, model, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 30000);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.85,
            maxOutputTokens: 8192,
            responseMimeType: "application/json",
          },
        }),
      }
    );

    const bodyText = await res.text();

    if (!res.ok) {
      const err = new Error(`Gemini HTTP ${res.status}: ${bodyText.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }

    let data;
    try {
      data = JSON.parse(bodyText);
    } catch (_) {
      throw new Error("Gemini: invalid JSON response body");
    }

    const parts = data?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts)
      ? parts.map((p) => p.text || "").join("")
      : "";

    if (!text) {
      const finishReason = data?.candidates?.[0]?.finishReason || "UNKNOWN";
      const err = new Error(`Gemini: empty response (finishReason=${finishReason})`);
      err.status = 0;
      throw err;
    }

    if (typeof keyManager.reportSuccess === "function") keyManager.reportSuccess(key);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * geminiGenerate(prompt, timeoutMs)
 * Returns: text (string) or null if everything failed.
 */
async function geminiGenerate(prompt, timeoutMs = 30000) {
  const totalKeys = (keyManager.keys || []).length || 1;
  const MAX_ATTEMPTS = totalKeys * 2 + MODEL_CHAIN.length;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const key = keyManager.nextKey ? keyManager.nextKey() : null;
    if (!key) {
      console.log("🔴 [GEMINI] No usable keys right now (cooldown/exhausted)");
      await sleep(3000);
      continue;
    }

    try {
      const text = await callWithKey(key, prompt, currentModel(), timeoutMs);
      return text;
    } catch (err) {
      const status = err.status;
      const label = `Key #${keyIndex(key)}`;

      if (err.name === "AbortError" || err.code === "ABORT_ERR") {
        console.log(`⏱️ [GEMINI] Timeout on ${label} — next key`);
        if (typeof keyManager.reportFailure === "function") keyManager.reportFailure(key, "timeout");
        continue;
      }

      if (status === 401 || status === 403) {
        console.log(`🔴 [GEMINI] ${label} INVALID (HTTP ${status})`);
        if (typeof keyManager.markInvalid === "function") keyManager.markInvalid(key);
        continue;
      }

      if (status === 404) {
        console.log(`🔄 [GEMINI] Model ${currentModel()} not available (404) — falling back`);
        if (typeof keyManager.reportFailure === "function") keyManager.reportFailure(key, "model404");
        nextModel();
        continue;
      }

      if (status === 503 || status === 500) {
        console.log(`🔴 [GEMINI] HTTP ${status} (model: ${currentModel()}) — trying alternate model`);
        if (typeof keyManager.reportFailure === "function") keyManager.reportFailure(key, "serverError");
        nextModel();
        continue;
      }

      if (status === 429) {
        console.log(`⏳ [GEMINI] ${label} quota hit — cooldown`);
        if (typeof keyManager.reportFailure === "function") keyManager.reportFailure(key, "quota");
        continue;
      }

      console.log(`⚠️ [GEMINI] Soft failure: ${String(err.message).slice(0, 120)}`);
      if (typeof keyManager.reportFailure === "function") keyManager.reportFailure(key, "soft");
    }
  }

  console.log("🔴 [GEMINI] All attempts failed — giving up this call");
  return null;
}

module.exports = {
  geminiGenerate,
  extractJSON,
  currentModel,
  MODEL_CHAIN,
};