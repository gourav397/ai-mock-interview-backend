// ============================================================
// config/geminiKeys.js
// SINGLE SOURCE OF TRUTH for Gemini API keys + rotation state.
// Used by: aiGenerator, ALEX client, lite client, server diagnostics.
// SECURITY: kabhi bhi full key print/return nahi hota — sirf masked.
// ============================================================

require("dotenv").config(); // safe: local dev ke liye; Render env ko kabhi override nahi karta

// ---------- PARSING ----------
function parseKeys(raw) {
  if (!raw || typeof raw !== "string") return [];
  return raw
    // comma + accidental newline/semicolon paste handle karega (Render me common)
    .split(/[,\n;]+/)
    .map((k) => k.trim())
    // accidental wrapping quotes hatao: "KEY1,KEY2"
    .map((k) => {
      if (
        k.length >= 2 &&
        ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'")))
      ) {
        return k.slice(1, -1).trim();
      }
      return k;
    })
    .filter((k) => k.length > 0); // empty entries , , ignore
}

// ---------- FALLBACK CHAIN ----------
// GEMINI_API_KEYS preferred; legacy names still supported
const SOURCE_VAR =
  process.env.GEMINI_API_KEYS ? "GEMINI_API_KEYS"
  : process.env.GEMINI_API_KEY ? "GEMINI_API_KEY"
  : process.env.GOOGLE_API_KEY ? "GOOGLE_API_KEY"
  : process.env.AI_KEY ? "AI_KEY"
  : null;

const RAW_VALUE = SOURCE_VAR ? process.env[SOURCE_VAR] : "";

const API_KEYS = parseKeys(RAW_VALUE);

// ---------- SAFE MASKING ----------
function maskKey(key) {
  if (!key || typeof key !== "string") return "****";
  if (key.length <= 10) return "****";
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

// ---------- STARTUP DIAGNOSTIC ----------
const envStatus = {
  present: !!SOURCE_VAR,
  source: SOURCE_VAR,
  count: API_KEYS.length,
  summary: API_KEYS.length
    ? `FOUND (${API_KEYS.length} keys via ${SOURCE_VAR})`
    : "MISSING (checked GEMINI_API_KEYS, GEMINI_API_KEY, GOOGLE_API_KEY, AI_KEY)",
  maskedKeys: API_KEYS.map(maskKey), // safe for logs
};

// ---------- KEY MANAGER (rotation, cooldown, quota) ----------
class KeyManager {
  constructor(keys, { rpdPerKey = 1000, cooldownMs = 45000 } = {}) {
    this.keys = keys || [];
    this.calls = this.keys.map(() => 0);
    this.exhausted = this.keys.map(() => false); // daily quota khatam
    this.invalid = this.keys.map(() => false);   // 403/404 — key/model blocked
    this.cooldownUntil = this.keys.map(() => 0); // 429 per-minute / timeout
    this.idx = 0;
    this.rpdPerKey = rpdPerKey;
    this.cooldownMs = cooldownMs;
  }

  get count() {
    return this.keys.length;
  }

  usableCount() {
    const now = Date.now();
    return this.keys.filter(
      (_, i) =>
        !this.exhausted[i] &&
        !this.invalid[i] &&
        this.calls[i] < this.rpdPerKey &&
        this.cooldownUntil[i] <= now
    ).length;
  }

  // Round-robin — next usable key ya null
  nextKey() {
    const now = Date.now();
    const n = this.keys.length;
    for (let step = 0; step < n; step++) {
      const i = (this.idx + step) % n;
      if (this.exhausted[i] || this.invalid[i]) continue;
      if (this.calls[i] >= this.rpdPerKey) {
        this.exhausted[i] = true;
        continue;
      }
      if (this.cooldownUntil[i] > now) continue;
      this.idx = (i + 1) % n;
      return { index: i, key: this.keys[i] };
    }
    return null;
  }

  markSuccess(i) {
    if (this.calls[i] !== undefined) this.calls[i]++;
  }

  markRateLimited(i, { waitMs = null, isDaily = false } = {}) {
    if (isDaily) {
      this.exhausted[i] = true;
      console.log(`🚫 [KEYS] Key #${i + 1}: daily quota khatam — permanently off aaj ke liye`);
    } else {
      this.cooldownUntil[i] = Date.now() + (waitMs || this.cooldownMs);
      console.log(
        `⏳ [KEYS] Key #${i + 1}: 429 cooldown ${Math.round((waitMs || this.cooldownMs) / 1000)}s`
      );
    }
  }

  markInvalid(i, reason = "") {
    this.invalid[i] = true;
    console.log(`🚫 [KEYS] Key #${i + 1}: invalid/blocked (${reason}) — rotation se hata diya`);
  }

  markTimeout(i, cooldownMs = 10000) {
    this.cooldownUntil[i] = Date.now() + cooldownMs;
  }

  isQuotaExhausted() {
    if (!this.keys.length) return false;
    return this.keys.every(
      (_, i) => this.exhausted[i] || this.invalid[i] || this.calls[i] >= this.rpdPerKey
    );
  }

  // Sab keys cooldown par hain to kitna wait karna hai (null = sab dead)
  minWaitMs() {
    const now = Date.now();
    const waits = this.keys.map((_, i) =>
      this.exhausted[i] || this.invalid[i] || this.calls[i] >= this.rpdPerKey
        ? Infinity
        : Math.max(0, this.cooldownUntil[i] - now)
    );
    const min = Math.min(...waits);
    return Number.isFinite(min) ? min : null;
  }

  resetCooldowns() {
    this.cooldownUntil = this.keys.map(() => 0);
  }

  // Safe stats — health endpoints ke liye (koi key value nahi jaati)
  stats() {
    return {
      totalKeys: this.count,
      usableNow: this.usableCount(),
      exhausted: this.exhausted.filter(Boolean).length,
      invalid: this.invalid.filter(Boolean).length,
      totalCalls: this.calls.reduce((a, b) => a + b, 0),
    };
  }
}

const keyManager = new KeyManager(API_KEYS, { rpdPerKey: 1000, cooldownMs: 45000 });

module.exports = {
  API_KEYS,
  SOURCE_VAR,
  envStatus,
  parseKeys,
  KeyManager,
  keyManager,
  maskKey,
};