// ============================================================
// ALEX — Autonomous Task Registry
// FILE: backend/alex/AutonomousTaskRegistry.js
// ============================================================

"use strict";

const { EventEmitter } = require("events");

class AutonomousTaskRegistry extends EventEmitter {
  constructor(options = {}) {
    super();

    this.tasks = new Map();

    this.maxTrackedTasks = Number.isFinite(options.maxTrackedTasks)
      ? Math.max(100, options.maxTrackedTasks)
      : 5000;

    this.cleanupIntervalMs = Number.isFinite(options.cleanupIntervalMs)
      ? Math.max(10000, options.cleanupIntervalMs)
      : 5 * 60 * 1000;

    this.terminalStatuses = new Set([
      "completed",
      "failed",
      "cancelled",
    ]);

    this._cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.cleanupIntervalMs);

    if (this._cleanupTimer && typeof this._cleanupTimer.unref === "function") {
      this._cleanupTimer.unref();
    }
  }

  // ------------------------------------------------------------
  // REGISTER
  // ------------------------------------------------------------

  register(task, metadata = {}) {
    if (!task || !task.id) {
      throw new Error("Task with valid id is required");
    }

    const taskId = String(task.id);

    const existing = this.tasks.get(taskId);

    if (existing) {
      existing.task = this._cloneTask(task);
      existing.metadata = {
        ...existing.metadata,
        ...this._sanitizeMetadata(metadata),
      };
      existing.updatedAt = new Date().toISOString();

      this.emit("updated", this.get(taskId));

      return this.get(taskId);
    }

    const entry = {
      taskId,
      ownerId: task.ownerId || metadata.ownerId || null,
      sessionId: task.sessionId || metadata.sessionId || "default",

      task: this._cloneTask(task),

      status: task.status || "queued",

      workerId: metadata.workerId || null,

      metadata: this._sanitizeMetadata(metadata),

      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
    };

    this.tasks.set(taskId, entry);

    this._enforceLimit();

    this.emit("registered", this.get(taskId));

    return this.get(taskId);
  }

  // ------------------------------------------------------------
  // UPDATE
  // ------------------------------------------------------------

  update(taskId, patch = {}) {
    const id = String(taskId || "");

    if (!id) {
      return null;
    }

    const entry = this.tasks.get(id);

    if (!entry) {
      return null;
    }

    if (patch.task) {
      entry.task = this._cloneTask({
        ...entry.task,
        ...patch.task,
      });
    }

    if (patch.status) {
      entry.status = String(patch.status);
    }

    if (patch.ownerId !== undefined) {
      entry.ownerId = patch.ownerId;
    }

    if (patch.sessionId !== undefined) {
      entry.sessionId = patch.sessionId;
    }

    if (patch.workerId !== undefined) {
      entry.workerId = patch.workerId;
    }

    if (patch.metadata && typeof patch.metadata === "object") {
      entry.metadata = {
        ...entry.metadata,
        ...this._sanitizeMetadata(patch.metadata),
      };
    }

    if (patch.startedAt) {
      entry.startedAt = patch.startedAt;
    }

    if (patch.completedAt) {
      entry.completedAt = patch.completedAt;
    }

    entry.updatedAt = new Date().toISOString();

    this.emit("updated", this.get(id));

    return this.get(id);
  }

  // ------------------------------------------------------------
  // START WORKER
  // ------------------------------------------------------------

  markStarted(taskId, workerId = null) {
    const id = String(taskId || "");

    const entry = this.tasks.get(id);

    if (!entry) {
      return null;
    }

    if (entry.status === "running" && entry.workerId) {
      return this.get(id);
    }

    entry.status = "running";
    entry.workerId = workerId || entry.workerId || `worker_${id}`;

    if (!entry.startedAt) {
      entry.startedAt = new Date().toISOString();
    }

    entry.updatedAt = new Date().toISOString();

    this.emit("started", this.get(id));

    return this.get(id);
  }

  // ------------------------------------------------------------
  // COMPLETE
  // ------------------------------------------------------------

  markCompleted(taskId, result = null) {
    const id = String(taskId || "");

    const entry = this.tasks.get(id);

    if (!entry) {
      return null;
    }

    entry.status = "completed";
    entry.completedAt = new Date().toISOString();
    entry.updatedAt = entry.completedAt;

    entry.task = {
      ...entry.task,
      status: "completed",
      result: result ?? entry.task.result ?? null,
    };

    this.emit("completed", this.get(id));

    return this.get(id);
  }

  // ------------------------------------------------------------
  // FAIL
  // ------------------------------------------------------------

  markFailed(taskId, error = null) {
    const id = String(taskId || "");

    const entry = this.tasks.get(id);

    if (!entry) {
      return null;
    }

    entry.status = "failed";
    entry.updatedAt = new Date().toISOString();

    entry.task = {
      ...entry.task,
      status: "failed",
      error: this._normalizeError(error),
    };

    this.emit("failed", this.get(id));

    return this.get(id);
  }

  // ------------------------------------------------------------
  // PAUSE
  // ------------------------------------------------------------

  markPaused(taskId) {
    return this.update(taskId, {
      status: "paused",
      task: {
        status: "paused",
      },
    });
  }

  // ------------------------------------------------------------
  // CANCEL
  // ------------------------------------------------------------

  markCancelled(taskId) {
    const id = String(taskId || "");

    const entry = this.tasks.get(id);

    if (!entry) {
      return null;
    }

    entry.status = "cancelled";
    entry.updatedAt = new Date().toISOString();

    entry.task = {
      ...entry.task,
      status: "cancelled",
    };

    this.emit("cancelled", this.get(id));

    return this.get(id);
  }

  // ------------------------------------------------------------
  // WORKER CHECK
  // ------------------------------------------------------------

  has(taskId) {
    return this.tasks.has(String(taskId || ""));
  }

  hasActiveWorker(taskId) {
    const entry = this.tasks.get(String(taskId || ""));

    if (!entry) {
      return false;
    }

    return (
      entry.status === "running" &&
      Boolean(entry.workerId)
    );
  }

  canStart(taskId) {
    const entry = this.tasks.get(String(taskId || ""));

    if (!entry) {
      return true;
    }

    if (entry.status === "running" && entry.workerId) {
      return false;
    }

    if (entry.status === "completed") {
      return false;
    }

    if (entry.status === "cancelled") {
      return false;
    }

    return true;
  }

  // ------------------------------------------------------------
  // GET
  // ------------------------------------------------------------

  get(taskId) {
    const entry = this.tasks.get(String(taskId || ""));

    if (!entry) {
      return null;
    }

    return this._cloneEntry(entry);
  }

  // ------------------------------------------------------------
  // GET BY OWNER
  // ------------------------------------------------------------

  getByOwner(ownerId) {
    const id = ownerId == null ? null : String(ownerId);

    return Array.from(this.tasks.values())
      .filter((entry) => {
        if (id === null) {
          return true;
        }

        return String(entry.ownerId) === id;
      })
      .map((entry) => this._cloneEntry(entry));
  }

  // ------------------------------------------------------------
  // GET ACTIVE
  // ------------------------------------------------------------

  getActive(ownerId = null) {
    const tasks = this.getByOwner(ownerId);

    return tasks.filter((entry) => {
      return !this.terminalStatuses.has(entry.status);
    });
  }

  // ------------------------------------------------------------
  // GET RUNNING
  // ------------------------------------------------------------

  getRunning(ownerId = null) {
    const tasks = this.getByOwner(ownerId);

    return tasks.filter((entry) => {
      return entry.status === "running";
    });
  }

  // ------------------------------------------------------------
  // REMOVE
  // ------------------------------------------------------------

  remove(taskId) {
    const id = String(taskId || "");

    if (!this.tasks.has(id)) {
      return false;
    }

    const task = this.get(id);

    this.tasks.delete(id);

    this.emit("removed", task);

    return true;
  }

  // ------------------------------------------------------------
  // CLEANUP
  // ------------------------------------------------------------

  cleanup() {
    const now = Date.now();

    const retentionMs = 60 * 60 * 1000;

    for (const [taskId, entry] of this.tasks.entries()) {
      if (!this.terminalStatuses.has(entry.status)) {
        continue;
      }

      const timestamp =
        entry.completedAt ||
        entry.updatedAt ||
        entry.createdAt;

      const time = new Date(timestamp).getTime();

      if (!Number.isFinite(time)) {
        continue;
      }

      if (now - time > retentionMs) {
        this.tasks.delete(taskId);
        this.emit("removed", this._cloneEntry(entry));
      }
    }

    this._enforceLimit();
  }

  // ------------------------------------------------------------
  // LIMIT
  // ------------------------------------------------------------

  _enforceLimit() {
    if (this.tasks.size <= this.maxTrackedTasks) {
      return;
    }

    const entries = Array.from(this.tasks.values())
      .sort((a, b) => {
        return (
          new Date(a.updatedAt).getTime() -
          new Date(b.updatedAt).getTime()
        );
      });

    const removeCount = this.tasks.size - this.maxTrackedTasks;

    for (let i = 0; i < removeCount; i++) {
      const entry = entries[i];

      if (!entry) {
        continue;
      }

      if (!this.terminalStatuses.has(entry.status)) {
        continue;
      }

      this.tasks.delete(entry.taskId);

      this.emit("removed", this._cloneEntry(entry));
    }
  }

  // ------------------------------------------------------------
  // STATUS
  // ------------------------------------------------------------

  getStatus(taskId) {
    const entry = this.tasks.get(String(taskId || ""));

    if (!entry) {
      return null;
    }

    return {
      taskId: entry.taskId,
      ownerId: entry.ownerId,
      sessionId: entry.sessionId,
      status: entry.status,
      workerId: entry.workerId,
      startedAt: entry.startedAt,
      completedAt: entry.completedAt,
      updatedAt: entry.updatedAt,
    };
  }

  // ------------------------------------------------------------
  // SUMMARY
  // ------------------------------------------------------------

  getSummary(ownerId = null) {
    const tasks = this.getByOwner(ownerId);

    const summary = {
      total: tasks.length,
      queued: 0,
      running: 0,
      paused: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };

    for (const task of tasks) {
      if (Object.prototype.hasOwnProperty.call(summary, task.status)) {
        summary[task.status]++;
      }
    }

    summary.active =
      summary.queued +
      summary.running +
      summary.paused;

    return summary;
  }

  // ------------------------------------------------------------
  // SHUTDOWN
  // ------------------------------------------------------------

  shutdown() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }

    this.removeAllListeners();
  }

  // ------------------------------------------------------------
  // INTERNAL HELPERS
  // ------------------------------------------------------------

  _cloneTask(task) {
    if (!task || typeof task !== "object") {
      return task;
    }

    try {
      return JSON.parse(JSON.stringify(task));
    } catch {
      return {
        ...task,
      };
    }
  }

  _cloneEntry(entry) {
    return this._cloneTask(entry);
  }

  _sanitizeMetadata(metadata) {
    if (!metadata || typeof metadata !== "object") {
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

    const result = {};

    for (const [key, value] of Object.entries(metadata)) {
      if (blockedKeys.has(key)) {
        continue;
      }

      result[key] = value;
    }

    return result;
  }

  _normalizeError(error) {
    if (!error) {
      return null;
    }

    if (typeof error === "string") {
      return error;
    }

    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === "object") {
      return (
        error.message ||
        error.error ||
        JSON.stringify(error)
      );
    }

    return String(error);
  }
}

// ============================================================
// SINGLETON
// ============================================================

let registryInstance = null;

function getAutonomousTaskRegistry(options = {}) {
  if (!registryInstance) {
    registryInstance = new AutonomousTaskRegistry(options);
  }

  return registryInstance;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  AutonomousTaskRegistry,
  getAutonomousTaskRegistry,
};