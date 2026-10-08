// ============================================================
// ALEX AUTONOMOUS TASK RECOVERY
// Version: 2.0.0
//
// Purpose:
//   - Recover unfinished autonomous tasks after restart
//   - Resume only tasks configured with resumeOnRestart
//   - Never resume terminal tasks
//   - Never override an intentional pause/cancel request
//   - Delegate execution to AutonomousTaskWorker
//   - Never execute commands directly
//   - Never modify files directly
//   - Never mark tasks completed directly
//
// Architecture:
//
//   Server Restart
//        ↓
//   PersistentTaskManager
//        ↓
//   Recover interrupted "running" tasks → "queued"
//        ↓
//   AutonomousTaskRecovery
//        ↓
//   AutonomousTaskWorker
//        ↓
//   AutonomousTaskExecutor
//
// ============================================================

"use strict";

const {
  getPersistentTaskManager,
} = require("./PersistentTaskManager");

const {
  getAutonomousTaskWorker,
} = require("./AutonomousTaskWorker");

// ============================================================
// CONSTANTS
// ============================================================

const RECOVERABLE_STATUSES = new Set([
  "queued",
  "running",
]);

const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
]);

// ============================================================
// HELPERS
// ============================================================

function safeString(value, fallback = "") {
  if (value === null || value === undefined) {
    return fallback;
  }

  return String(value);
}

function normalizeStatus(value) {
  return safeString(value)
    .trim()
    .toLowerCase();
}

// ============================================================
// RECOVERY SERVICE
// ============================================================

class AutonomousTaskRecovery {
  constructor(options = {}) {
    this.taskManager =
      options.taskManager ||
      getPersistentTaskManager();

    this.worker =
      options.worker ||
      getAutonomousTaskWorker({
        taskManager: this.taskManager,
      });

    this.started = false;

    this.lastRecovery = null;

    this.recoveryPromise = null;
  }

  // ==========================================================
  // RECOVER ALL
  // ==========================================================

  async recover() {
    // Prevent two recovery passes from running at
    // the same time.
    if (this.recoveryPromise) {
      return this.recoveryPromise;
    }

    this.recoveryPromise =
      this._recoverInternal();

    try {
      return await this.recoveryPromise;
    } finally {
      this.recoveryPromise = null;
    }
  }

  // ==========================================================
  // INTERNAL RECOVERY
  // ==========================================================

  async _recoverInternal() {
    const result = {
      started: true,
      scanned: 0,
      recovered: 0,
      skipped: 0,
      failed: 0,
      tasks: [],
      recoveredAt: new Date().toISOString(),
    };

    let tasks = [];

    try {
      tasks = this._listTasks();
    } catch (error) {
      this.started = true;

      result.failed = 1;

      result.error = safeString(
        error && error.message,
        "Unable to list autonomous tasks."
      );

      this.lastRecovery = result;

      return result;
    }

    result.scanned = tasks.length;

    for (const task of tasks) {
      let taskResult;

      try {
        taskResult = await this._recoverTask(task);
      } catch (error) {
        taskResult = {
          taskId:
            task &&
            (task.id || task._id) || null,

          status: "failed",

          taskStatus:
            normalizeStatus(
              task && task.status
            ),

          error: safeString(
            error && error.message,
            "Task recovery failed."
          ),
        };
      }

      result.tasks.push(taskResult);

      if (taskResult.status === "recovered") {
        result.recovered += 1;
      } else if (taskResult.status === "failed") {
        result.failed += 1;
      } else {
        result.skipped += 1;
      }
    }

    this.lastRecovery = result;

    this.started = true;

    return result;
  }

  // ==========================================================
  // LIST TASKS
  // ==========================================================

  _listTasks() {
    if (
      !this.taskManager ||
      typeof this.taskManager.listTasks !== "function"
    ) {
      throw new Error(
        "PersistentTaskManager.listTasks() is unavailable."
      );
    }

    const tasks = this.taskManager.listTasks({
      limit: 1000,
    });

    if (!Array.isArray(tasks)) {
      return [];
    }

    return tasks;
  }

  // ==========================================================
  // RECOVER ONE TASK
  // ==========================================================

  async _recoverTask(task) {
    const taskId =
      task &&
      (task.id || task._id);

    if (!taskId) {
      return {
        status: "skipped",
        reason: "Task has no valid ID.",
      };
    }

    const status = normalizeStatus(
      task.status
    );

    // --------------------------------------------------------
    // TERMINAL TASK
    // --------------------------------------------------------

    if (TERMINAL_STATUSES.has(status)) {
      return {
        taskId,
        status: "skipped",
        reason: "Task is already terminal.",
        taskStatus: status,
      };
    }

    // --------------------------------------------------------
    // UNKNOWN STATUS
    // --------------------------------------------------------

    if (!RECOVERABLE_STATUSES.has(status)) {
      return {
        taskId,
        status: "skipped",
        reason:
          "Task status is not recoverable.",
        taskStatus: status,
      };
    }

    // --------------------------------------------------------
    // RESUME FLAG
    // --------------------------------------------------------

    if (task.resumeOnRestart === false) {
      return {
        taskId,
        status: "skipped",
        reason:
          "Task has resumeOnRestart disabled.",
        taskStatus: status,
      };
    }

    // --------------------------------------------------------
    // CANCEL REQUEST
    // --------------------------------------------------------

    if (task.cancelRequested === true) {
      return {
        taskId,
        status: "skipped",
        reason:
          "Task has a cancellation request.",
        taskStatus: status,
      };
    }

    // --------------------------------------------------------
    // PAUSE REQUEST
    // --------------------------------------------------------

    if (task.pauseRequested === true) {
      return {
        taskId,
        status: "skipped",
        reason:
          "Task has a pause request.",
        taskStatus: status,
      };
    }

    // --------------------------------------------------------
    // WORKER VALIDATION
    // --------------------------------------------------------

    if (
      !this.worker ||
      typeof this.worker.start !== "function"
    ) {
      return {
        taskId,
        status: "failed",
        taskStatus: status,
        error:
          "AutonomousTaskWorker.start() is unavailable.",
      };
    }

    // --------------------------------------------------------
    // START WORKER
    // --------------------------------------------------------

    try {
      const workerResult =
        await this.worker.start(taskId);

      return {
        taskId,

        status: "recovered",

        taskStatus: status,

        worker:
          workerResult || null,
      };
    } catch (error) {
      return {
        taskId,

        status: "failed",

        taskStatus: status,

        error: safeString(
          error && error.message,
          "Task recovery failed."
        ),
      };
    }
  }

  // ==========================================================
  // RECOVER SINGLE TASK
  // ==========================================================

  async recoverTask(taskId) {
    if (!taskId) {
      throw new Error(
        "Task ID is required."
      );
    }

    if (
      !this.taskManager ||
      typeof this.taskManager.getTask !== "function"
    ) {
      throw new Error(
        "PersistentTaskManager.getTask() is unavailable."
      );
    }

    const task =
      this.taskManager.getTask(taskId);

    if (!task) {
      throw new Error(
        "Autonomous task not found."
      );
    }

    return this._recoverTask(task);
  }

  // ==========================================================
  // STATUS
  // ==========================================================

  getStatus() {
    return {
      started: this.started,

      recovering:
        Boolean(this.recoveryPromise),

      lastRecovery:
        this.lastRecovery,
    };
  }

  // ==========================================================
  // CHECK WHETHER TASK CAN RECOVER
  // ==========================================================

  canRecover(task) {
    if (!task) {
      return false;
    }

    const status =
      normalizeStatus(task.status);

    // Terminal tasks can never be recovered.
    if (TERMINAL_STATUSES.has(status)) {
      return false;
    }

    // Only queued/running tasks are automatically
    // recoverable.
    if (!RECOVERABLE_STATUSES.has(status)) {
      return false;
    }

    // Explicit opt-out.
    if (task.resumeOnRestart === false) {
      return false;
    }

    // Explicit cancellation request.
    if (task.cancelRequested === true) {
      return false;
    }

    // Explicit pause request.
    if (task.pauseRequested === true) {
      return false;
    }

    return true;
  }
}

// ============================================================
// SINGLETON
// ============================================================

let instance = null;

function getAutonomousTaskRecovery(options = {}) {
  if (!instance) {
    instance =
      new AutonomousTaskRecovery(options);
  }

  return instance;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports =
  AutonomousTaskRecovery;

module.exports.AutonomousTaskRecovery =
  AutonomousTaskRecovery;

module.exports.getAutonomousTaskRecovery =
  getAutonomousTaskRecovery;