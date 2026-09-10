// ============================================================
// geminiClient.js — Gemini REST client with:
//  - NEW-FORMAT keys (AQ.Ab8...) sent via x-goog-api-key HEADER
//  - Old-format keys (AIza...) still work (also via header)
//  - Key rotation (keyManager, object-or-string keys)
//  - MODEL fallback on 404 / 503 — keys NOT killed
//  - 400("API key not valid") / 401 / 403 → key invalid
//
// FIXES (is version mein):
//  - maxOutputTokens ab 16384 (env: GEMINI_MAX_OUTPUT_TOKENS) — bilingual
//    JSON batches truncate nahi hote
//  - Success par working model PIN hota hai — har call galat model se
//    shuru nahi hoti
//  - 400 "model not found" ab MODEL fallback (key invalid NAHI)
//  - 429 par daily-quota sniff (perDay) → key aaj ke liye off, warna cooldown
//  - reportSuccess/reportFailure ab geminiKeys ke adapter methods use karte
//    hain (call counts + cooldowns ab sach mein kaam karte hain)
// ============================================================

require("dotenv").config();

const { keyManager } = require("./geminiKeys");

const MODEL_CHAIN = [
  process.env.GEMINI_MODEL || "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-flash-latest",
].filter((m, i, a) => a.indexOf(m) === i);

const MAX_OUTPUT_TOKENS = (() => {
  const t = parseInt(process.env.GEMINI_MAX_OUTPUT_TOKENS || "16384", 10);
  return Number.isFinite(t) && t > 0 ? Math.min(t, 65536) : 16384;
})();

let currentModelIndex = 0;

function currentModel() {
  return MODEL_CHAIN[currentModelIndex];
}

function nextModel() {
  currentModelIndex = (currentModelIndex + 1) % MODEL_CHAIN.length;
  console.log(`🔄 [GEMINI] Switching model → ${currentModel()}`);
  return currentModel();
}

function pinModel(model) {
  const idx = MODEL_CHAIN.indexOf(model);
  if (idx !== -1) currentModelIndex = idx;
}

// keyManager keys object ho sakte hain — raw key string nikaalo
function rawKey(k) {
  if (!k) return null;
  if (typeof k === "string") return k.trim();
  return String(k.key || k.apiKey || k.value || k.api_key || "").trim() || null;
}

function keyIndex(k) {
  try {
    const rk = rawKey(k);
    const idx = (keyManager.keys || []).findIndex((x) => rawKey(x) === rk);
    return idx === -1 ? "?" : idx + 1;
  } catch {
    return "?";
  }
}

function sanitizeTimeout(t) {
  if (typeof t === "number" && isFinite(t) && t > 0) return t;
  if (t && typeof t === "object" && isFinite(Number(t.timeoutMs))) return Number(t.timeoutMs);
  return 30000;
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

async function callWithKey(keyObj, prompt, model, timeoutMs) {
  const key = rawKey(keyObj);
  if (!key) throw Object.assign(new Error("Empty API key"), { status: 400 });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // NAYI format keys (AQ.Ab8...) ke liye HEADER auth zaroori hai — AUTH UNCHANGED
          "x-goog-api-key": key,
        },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.85,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            responseMimeType: "application/json",
          },
        }),
      }
    );

    const bodyText = await res.text();

    if (!res.ok) {
      const err = new Error(`Gemini HTTP ${res.status}: ${bodyText.slice(0, 300)}`);
      err.status = res.status;
      err.body = bodyText;
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
      err.finishReason = finishReason;
      throw err;
    }

    return text;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * geminiGenerate(prompt, timeoutMs | options)
 * Returns: STRING on success, NULL on total failure.
 */
async function geminiGenerate(prompt, timeoutMsOrOptions = 30000) {
  const timeoutMs = sanitizeTimeout(timeoutMsOrOptions);
  const totalKeys = (keyManager.keys || []).length || 1;
  const MAX_ATTEMPTS = totalKeys * 2 + MODEL_CHAIN.length;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const keyObj = typeof keyManager.nextKey === "function" ? keyManager.nextKey() : null;
    if (!keyObj || !rawKey(keyObj)) {
      console.log("🔴 [GEMINI] No usable keys right now (cooldown/exhausted)");
      await sleep(3000);
      continue;
    }

    const modelUsed = currentModel();

    try {
      const text = await callWithKey(keyObj, prompt, modelUsed, timeoutMs);
      // Working model PIN karo — agli calls isi se shuru hongi
      pinModel(modelUsed);
      if (typeof keyManager.reportSuccess === "function") keyManager.reportSuccess(keyObj);
      return text;
    } catch (err) {
      const status = err.status;
      const label = `Key #${keyIndex(keyObj)}`;
      const body = err.body || "";

      if (err.name === "AbortError" || err.code === "ABORT_ERR") {
        console.log(`⏱️ [GEMINI] Timeout (${timeoutMs}ms) on ${label} — next key`);
        if (typeof keyManager.reportFailure === "function") keyManager.reportFailure(keyObj, "timeout");
        continue;
      }

      // 400 with "API key not valid" = invalid key; other 400s = request/model problem
      if (status === 400 && body.includes("API key not valid")) {
        console.log(`🔴 [GEMINI] ${label} INVALID (HTTP 400 — key not valid)`);
        if (typeof keyManager.reportFailure === "function") {
          keyManager.reportFailure(keyObj, "keyInvalid", { detail: "API key not valid" });
        }
        continue;
      }

      // 400 model problem — model fallback karo, KEY KO INVALID MAT KARO
      if (status === 400 && /models?\/[\w.\-]+\s+is\s+not\s+found|not\s+found\s+for\s+api\s+version|is\s+not\s+supported/i.test(body)) {
        console.log(`🔄 [GEMINI] HTTP 400 model problem (${modelUsed}) — falling back`);
        if (typeof keyManager.reportFailure === "function") keyManager.reportFailure(keyObj, "model404");
        nextModel();
        continue;
      }

      if (status === 401 || status === 403) {
        console.log(`🔴 [GEMINI] ${label} INVALID (HTTP ${status})`);
        if (typeof keyManager.reportFailure === "function") {
          keyManager.reportFailure(keyObj, "keyInvalid", { detail: `HTTP ${status}` });
        }
        continue;
      }

      if (status === 404) {
        console.log(`🔄 [GEMINI] Model ${modelUsed} not available (404) — falling back`);
        if (typeof keyManager.reportFailure === "function") keyManager.reportFailure(keyObj, "model404");
        nextModel();
        continue;
      }

      if (status === 503 || status === 500) {
        console.log(`🔴 [GEMINI] HTTP ${status} (model: ${modelUsed}) — trying alternate model`);
        if (typeof keyManager.reportFailure === "function") keyManager.reportFailure(keyObj, "serverError");
        nextModel();
        continue;
      }

      if (status === 429) {
        // Daily quota vs short-term rate limit sniff karo
        const isDaily = /perDay|per\s+day|ResourceExhausted[\s\S]*perDay|limit:\s*0/i.test(body);
        console.log(`⏳ [GEMINI] ${label} quota hit — ${isDaily ? "DAILY exhausted" : "short cooldown"}`);
        if (typeof keyManager.reportFailure === "function") {
          keyManager.reportFailure(keyObj, "quota", { isDaily });
        }
        continue;
      }

      console.log(`⚠️ [GEMINI] Soft failure: ${String(err.message).slice(0, 120)}`);
      if (typeof keyManager.reportFailure === "function") keyManager.reportFailure(keyObj, "soft");
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
  MAX_OUTPUT_TOKENS,
};