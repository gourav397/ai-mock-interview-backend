// ============================================================
// config/geminiKeys.js
// SINGLE SOURCE OF TRUTH for Gemini API keys + rotation state.
// SECURITY: kabhi bhi full key print/return nahi hota — sirf masked.
//
// FIXES (is version mein):
// - geminiClient.js ke saath API mismatch FIXED:
//     reportSuccess(keyObj) / reportFailure(keyObj, reason, opts)
//   ab exist karte hain aur internally index-based methods use karte hain.
// - markInvalid/markSuccess/markRateLimited/markTimeout ab INDEX ya
//   KEY-OBJECT dono accept karte hain (object→index resolver ke saath).
// - invalid keys PERMANENT dead nahi — INVALID_RECOVERY_MS baad re-eligible
//   (model-404 storm me saari keys ek sath dead na ho jayen).
// - resetInvalid() — health endpoint / admin ke liye manual reset.
// ============================================================

require("dotenv").config();

// ---------- PARSING ----------
function parseKeys(raw) {
  if (!raw || typeof raw !== "string") return [];
  return raw
    .split(/[,\n;]+/)
    .map((k) => k.trim())
    .map((k) => {
      if (
        k.length >= 2 &&
        ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'")))
      ) {
        return k.slice(1, -1).trim();
      }
      return k;
    })
    .filter((k) => k.length > 0);
}

// ---------- FALLBACK CHAIN ----------
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

const envStatus = {
  present: !!SOURCE_VAR,
  source: SOURCE_VAR,
  count: API_KEYS.length,
  summary: API_KEYS.length
    ? `FOUND (${API_KEYS.length} keys via ${SOURCE_VAR})`
    : "MISSING (checked GEMINI_API_KEYS, GEMINI_API_KEY, GOOGLE_API_KEY, AI_KEY)",
  maskedKeys: API_KEYS.map(maskKey),
};

// ---------- RECOVERY WINDOW ----------
const INVALID_RECOVERY_MS = 10 * 60 * 1000; // 10 minutes

// Soft cooldown for non-quota, non-invalid failures (rotate & retry fast)
const SOFT_FAILURE_COOLDOWN_MS = 5 * 1000;

class KeyManager {
  constructor(keys, { rpdPerKey = 1000, cooldownMs = 45000 } = {}) {
    this.keys = keys || [];
    this.calls = this.keys.map(() => 0);
    this.exhausted = this.keys.map(() => false);     // daily quota khatam
    this.invalid = this.keys.map(() => false);       // 401/403/invalid — temporarily blocked
    this.invalidSince = this.keys.map(() => 0);      // kab invalid hui (recovery timer)
    this.cooldownUntil = this.keys.map(() => 0);     // 429 / timeout / soft cooldown
    this.idx = 0;
    this.rpdPerKey = rpdPerKey;
    this.cooldownMs = cooldownMs;
  }

  get count() {
    return this.keys.length;
  }

  // ---------- RESOLVER: index | raw string | key-object → index ----------
  _resolveIndex(target) {
    if (target === null || target === undefined) return -1;
    if (typeof target === "number") {
      return Number.isInteger(target) && target >= 0 && target < this.keys.length ? target : -1;
    }
    if (typeof target === "string") {
      return this.keys.indexOf(target);
    }
    if (typeof target === "object") {
      if (Number.isInteger(target.index) && target.index >= 0 && target.index < this.keys.length) {
        // Sanity: us index par rakhi key object ki key se match ho to best
        const atIdx = this.keys[target.index];
        const objKey = target.key;
        if (typeof objKey === "string" && atIdx !== objKey) {
          const byKey = this.keys.indexOf(objKey);
          if (byKey !== -1) return byKey;
        }
        return target.index;
      }
      const objKey = target.key || target.apiKey || target.value || target.api_key || "";
      if (typeof objKey === "string" && objKey) {
        const byKey = this.keys.indexOf(objKey);
        if (byKey !== -1) return byKey;
      }
    }
    return -1;
  }

  // Kya ye key abhi usable hai? (invalid recovery yahan handle hota hai)
  _isUsable(i, now) {
    if (this.exhausted[i]) return false;
    if (this.calls[i] >= this.rpdPerKey) return false;
    if (this.invalid[i]) {
      if (now - (this.invalidSince[i] || 0) < INVALID_RECOVERY_MS) return false;
      this.invalid[i] = false;
      this.invalidSince[i] = 0;
      console.log(`♻️ [KEYS] Key #${i + 1}: recovery window complete — dobara rotation me`);
    }
    if (this.cooldownUntil[i] > now) return false;
    return true;
  }

  usableCount() {
    const now = Date.now();
    // NOTE: recovery-check bina side-effect ke (readonly)
    return this.keys.filter(
      (_, i) =>
        !this.exhausted[i] &&
        this.calls[i] < this.rpdPerKey &&
        (!this.invalid[i] || now - (this.invalidSince[i] || 0) >= INVALID_RECOVERY_MS) &&
        this.cooldownUntil[i] <= now
    ).length;
  }

  // Round-robin — next usable key ya null
  nextKey() {
    const now = Date.now();
    const n = this.keys.length;
    for (let step = 0; step < n; step++) {
      const i = (this.idx + step) % n;
      if (this.exhausted[i]) continue;
      if (this.calls[i] >= this.rpdPerKey) {
        this.exhausted[i] = true;
        continue;
      }
      if (this.invalid[i] && now - (this.invalidSince[i] || 0) < INVALID_RECOVERY_MS) continue;
      if (this.invalid[i]) {
        this.invalid[i] = false;
        this.invalidSince[i] = 0;
        console.log(`♻️ [KEYS] Key #${i + 1}: recovery complete — dobara rotation me`);
      }
      if (this.cooldownUntil[i] > now) continue;
      this.idx = (i + 1) % n;
      return { index: i, key: this.keys[i] };
    }
    return null;
  }

  // ---------- INDEX/ OBJECT- AWARE METHODS ----------
  markSuccess(iOrKeyObj) {
    const i = this._resolveIndex(iOrKeyObj);
    if (i === -1) return;
    if (this.calls[i] !== undefined) this.calls[i]++;
    if (this.invalid[i]) {
      this.invalid[i] = false;
      this.invalidSince[i] = 0;
    }
  }

  markRateLimited(iOrKeyObj, { waitMs = null, isDaily = false } = {}) {
    const i = this._resolveIndex(iOrKeyObj);
    if (i === -1) return;
    if (isDaily) {
      this.exhausted[i] = true;
      console.log(`🚫 [KEYS] Key #${i + 1}: daily quota khatam — aaj ke liye off`);
    } else {
      this.cooldownUntil[i] = Date.now() + (waitMs || this.cooldownMs);
      console.log(`⏳ [KEYS] Key #${i + 1}: 429 cooldown ${Math.round((waitMs || this.cooldownMs) / 1000)}s`);
    }
  }

  markInvalid(iOrKeyObj, reason = "") {
    const i = this._resolveIndex(iOrKeyObj);
    if (i === -1) return;
    if (!this.invalid[i]) this.invalidSince[i] = Date.now();
    this.invalid[i] = true;
    console.log(`🚫 [KEYS] Key #${i + 1}: invalid/blocked (${reason}) — ${INVALID_RECOVERY_MS / 60000} min baad re-try hoga`);
  }

  markTimeout(iOrKeyObj, cooldownMs = 10000) {
    const i = this._resolveIndex(iOrKeyObj);
    if (i === -1) return;
    this.cooldownUntil[i] = Date.now() + cooldownMs;
  }

  // ---------- CLIENT-FACING ADAPTERS (geminiClient.js inhi ko call karta hai) ----------
  reportSuccess(keyObj) {
    this.markSuccess(keyObj);
  }

  reportFailure(keyObj, reason = "soft", opts = {}) {
    const i = this._resolveIndex(keyObj);
    if (i === -1) return;
    switch (reason) {
      case "quota":
        this.markRateLimited(i, { isDaily: !!opts.isDaily });
        break;
      case "timeout":
        this.markTimeout(i, 10000);
        break;
      case "keyInvalid":
        this.markInvalid(i, opts.detail || reason);
        break;
      case "model404":
      case "serverError":
      case "soft":
      default:
        // Key ki galti nahi — sirf thoda rotate karo, key ko punish mat karo
        this.cooldownUntil[i] = Math.max(this.cooldownUntil[i], Date.now() + SOFT_FAILURE_COOLDOWN_MS);
        break;
    }
  }

  isQuotaExhausted() {
    if (!this.keys.length) return false;
    const now = Date.now();
    return this.keys.every((_, i) => {
      if (this.exhausted[i]) return true;
      if (this.calls[i] >= this.rpdPerKey) return true;
      if (this.invalid[i]) {
        return now - (this.invalidSince[i] || 0) < INVALID_RECOVERY_MS;
      }
      return false;
    });
  }

  minWaitMs() {
    const now = Date.now();
    const waits = this.keys.map((_, i) => {
      if (this.exhausted[i] || this.calls[i] >= this.rpdPerKey) return Infinity;
      if (this.invalid[i]) {
        const remaining = INVALID_RECOVERY_MS - (now - (this.invalidSince[i] || 0));
        return remaining > 0 ? remaining : 0;
      }
      return Math.max(0, this.cooldownUntil[i] - now);
    });
    const min = Math.min(...waits);
    return Number.isFinite(min) ? min : null;
  }

  resetCooldowns() {
    this.cooldownUntil = this.keys.map(() => 0);
  }

  resetInvalid() {
    this.invalid = this.keys.map(() => false);
    this.invalidSince = this.keys.map(() => 0);
    console.log("♻️ [KEYS] Sab invalid flags reset — keys dobara usable");
  }

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
  INVALID_RECOVERY_MS,
};