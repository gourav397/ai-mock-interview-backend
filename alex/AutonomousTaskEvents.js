// ============================================================
// ALEX — Autonomous Task Events
// FILE: backend/alex/AutonomousTaskEvents.js
// ============================================================

"use strict";

const { EventEmitter } = require("events");

const EVENT_NAMES = Object.freeze({
  REGISTERED: "task:registered",
  STARTED: "task:started",
  PROGRESS: "task:progress",
  STEP_STARTED: "task:step-started",
  STEP_COMPLETED: "task:step-completed",
  RETRYING: "task:retrying",
  PAUSED: "task:paused",
  RESUMED: "task:resumed",
  COMPLETED: "task:completed",
  FAILED: "task:failed",
  CANCELLED: "task:cancelled",
  RECOVERED: "task:recovered",
  VERIFIED: "task:verified",
  WORKER_STARTED: "worker:started",
  WORKER_STOPPED: "worker:stopped",
  WORKER_ERROR: "worker:error",
});

class AutonomousTaskEvents extends EventEmitter {
  constructor(options = {}) {
    super();

    this.maxHistory = Number.isFinite(options.maxHistory)
      ? Math.max(100, options.maxHistory)
      : 2000;

    this.history = [];

    this.createdAt = new Date().toISOString();
  }

  // ------------------------------------------------------------
  // GENERIC EMIT
  // ------------------------------------------------------------

  emitTask(eventName, payload = {}) {
    const event = this._createEvent(eventName, payload);

    this._record(event);

    this.emit(eventName, event);
    this.emit("task:event", event);

    return event;
  }

  // ------------------------------------------------------------
  // TASK EVENTS
  // ------------------------------------------------------------

  registered(task, metadata = {}) {
    return this.emitTask(EVENT_NAMES.REGISTERED, {
      task,
      metadata,
    });
  }

  started(task, metadata = {}) {
    return this.emitTask(EVENT_NAMES.STARTED, {
      task,
      metadata,
    });
  }

  progress(task, progress, metadata = {}) {
    return this.emitTask(EVENT_NAMES.PROGRESS, {
      task,
      progress,
      metadata,
    });
  }

  stepStarted(task, step, metadata = {}) {
    return this.emitTask(EVENT_NAMES.STEP_STARTED, {
      task,
      step,
      metadata,
    });
  }

  stepCompleted(task, step, result = null, metadata = {}) {
    return this.emitTask(EVENT_NAMES.STEP_COMPLETED, {
      task,
      step,
      result,
      metadata,
    });
  }

  retrying(task, attempt, error = null, metadata = {}) {
    return this.emitTask(EVENT_NAMES.RETRYING, {
      task,
      attempt,
      error: this._normalizeError(error),
      metadata,
    });
  }

  paused(task, metadata = {}) {
    return this.emitTask(EVENT_NAMES.PAUSED, {
      task,
      metadata,
    });
  }

  resumed(task, metadata = {}) {
    return this.emitTask(EVENT_NAMES.RESUMED, {
      task,
      metadata,
    });
  }

  completed(task, result = null, metadata = {}) {
    return this.emitTask(EVENT_NAMES.COMPLETED, {
      task,
      result,
      metadata,
    });
  }

  failed(task, error = null, metadata = {}) {
    return this.emitTask(EVENT_NAMES.FAILED, {
      task,
      error: this._normalizeError(error),
      metadata,
    });
  }

  cancelled(task, metadata = {}) {
    return this.emitTask(EVENT_NAMES.CANCELLED, {
      task,
      metadata,
    });
  }

  recovered(task, metadata = {}) {
    return this.emitTask(EVENT_NAMES.RECOVERED, {
      task,
      metadata,
    });
  }

  verified(task, verification = null, metadata = {}) {
    return this.emitTask(EVENT_NAMES.VERIFIED, {
      task,
      verification,
      metadata,
    });
  }

  // ------------------------------------------------------------
  // WORKER EVENTS
  // ------------------------------------------------------------

  workerStarted(task, workerId, metadata = {}) {
    return this.emitTask(EVENT_NAMES.WORKER_STARTED, {
      task,
      workerId,
      metadata,
    });
  }

  workerStopped(task, workerId, metadata = {}) {
    return this.emitTask(EVENT_NAMES.WORKER_STOPPED, {
      task,
      workerId,
      metadata,
    });
  }

  workerError(task, workerId, error, metadata = {}) {
    return this.emitTask(EVENT_NAMES.WORKER_ERROR, {
      task,
      workerId,
      error: this._normalizeError(error),
      metadata,
    });
  }

  // ------------------------------------------------------------
  // SUBSCRIPTIONS
  // ------------------------------------------------------------

  onTask(eventName, listener) {
    if (typeof listener !== "function") {
      throw new TypeError("listener must be a function");
    }

    return this.on(eventName, listener);
  }

  onceTask(eventName, listener) {
    if (typeof listener !== "function") {
      throw new TypeError("listener must be a function");
    }

    return this.once(eventName, listener);
  }

  onAny(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("listener must be a function");
    }

    return this.on("task:event", listener);
  }

  offTask(eventName, listener) {
    return this.off(eventName, listener);
  }

  // ------------------------------------------------------------
  // HISTORY
  // ------------------------------------------------------------

  getHistory(options = {}) {
    const {
      taskId = null,
      ownerId = null,
      eventName = null,
      limit = 100,
    } = options;

    let events = this.history;

    if (taskId !== null) {
      events = events.filter(
        (event) => String(event.taskId) === String(taskId)
      );
    }

    if (ownerId !== null) {
      events = events.filter(
        (event) => String(event.ownerId) === String(ownerId)
      );
    }

    if (eventName !== null) {
      events = events.filter(
        (event) => event.name === eventName
      );
    }

    const safeLimit = Math.max(
      1,
      Math.min(Number(limit) || 100, this.maxHistory)
    );

    return events
      .slice(-safeLimit)
      .map((event) => this._clone(event));
  }

  getTaskHistory(taskId, limit = 100) {
    return this.getHistory({
      taskId,
      limit,
    });
  }

  clearHistory() {
    this.history.length = 0;
  }

  // ------------------------------------------------------------
  // EVENT STATS
  // ------------------------------------------------------------

  getStats() {
    const stats = {
      total: this.history.length,
      byEvent: {},
    };

    for (const event of this.history) {
      stats.byEvent[event.name] =
        (stats.byEvent[event.name] || 0) + 1;
    }

    return stats;
  }

  // ------------------------------------------------------------
  // EVENT CREATION
  // ------------------------------------------------------------

  _createEvent(name, payload = {}) {
    const task = payload.task || null;

    return {
      id: this._createEventId(),

      name,

      taskId:
        payload.taskId ||
        task?.id ||
        task?.taskId ||
        null,

      ownerId:
        payload.ownerId ||
        task?.ownerId ||
        null,

      sessionId:
        payload.sessionId ||
        task?.sessionId ||
        "default",

      timestamp: new Date().toISOString(),

      payload: this._sanitizePayload(payload),
    };
  }

  // ------------------------------------------------------------
  // HISTORY RECORD
  // ------------------------------------------------------------

  _record(event) {
    this.history.push(this._clone(event));

    if (this.history.length > this.maxHistory) {
      const removeCount =
        this.history.length - this.maxHistory;

      this.history.splice(0, removeCount);
    }
  }

  // ------------------------------------------------------------
  // SANITIZATION
  // ------------------------------------------------------------

  _sanitizePayload(payload) {
    if (!payload || typeof payload !== "object") {
      return {};
    }

    const blockedKeys = new Set([
      "windowsAgentToken",
      "agentToken",
      "apiKey",
      "apiKeys",
      "GEMINI_API_KEYS",
      "authorization",
      "cookie",
      "password",
      "secret",
      "token",
    ]);

    const sanitize = (value, depth = 0) => {
      if (depth > 8) {
        return "[MAX_DEPTH]";
      }

      if (value === null || value === undefined) {
        return value;
      }

      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        return value;
      }

      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
        };
      }

      if (Array.isArray(value)) {
        return value.map((item) =>
          sanitize(item, depth + 1)
        );
      }

      if (typeof value === "object") {
        const output = {};

        for (const [key, item] of Object.entries(value)) {
          if (blockedKeys.has(key)) {
            continue;
          }

          output[key] = sanitize(item, depth + 1);
        }

        return output;
      }

      return String(value);
    };

    return sanitize(payload);
  }

  // ------------------------------------------------------------
  // ERROR NORMALIZATION
  // ------------------------------------------------------------

  _normalizeError(error) {
    if (!error) {
      return null;
    }

    if (typeof error === "string") {
      return error;
    }

    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        code: error.code || null,
      };
    }

    if (typeof error === "object") {
      return {
        message:
          error.message ||
          error.error ||
          "Unknown error",
        code: error.code || null,
      };
    }

    return String(error);
  }

  // ------------------------------------------------------------
  // ID
  // ------------------------------------------------------------

  _createEventId() {
    return (
      "evt_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 10)
    );
  }

  // ------------------------------------------------------------
  // CLONE
  // ------------------------------------------------------------

  _clone(value) {
    if (value === undefined) {
      return undefined;
    }

    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }

  // ------------------------------------------------------------
  // SHUTDOWN
  // ------------------------------------------------------------

  shutdown() {
    this.clearHistory();
    this.removeAllListeners();
  }
}

// ============================================================
// SINGLETON
// ============================================================

let eventsInstance = null;

function getAutonomousTaskEvents(options = {}) {
  if (!eventsInstance) {
    eventsInstance = new AutonomousTaskEvents(options);
  }

  return eventsInstance;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  AutonomousTaskEvents,
  EVENT_NAMES,
  getAutonomousTaskEvents,
};