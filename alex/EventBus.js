// ============================================================
// ALEX EVENT BUS — CENTRAL EVENT / OBSERVATION SYSTEM
// Version: 1.0.0
//
// PURPOSE:
//   Single unified event model so Brain, Memory, Autonomous
//   Tasks, World Awareness and Monitoring can communicate
//   without direct coupling.
//
// DESIGN RULES:
//   ✓ Zero dependencies — pure Node.js EventEmitter
//   ✓ Never throws: handler errors are isolated and logged
//   ✓ Bounded history ring-buffer (debug/audit + recent events)
//   ✓ Singleton via getEventBus() — safe across requires
//   ✓ Handler errors never crash the host process
// ============================================================

const { EventEmitter } = require("events");

const MAX_HISTORY = 500;
const MAX_LISTENERS = 50;

// Canonical event names — use these constants everywhere.
const EVENTS = Object.freeze({
  // Owner / interface
  USER_GOAL_RECEIVED: "user_goal_received",
  OWNER_CONFIRMATION_REQUIRED: "owner_confirmation_required",

  // Brain
  MEMORY_RETRIEVED: "memory_retrieved",
  PLAN_CREATED: "plan_created",

  // Actions
  ACTION_STARTED: "action_started",
  ACTION_COMPLETED: "action_completed",
  ACTION_FAILED: "action_failed",

  // World awareness
  WORLD_INFORMATION_RECEIVED: "world_information_received",
  IMPORTANT_WORLD_CHANGE_DETECTED: "important_world_change_detected",

  // Verification / reflection
  OBSERVATION_RECEIVED: "observation_received",
  VERIFICATION_STARTED: "verification_started",
  VERIFICATION_PASSED: "verification_passed",
  VERIFICATION_FAILED: "verification_failed",

  // Tasks
  TASK_CREATED: "task_created",
  TASK_STARTED: "task_started",
  TASK_PROGRESS: "task_progress",
  TASK_REPLANNED: "task_replanned",
  TASK_RECOVERED: "task_recovered",
  TASK_PAUSED: "task_paused",
  TASK_CANCELLED: "task_cancelled",
  TASK_COMPLETED: "task_completed",
  TASK_FAILED: "task_failed",

  // Learning
  EXPERIENCE_STORED: "experience_stored",

  // System
  SYSTEM_HEALTH_ALERT: "system_health_alert",
  SECURITY_EVENT: "security_event",
});

class EventBus {
  constructor() {
    this._emitter = new EventEmitter();
    this._emitter.setMaxListeners(MAX_LISTENERS);
    this._history = []; // ring buffer of recent events
  }

  // ----------------------------------------------------------
  // EMIT — safe, never throws
  // payload should be a plain serializable object
  // ----------------------------------------------------------
  emit(eventType, payload = {}, meta = {}) {
    if (!eventType || typeof eventType !== "string") {
      return false;
    }

    const record = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: eventType,
      payload: this._sanitize(payload),
      meta: {
        source: meta.source || "unknown",
        ownerId: meta.ownerId || null,
        taskId: meta.taskId || null,
        sessionId: meta.sessionId || null,
        at: new Date().toISOString(),
      },
    };

    // bounded history
    this._history.push(record);
    if (this._history.length > MAX_HISTORY) {
      this._history.splice(0, this._history.length - MAX_HISTORY);
    }

    try {
      this._emitter.emit(eventType, record);
      this._emitter.emit("*", record); // wildcard listeners
    } catch (err) {
      // last-resort guard: a broken emit must never crash ALEX
      console.error("⚠️ EventBus emit error:", err.message);
    }
    return true;
  }

  // ----------------------------------------------------------
  // SUBSCRIBE
  // handler receives the full event record (type, payload, meta)
  // ----------------------------------------------------------
  on(eventType, handler, { source = "unknown" } = {}) {
    if (typeof handler !== "function") return () => {};
    const wrapped = (record) => {
      try {
        handler(record);
      } catch (err) {
        console.error(
          `⚠️ EventBus handler error (${eventType}, source=${source}):`,
          err.message
        );
      }
    };
    wrapped._source = source;
    this._emitter.on(eventType, wrapped);
    return () => this._emitter.removeListener(eventType, wrapped);
  }

  once(eventType, handler) {
    if (typeof handler !== "function") return () => {};
    const wrapped = (record) => {
      try {
        handler(record);
      } catch (err) {
        console.error(`⚠️ EventBus once-handler error (${eventType}):`, err.message);
      }
    };
    this._emitter.once(eventType, wrapped);
    return () => this._emitter.removeListener(eventType, wrapped);
  }

  // subscribe to all events
  onAny(handler, { source = "unknown" } = {}) {
    return this.on("*", handler, { source });
  }

  // ----------------------------------------------------------
  // HISTORY / DEBUG
  // ----------------------------------------------------------
  getRecent({ type = null, limit = 50, ownerId = null } = {}) {
    let items = this._history;
    if (type) items = items.filter((e) => e.type === type);
    if (ownerId) items = items.filter((e) => e.meta.ownerId === ownerId);
    return items.slice(-limit);
  }

  getStats() {
    const counts = {};
    for (const e of this._history) {
      counts[e.type] = (counts[e.type] || 0) + 1;
    }
    return { totalRecorded: this._history.length, counts };
  }

  // ----------------------------------------------------------
  // INTERNAL — strip non-serializable + secrets from payloads
  // ----------------------------------------------------------
  _sanitize(payload) {
    const SECRET_KEYS =
      /(token|secret|password|passwd|apikey|api_key|authorization|cookie|credential)/i;
    const seen = new WeakSet();
    const walk = (val, depth) => {
      if (val == null || depth > 4) return typeof val === "object" ? "[truncated]" : val;
      if (typeof val === "string") {
        return val.length > 500 ? val.slice(0, 500) + "…[truncated]" : val;
      }
      if (typeof val !== "object") return val;
      if (seen.has(val)) return "[circular]";
      seen.add(val);
      if (Array.isArray(val)) return val.slice(0, 20).map((v) => walk(v, depth + 1));
      const out = {};
      for (const [k, v] of Object.entries(val).slice(0, 30)) {
        out[k] = SECRET_KEYS.test(k) ? "[masked]" : walk(v, depth + 1);
      }
      return out;
    };
    try {
      return walk(payload, 0);
    } catch {
      return { note: "payload not serializable" };
    }
  }
}

// ---------- Singleton ----------
let _instance = null;
function getEventBus() {
  if (!_instance) _instance = new EventBus();
  return _instance;
}

module.exports = { EventBus, getEventBus, EVENTS };