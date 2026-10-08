// ============================================================
// ALEX LEARNING STORE — EXPERIENCE FROM TASK OUTCOMES
// Version: 1.0.0
//
// PURPOSE:
//   Persist structured records of what ALEX attempted,
//   what worked, what failed, and why — so future planning
//   can retrieve relevant verified experience.
//
// DESIGN RULES:
//   ✓ JSON file persistence (restart-safe), atomic writes
//   ✓ Owner-scoped isolation (ownerKey namespacing)
//   ✓ Retrieval by keyword relevance + goal similarity
//   ✓ Bounded: max records per owner (prune oldest/least useful)
//   ✓ Never throws on read — corrupted file self-heals
// ============================================================

const fs = require("fs");
const path = require("path");
const { getEventBus, EVENTS } = require("./EventBus");

const DATA_DIR = path.join(process.cwd(), ".alex-data");
const DATA_FILE = path.join(DATA_DIR, "learning-store.json");

const MAX_RECORDS_PER_OWNER = 200;
const SAVE_DEBOUNCE_MS = 2000;

class LearningStore {
  constructor() {
    this._data = { version: 1, owners: {} }; // ownerKey -> records[]
    this._saveTimer = null;
    this._dirty = false;
    this._load();
    this.eventBus = getEventBus();
  }

  // ----------------------------------------------------------
  // STORE AN EXPERIENCE — call after task verification completes
  // ----------------------------------------------------------
  /**
   * record = {
   *   ownerKey, goal, taskType,
   *   outcome: "success" | "failure" | "partial",
   *   approach: what was done (string, short),
   *   whatWorked, whatFailed, whyFailed, solution,
   *   avoidNextTime,
   *   attempts, durationMs,
   *   tags: ["node", "test", "deploy", ...],
   *   sourceTaskId
   * }
   */
  storeExperience(record) {
    try {
      if (!record || !record.ownerKey || !record.goal) return null;

      const entry = {
        id: `exp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        goal: String(record.goal).slice(0, 500),
        taskType: record.taskType || "general",
        outcome: ["success", "failure", "partial"].includes(record.outcome)
          ? record.outcome
          : "partial",
        approach: this._clip(record.approach, 1000),
        whatWorked: this._clip(record.whatWorked, 500),
        whatFailed: this._clip(record.whatFailed, 500),
        whyFailed: this._clip(record.whyFailed, 500),
        solution: this._clip(record.solution, 500),
        avoidNextTime: this._clip(record.avoidNextTime, 500),
        attempts: Number(record.attempts) || 1,
        durationMs: Number(record.durationMs) || 0,
        tags: (Array.isArray(record.tags) ? record.tags : [])
          .slice(0, 10)
          .map((t) => String(t).toLowerCase().slice(0, 40)),
        sourceTaskId: record.sourceTaskId || null,
        useCount: 0,
        createdAt: new Date().toISOString(),
      };

      const ownerKey = String(record.ownerKey);
      if (!this._data.owners[ownerKey]) this._data.owners[ownerKey] = [];
      const records = this._data.owners[ownerKey];

      records.push(entry);
      // prune: keep most recent + successful ones
      if (records.length > MAX_RECORDS_PER_OWNER) {
        records.sort((a, b) => this._score(b) - this._score(a));
        records.length = MAX_RECORDS_PER_OWNER;
      }

      this._scheduleSave();

      this.eventBus.emit(EVENTS.EXPERIENCE_STORED, {
        experienceId: entry.id,
        outcome: entry.outcome,
        goal: entry.goal,
      }, { ownerId: ownerKey, taskId: entry.sourceTaskId, source: "LearningStore" });

      return entry.id;
    } catch (err) {
      console.error("⚠️ LearningStore.storeExperience:", err.message);
      return null;
    }
  }

  // ----------------------------------------------------------
  // RETRIEVE RELEVANT EXPERIENCE before attempting similar task
  // Returns top-N relevant records (successes AND failures)
  // ----------------------------------------------------------
  retrieveRelevant(ownerKey, goal, { limit = 5 } = {}) {
    try {
      const records = this._data.owners[String(ownerKey)];
      if (!records || records.length === 0) return [];

      const goalWords = this._tokenize(goal);

      const scored = records
        .map((r) => {
          let score = 0;
          // goal similarity via token overlap
          const recWords = new Set([
            ...this._tokenize(r.goal),
            ...(r.tags || []),
          ]);
          for (const w of goalWords) {
            if (recWords.has(w)) score += 2;
          }
          // taskType exact match bonus
          score += 1;
          // successful solutions are more valuable, failures are cautionary
          if (r.outcome === "success") score += 1;
          if (r.outcome === "failure") score += 0.5; // still worth knowing
          // recency bonus (last 7 days)
          const ageDays =
            (Date.now() - new Date(r.createdAt).getTime()) / 86400000;
          if (ageDays < 7) score += 1;
          else if (ageDays < 30) score += 0.5;
          return { record: r, score };
        })
        .filter((x) => x.score > 2) // must have at least one goal-word overlap
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      // track usage (helps pruning keep useful records)
      for (const { record } of scored) record.useCount = (record.useCount || 0) + 1;
      if (scored.length) this._scheduleSave();

      return scored.map(({ record }) => record);
    } catch (err) {
      console.error("⚠️ LearningStore.retrieveRelevant:", err.message);
      return [];
    }
  }

  // ----------------------------------------------------------
  // FORMAT FOR BRAIN PROMPT — compact, honest, structured
  // ----------------------------------------------------------
  formatForPrompt(records) {
    if (!records || records.length === 0) return "";
    const lines = ["RELEVANT PAST EXPERIENCE (verified task outcomes):"];
    for (const r of records.slice(0, 5)) {
      lines.push(
        `- [${r.outcome.toUpperCase()}] Goal: "${r.goal}"` +
          (r.whatWorked ? ` | Worked: ${r.whatWorked}` : "") +
          (r.whatFailed ? ` | Failed: ${r.whatFailed}` : "") +
          (r.solution ? ` | Solution: ${r.solution}` : "") +
          (r.avoidNextTime ? ` | Avoid: ${r.avoidNextTime}` : "")
      );
    }
    return lines.join("\n");
  }

  getStats(ownerKey = null) {
    if (ownerKey) {
      const records = this._data.owners[String(ownerKey)] || [];
      return {
        total: records.length,
        success: records.filter((r) => r.outcome === "success").length,
        failure: records.filter((r) => r.outcome === "failure").length,
      };
    }
    return { owners: Object.keys(this._data.owners).length };
  }

  // ----------------------------------------------------------
  // PERSISTENCE — atomic write (tmp + rename)
  // ----------------------------------------------------------
  _scheduleSave() {
    this._dirty = true;
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      if (this._dirty) this._saveNow();
    }, SAVE_DEBOUNCE_MS);
    if (this._saveTimer.unref) this._saveTimer.unref();
  }

  _saveNow() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DATA_FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(this._data, null, 2));
      fs.renameSync(tmp, DATA_FILE);
      this._dirty = false;
    } catch (err) {
      console.error("⚠️ LearningStore save failed:", err.message);
    }
  }

  _load() {
    try {
      if (!fs.existsSync(DATA_FILE)) return;
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      if (raw && typeof raw === "object" && raw.owners) {
        this._data = { version: 1, owners: raw.owners };
      }
    } catch (err) {
      // corrupted file — back it up and start fresh
      try {
        fs.renameSync(DATA_FILE, DATA_FILE + ".corrupt-" + Date.now());
      } catch {}
      console.error("⚠️ LearningStore: corrupted data file, starting fresh");
    }
  }

  // ----------------------------------------------------------
  // HELPERS
  // ----------------------------------------------------------
  _clip(v, max) {
    if (v == null) return "";
    return String(v).slice(0, max);
  }

  _tokenize(text) {
    if (!text) return [];
    return String(text)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 30);
  }

  _score(r) {
    // pruning priority: successful + used + recent records survive
    const ageDays = (Date.now() - new Date(r.createdAt).getTime()) / 86400000;
    return (
      (r.outcome === "success" ? 3 : r.outcome === "partial" ? 2 : 1) +
      (r.useCount || 0) +
      Math.max(0, 2 - ageDays / 30)
    );
  }
}

// ---------- Singleton ----------
let _instance = null;
function getLearningStore() {
  if (!_instance) _instance = new LearningStore();
  return _instance;
}

module.exports = { LearningStore, getLearningStore };