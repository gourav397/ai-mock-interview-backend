// ============================================================
// config/geminiKeys.js
// SINGLE SOURCE OF TRUTH for Gemini API keys + rotation state.
// SECURITY: kabhi bhi full key print/return nahi hota — sirf masked.
//
// FIXES:
// - invalid keys PERMANENT dead nahi — 10 min baad re-eligible
//   (model-404 storm me saari keys ek sath dead na ho jayen)
// - resetInvalid() — health endpoint / admin ke liye manual reset
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

// ---------- KEY MANAGER ----------
// INVALID_RECOVERY_MS: invalid key itni der baad automatically
// re-eligible ho jati hai. Isse model-404 storm (galat model name)
// me saari keys permanently dead nahi hotin — model fix deploy
// hote hi keys khud recover ho jati hain.
const INVALID_RECOVERY_MS = 10 * 60 * 1000; // 10 minutes

class KeyManager {
  constructor(keys, { rpdPerKey = 1000, cooldownMs = 45000 } = {}) {
    this.keys = keys || [];
    this.calls = this.keys.map(() => 0);
    this.exhausted = this.keys.map(() => false);     // daily quota khatam
    this.invalid = this.keys.map(() => false);       // 401/403/404 — temporarily blocked
    this.invalidSince = this.keys.map(() => 0);      // kab invalid hui (recovery timer)
    this.cooldownUntil = this.keys.map(() => 0);     // 429 / timeout cooldown
    this.idx = 0;
    this.rpdPerKey = rpdPerKey;
    this.cooldownMs = cooldownMs;
  }

  get count() {
    return this.keys.length;
  }

  // Kya ye key abhi usable hai? (invalid recovery yahan handle hota hai)
  _isUsable(i, now) {
    if (this.exhausted[i]) return false;
    if (this.calls[i] >= this.rpdPerKey) return false;
    if (this.invalid[i]) {
      // recovery window nikal gayi? to dobara try karo
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
    // NOTE: _isUsable side-effect (recovery) ke sath hai — yahan readonly chahiye,
    // isliye recovery-check bina side-effect ke karte hain
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
      // recovery window complete — revive
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

  markSuccess(i) {
    if (this.calls[i] !== undefined) this.calls[i]++;
    // success hui to koi bhi negative flag clear
    if (this.invalid[i]) {
      this.invalid[i] = false;
      this.invalidSince[i] = 0;
    }
  }

  markRateLimited(i, { waitMs = null, isDaily = false } = {}) {
    if (isDaily) {
      this.exhausted[i] = true;
      console.log(`🚫 [KEYS] Key #${i + 1}: daily quota khatam — aaj ke liye off`);
    } else {
      this.cooldownUntil[i] = Date.now() + (waitMs || this.cooldownMs);
      console.log(`⏳ [KEYS] Key #${i + 1}: 429 cooldown ${Math.round((waitMs || this.cooldownMs) / 1000)}s`);
    }
  }

  markInvalid(i, reason = "") {
    if (!this.invalid[i]) this.invalidSince[i] = Date.now();
    this.invalid[i] = true;
    console.log(`🚫 [KEYS] Key #${i + 1}: invalid/blocked (${reason}) — ${INVALID_RECOVERY_MS / 60000} min baad re-try hoga`);
  }

  markTimeout(i, cooldownMs = 10000) {
    this.cooldownUntil[i] = Date.now() + cooldownMs;
  }

  isQuotaExhausted() {
    if (!this.keys.length) return false;
    const now = Date.now();
    return this.keys.every((_, i) => {
      if (this.exhausted[i]) return true;
      if (this.calls[i] >= this.rpdPerKey) return true;
      if (this.invalid[i]) {
        // recovery window ke baad ye key wapas usable mani jayegi
        return now - (this.invalidSince[i] || 0) < INVALID_RECOVERY_MS;
      }
      return false;
    });
  }

  // Sab keys cooldown par hain to kitna wait karna hai (null = sab dead)
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

  // Manual reset — health/admin endpoint se sab invalid flags clear
  resetInvalid() {
    this.invalid = this.keys.map(() => false);
    this.invalidSince = this.keys.map(() => 0);
    console.log("♻️ [KEYS] Sab invalid flags reset — keys dobara usable");
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
  INVALID_RECOVERY_MS,
};