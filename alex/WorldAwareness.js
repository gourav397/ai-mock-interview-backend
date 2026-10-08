// ============================================================
// ALEX WORLD AWARENESS — WEB / API OBSERVATION LAYER
// Version: 1.0.0
//
// PURPOSE:
//   Observe relevant current information from the outside
//   world (web pages, public APIs, news) so the Brain can
//   reason with FRESH data, not just memory.
//
// DESIGN RULES:
//   ✓ Node 18+ built-in fetch — zero dependencies
//   ✓ Authorized-source allowlist (no blind scraping)
//   ✓ Source registry with freshness tracking
//   ✓ TTL cache per source (dedup + rate-limit friendly)
//   ✓ Every observation emits WORLD_INFORMATION_RECEIVED
//   ✓ Never throws — failures return structured errors
//   ✓ Text extraction bounded + sanitized before use
// ============================================================

const { getEventBus, EVENTS } = require("./EventBus");

const DEFAULT_TTL_MS = 10 * 60 * 1000;      // 10 min cache per source
const MAX_CACHE_ENTRIES = 100;
const FETCH_TIMEOUT_MS = 15000;
const MAX_CONTENT_CHARS = 8000;
const MAX_REDIRECTS = 3;

class WorldAwareness {
  constructor({ gemini = null } = {}) {
    this.gemini = gemini; // optional AlexGeminiClient for summarization
    this.eventBus = getEventBus();

    // ---------- SOURCE REGISTRY ----------
    // Authorized observation sources. Add via registerSource().
    // type: "api" (JSON) | "web" (HTML/text) | "rss"
    this.sources = new Map();

    // ---------- CACHE ----------
    this.cache = new Map(); // sourceKey -> { at, data, fresh }

    // ---------- RATE LIMIT ----------
    this.lastFetch = new Map(); // sourceKey -> timestamp
    this.minFetchGapMs = 5000;
  }

  // ----------------------------------------------------------
  // REGISTER AUTHORIZED SOURCE
  // ----------------------------------------------------------
  registerSource({ key, name, type, url, headers = {}, parser = null, important = false, ttlMs = DEFAULT_TTL_MS }) {
    if (!key || !url || !["api", "web", "rss"].includes(type)) {
      return { ok: false, error: "key, valid url and type (api|web|rss) required" };
    }
    try {
      new URL(url); // validate
    } catch {
      return { ok: false, error: "invalid url" };
    }
    this.sources.set(key, { key, name: name || key, type, url, headers, parser, important, ttlMs });
    return { ok: true, key };
  }

  // ----------------------------------------------------------
  // OBSERVE ONE SOURCE (with cache + freshness)
  // ----------------------------------------------------------
  async observe(sourceKey, { force = false } = {}) {
    const src = this.sources.get(sourceKey);
    if (!src) return { ok: false, error: `unknown source: ${sourceKey}` };

    // cache check
    const cached = this.cache.get(sourceKey);
    if (!force && cached && Date.now() - cached.at < src.ttlMs) {
      return { ok: true, source: src.name, data: cached.data, cached: true, observedAt: cached.at };
    }

    // rate limit
    const last = this.lastFetch.get(sourceKey) || 0;
    if (Date.now() - last < this.minFetchGapMs) {
      return { ok: false, error: "rate-limited, try again shortly" };
    }
    this.lastFetch.set(sourceKey, Date.now());

    try {
      const raw = await this._fetch(src.url, src.headers);
      const data = src.parser ? src.parser(raw) : this._defaultParse(src.type, raw);

      this.cache.set(sourceKey, { at: Date.now(), data });
      if (this.cache.size > MAX_CACHE_ENTRIES) {
        const oldest = [...this.cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (oldest) this.cache.delete(oldest[0]);
      }

      this.eventBus.emit(EVENTS.WORLD_INFORMATION_RECEIVED, {
        source: src.name, summary: this._summarizeForEvent(data),
      }, { source: "WorldAwareness" });

      return { ok: true, source: src.name, data, cached: false, observedAt: Date.now() };
    } catch (err) {
      return { ok: false, error: `observation failed: ${err.message}`, source: src.name };
    }
  }

  // ----------------------------------------------------------
  // OBSERVE MULTIPLE SOURCES — parallel, failures isolated
  // ----------------------------------------------------------
  async observeAll(sourceKeys = null, opts = {}) {
    const keys = sourceKeys || [...this.sources.keys()];
    const results = await Promise.all(
      keys.map(async (k) => {
        const r = await this.observe(k, opts);
        return { source: k, ...r };
      })
    );
    return {
      ok: results.some((r) => r.ok),
      observations: results,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    };
  }

  // ----------------------------------------------------------
  // FORMAT FOR BRAIN PROMPT — fresh world context
  // ----------------------------------------------------------
  formatForPrompt(observations) {
    if (!observations || !observations.length) return "";
    const lines = ["CURRENT WORLD INFORMATION (freshly observed):"];
    for (const obs of observations.filter((o) => o.ok).slice(0, 6)) {
      lines.push(`- [${obs.source}] ${this._summarizeForEvent(obs.data)}`);
    }
    const failed = observations.filter((o) => !o.ok);
    if (failed.length) {
      lines.push(`(unavailable sources: ${failed.map((f) => f.source).join(", ")})`);
    }
    return lines.join("\n");
  }

  // ----------------------------------------------------------
  // ANSWER A FRESH-INFORMATION QUESTION using allowlisted sources
  // e.g. Brain asks: "kya is topic pe latest info chahiye?"
  // ----------------------------------------------------------
  async observeForGoal(goal, { limit = 3 } = {}) {
    const goalWords = String(goal).toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const ranked = [...this.sources.values()]
      .map((s) => {
        let score = 0;
        const hay = `${s.key} ${s.name}`.toLowerCase();
        for (const w of goalWords) if (hay.includes(w)) score += 2;
        if (s.important) score += 1;
        return { src: s, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.src.key);

    if (!ranked.length) return null;
    const result = await this.observeAll(ranked);
    return result;
  }

  listSources() {
    return [...this.sources.values()].map((s) => ({
      key: s.key, name: s.name, type: s.type, important: s.important,
      cached: this.cache.has(s.key),
      cacheAgeMs: this.cache.has(s.key) ? Date.now() - this.cache.get(s.key).at : null,
    }));
  }

  // ==========================================================
  // INTERNAL
  // ==========================================================
  async _fetch(url, headers = {}) {
    let redirects = 0;
    let currentUrl = url;
    while (true) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(currentUrl, {
          headers: {
            "User-Agent": "ALEX-Assistant/1.0 (+authorized personal assistant)",
            Accept: "application/json, text/html, text/plain;q=0.9, */*;q=0.5",
            ...headers,
          },
          signal: ctrl.signal,
          redirect: "manual",
        });
        if ([301, 302, 307, 308].includes(res.status)) {
          if (++redirects > MAX_REDIRECTS) throw new Error("too many redirects");
          currentUrl = res.headers.get("location");
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
      } finally {
        clearTimeout(timer);
      }
    }
  }

  _defaultParse(type, raw) {
    if (type === "api") {
      try {
        const json = JSON.parse(raw);
        return { kind: "api", content: JSON.stringify(json).slice(0, MAX_CONTENT_CHARS) };
      } catch {
        return { kind: "api", content: String(raw).slice(0, MAX_CONTENT_CHARS) };
      }
    }
    // web: strip tags/scripts → plain text
    const text = String(raw)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
    return { kind: "web", content: text.slice(0, MAX_CONTENT_CHARS) };
  }

  _summarizeForEvent(data) {
    if (!data) return "";
    const c = typeof data.content === "string" ? data.content : JSON.stringify(data);
    return c.slice(0, 200);
  }
}

// ---------- Singleton ----------
let _instance = null;
function getWorldAwareness(opts = {}) {
  if (!_instance) _instance = new WorldAwareness(opts);
  return _instance;
}

module.exports = { WorldAwareness, getWorldAwareness };