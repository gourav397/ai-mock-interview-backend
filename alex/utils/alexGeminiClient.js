// ============================================================
// ALEX Gemini Client — Premium Production Version
// 429/Quota Resilience with Exponential Backoff + Jitter
// Cross-platform key management
// ============================================================

const config = require("../config");

class AlexGeminiClient {
  constructor() {
    this.keys = (process.env.GEMINI_API_KEYS || "")
      .split(",").map(k => k.trim()).filter(Boolean);

    this.keyStates = this.keys.map(() => ({
      calls: 0, tokens: 0, minuteStart: Date.now(),
      exhausted: false, exhaustedUntil: 0, errors: 0,
    }));

    this.model = config.ai?.model || "gemini-3.5-flash";
    this.lastError = null;
    this.available = this.keys.length > 0;
    this.keyIdx = 0;
  }

  isAvailable() {
    return this.available && this.keys.some((_, i) => {
      const s = this.keyStates[i];
      if (s.exhausted && Date.now() < s.exhaustedUntil) return false;
      return true;
    });
  }

  _getReadyKey() {
    const now = Date.now();
    for (let step = 1; step <= this.keys.length; step++) {
      const i = (this.keyIdx + step) % this.keys.length;
      const state = this.keyStates[i];

      if (now - state.minuteStart > 60000) {
        state.calls = 0; state.tokens = 0; state.minuteStart = now;
      }
      if (state.exhausted) {
        if (now < state.exhaustedUntil) continue;
        state.exhausted = false;
        console.log(`🔄 Gemini key #${i + 1} cooldown expired — retrying`);
      }
      if (state.calls >= 10) continue; // Per-minute rate limit
      this.keyIdx = i;
      return i;
    }
    return -1;
  }

  async call(prompt, options = {}) {
    if (!this.available) {
      return { error: true, message: "No Gemini API keys configured", aiUnavailable: true };
    }
    if (this.keys.length === 0) {
      return { error: true, message: "No Gemini API keys available", aiUnavailable: true };
    }

    const { temperature = 0.3, timeoutMs = 20000 } = options;
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const keyIdx = this._getReadyKey();
      if (keyIdx === -1) {
        if (attempt === 0) {
          console.log("⏳ All Gemini keys busy, waiting 2s...");
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        return {
          error: true, message: "All API keys rate-limited or exhausted",
          aiUnavailable: true, retriesAttempted: attempt,
        };
      }

      const key = this.keys[keyIdx];
      const state = this.keyStates[keyIdx];
      const truncatedPrompt = prompt.length > 8000
        ? prompt.slice(0, 8000) + "\n...[truncated]"
        : prompt;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            contents: [{ parts: [{ text: truncatedPrompt }] }],
            generationConfig: { temperature, topP: 0.95, maxOutputTokens: 2048, responseMimeType: "application/json" },
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        state.calls++;

        if (res.ok) {
          state.errors = 0;
          const data = await res.json();
          const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("").trim();
          if (!text) throw new Error("Gemini returned empty response");
          return { error: false, text };
        }

        // Error handling
        let bodyText = "";
        try { bodyText = await res.text(); } catch {}

        if (res.status === 429) {
          const msg = bodyText.toLowerCase();
          const isDailyQuota = /per day|daily|rpd|requests per day|250.*requests/i.test(msg);

          if (isDailyQuota) {
            const now = new Date();
            const resetTime = new Date(now);
            resetTime.setHours(24, 0, 0, 0);
            const msUntilMidnight = resetTime.getTime() - now.getTime();
            state.exhausted = true;
            state.exhaustedUntil = now.getTime() + Math.min(msUntilMidnight + 60000, 8 * 60 * 60 * 1000);
            console.log(`🚫 Gemini key #${keyIdx + 1} daily quota exhausted`);
          } else {
            state.exhausted = true;
            state.exhaustedUntil = Date.now() + 30000 + Math.random() * 10000;
            console.log(`⏸️ Gemini key #${keyIdx + 1} rate limited — 30s cooldown`);
          }

          lastError = new Error(`HTTP 429: ${bodyText.slice(0, 200)}`);
          const waitMs = attempt < 2 ? 5000 * (attempt + 1) : 15000;
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }

        if (res.status === 403) {
          state.exhausted = true;
          state.exhaustedUntil = Date.now() + 24 * 60 * 60 * 1000;
          console.log(`🔴 Gemini key #${keyIdx + 1} blocked (403)`);
          lastError = new Error("API key blocked");
          continue;
        }

        if (res.status === 404) {
          console.log(`⚠️ Model "${this.model}" not found for key #${keyIdx + 1}`);
          lastError = new Error(`Model "${this.model}" not found`);
          continue;
        }

        if (res.status >= 500) {
          console.log(`🔴 Gemini ${res.status} — server error, retrying...`);
          lastError = new Error(`HTTP ${res.status}`);
          await new Promise(r => setTimeout(r, 10000));
          continue;
        }

        throw new Error(`Gemini HTTP ${res.status}: ${bodyText.slice(0, 300)}`);
      } catch (err) {
        clearTimeout(timer);
        lastError = err;
        if (err.name === "AbortError") {
          console.log(`⏱️ Gemini key #${keyIdx + 1} timeout (${timeoutMs}ms)`);
          state.errors++;
          if (state.errors >= 3) {
            state.exhausted = true;
            state.exhaustedUntil = Date.now() + 60000;
          }
          continue;
        }
        throw err;
      }
    }

    return {
      error: true, message: lastError?.message || "Gemini call failed after retries",
      aiUnavailable: true, retriesAttempted: maxRetries,
    };
  }
}

let instance = null;
function getAlexGeminiClient() {
  if (!instance) instance = new AlexGeminiClient();
  return instance;
}

module.exports = { AlexGeminiClient, getAlexGeminiClient };