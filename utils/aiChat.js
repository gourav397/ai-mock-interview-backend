require("dotenv").config();

const API_KEYS = (process.env.GEMINI_API_KEYS || "")
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);

const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const RPD_PER_KEY = 400;
const COOLDOWN_MS = 45000;

let keyIdx = 0;
const keyCalls = {};
const keyExhausted = {};
const keyCooldown = {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callGemini(prompt, { systemHint = "", temperature = 0.7, maxTokens = 1024 } = {}) {
  if (!API_KEYS.length) throw new Error("GEMINI_API_KEYS .env me nahi hai");

  for (let round = 0; round < API_KEYS.length * 2; round++) {
    const k = keyIdx % API_KEYS.length;
    keyIdx = (keyIdx + 1) % API_KEYS.length;

    if (keyExhausted[k]) continue;
    if (keyCooldown[k] && Date.now() < keyCooldown[k]) continue;
    if ((keyCalls[k] || 0) >= RPD_PER_KEY) {
      keyExhausted[k] = true;
      continue;
    }

    const body = {
      systemInstruction: systemHint ? { parts: [{ text: systemHint }] } : undefined,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature, maxOutputTokens: maxTokens }
    };

    try {
      const resp = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEYS[k] },
        body: JSON.stringify(body)
      });

      if (resp.ok) {
        keyCalls[k] = (keyCalls[k] || 0) + 1;
        const data = await resp.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (!text) throw new Error("Empty Gemini response");
        return text;
      }

      const errBody = await resp.json().catch(() => ({}));
      const errMsg = errBody?.error?.message || "";
      const waitSec = parseInt(errMsg.match(/retry.*?(\d+)/i)?.[1], 10) || 0;

      if (resp.status === 429) {
        if (/per day|daily|rpd|requests per day/i.test(errMsg) || waitSec > 60) {
          console.log(`⚠️ Key #${k + 1} daily quota khatam — aaj ke liye band`);
          keyExhausted[k] = true;
        } else {
          keyCooldown[k] = Date.now() + Math.min(waitSec * 1000 || COOLDOWN_MS, 60000);
        }
        continue;
      }

      if (resp.status === 403 || resp.status === 400 || resp.status === 404) {
        console.log(`🚫 Key #${k + 1} blocked (${resp.status}) — rotate`);
        keyExhausted[k] = true;
        continue;
      }

      console.log(`🔁 Key #${k + 1}: ${resp.status} — 15s wait, retry...`);
      await sleep(15000);
      continue;
    } catch (e) {
      if (!keyExhausted[k]) keyCooldown[k] = Date.now() + COOLDOWN_MS;
      console.log(`❌ Key #${k + 1} call fail: ${e.message}`);
      continue;
    }
  }

  throw new Error("Sari keys exhausted/blocked — aaj ka budget khatam");
}

// Gemini se JSON lena hai? Sirf valid JSON return karega (fallback ke saath)
async function callJSON(prompt, options = {}) {
  const text = await callGemini(prompt, {
    systemHint: "Reply ONLY with valid JSON. No markdown, no extra text.",
    ...options
  });
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Gemini ne valid JSON nahi diya");
  }
}

module.exports = { callGemini, callJSON, isKeysAlive: () => API_KEYS.length > 0 };