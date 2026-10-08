// ============================================================
// ALEX AUTONOMOUS TASK STATUS
// Version: 1.1.0
//
// Purpose:
//   - Read autonomous task status
//   - Calculate progress information
//   - Provide owner-scoped task summaries
//   - Keep status formatting consistent
//
// Important:
//   - Does NOT execute tasks
//   - Does NOT modify task state
//   - Does NOT expose secrets
//   - Compatible with PersistentTaskManager.listTasks(options)
// ============================================================

"use strict";

const {
  getPersistentTaskManager,
} = require("./PersistentTaskManager");

// ============================================================
// CONSTANTS
// ============================================================

const VALID_STATUSES = new Set([
  "queued",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);

const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
]);

// ============================================================
// HELPERS
// ============================================================

function safeNumber(
  value,
  fallback = 0
) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return number;
}

function clampProgress(value) {
  const number =
    safeNumber(value, 0);

  return Math.max(
    0,
    Math.min(100, number)
  );
}

function safeString(
  value,
  fallback = ""
) {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  return String(value);
}

// ============================================================
// SERVICE
// ============================================================

class AutonomousTaskStatus {
  constructor(options = {}) {
    this.taskManager =
      options.taskManager ||
      getPersistentTaskManager();
  }

  // ==========================================================
  // GET TASK STATUS
  // ==========================================================

  getTaskStatus(
    taskId,
    ownerId = null
  ) {
    if (!taskId) {
      return null;
    }

    const task =
      this.taskManager.getTask(
        taskId
      );

    if (!task) {
      return null;
    }

    // Owner isolation.
    if (
      ownerId !== null &&
      ownerId !== undefined &&
      String(task.ownerId) !==
        String(ownerId)
    ) {
      return null;
    }

    return this.formatTaskStatus(
      task
    );
  }

  // ==========================================================
  // LIST TASK STATUSES
  // ==========================================================

  listTaskStatuses(
    ownerId = null
  ) {
    if (
      typeof this.taskManager.listTasks !==
      "function"
    ) {
      return [];
    }

    const options = {
      limit: 1000,
    };

    if (
      ownerId !== null &&
      ownerId !== undefined
    ) {
      options.ownerId =
        String(ownerId);
    }

    // PersistentTaskManager expects:
    // listTasks({ ownerId, status, limit })
    const tasks =
      this.taskManager.listTasks(
        options
      ) || [];

    return tasks.map(
      (task) =>
        this.formatTaskStatus(
          task
        )
    );
  }

  // ==========================================================
  // FORMAT TASK
  // ==========================================================

  formatTaskStatus(task) {
    if (!task) {
      return null;
    }

    const currentStep =
      Math.max(
        0,
        Math.floor(
          safeNumber(
            task.currentStep,
            0
          )
        )
      );

    const totalSteps =
      Math.max(
        0,
        Math.floor(
          safeNumber(
            task.totalSteps,
            0
          )
        )
      );

    let progress =
      clampProgress(
        task.progress
      );

    // If explicit progress is missing,
    // derive it from the current step.
    if (
      progress === 0 &&
      totalSteps > 0 &&
      currentStep > 0
    ) {
      progress =
        clampProgress(
          (currentStep /
            totalSteps) *
            100
        );
    }

    // A completed task should always
    // report 100% progress when it has
    // actually reached completion.
    const status =
      this.normalizeStatus(
        task.status
      );

    if (
      status === "completed"
    ) {
      progress = 100;
    }

    return {
      id:
        task.id ||
        task._id ||
        null,

      ownerId:
        task.ownerId ||
        null,

      sessionId:
        task.sessionId ||
        null,

      input:
        safeString(
          task.input
        ),

      action:
        task.action ||
        null,

      target:
        task.target ||
        null,

      status,

      progress,

      currentStep,

      totalSteps,

      stepProgress:
        this._stepProgress(
          currentStep,
          totalSteps
        ),

      retryCount:
        Math.max(
          0,
          Math.floor(
            safeNumber(
              task.retryCount,
              task.attempt || 0
            )
          )
        ),

      maxRetries:
        Math.max(
          0,
          Math.floor(
            safeNumber(
              task.maxRetries,
              0
            )
          )
        ),

      error:
        task.error ||
        null,

      result:
        task.result ||
        null,

      createdAt:
        task.createdAt ||
        null,

      startedAt:
        task.startedAt ||
        null,

      completedAt:
        task.completedAt ||
        null,

      updatedAt:
        task.updatedAt ||
        null,

      isTerminal:
        this.isTerminalStatus(
          status
        ),

      isRunning:
        status === "running",

      isQueued:
        status === "queued",

      isPaused:
        status === "paused",

      isCompleted:
        status === "completed",

      isFailed:
        status === "failed",

      isCancelled:
        status === "cancelled",

      // Paused tasks can be resumed
      // through PersistentTaskManager.
      //
      // Failed tasks are NOT automatically
      // marked resumable here because whether
      // a failed task can be resumed depends
      // on the manager's actual retry/state
      // rules.
      canResume:
        status === "paused",

      canCancel:
        status === "queued" ||
        status === "running" ||
        status === "paused",
    };
  }

  // ==========================================================
  // SUMMARY
  // ==========================================================

  getSummary(
    ownerId = null
  ) {
    const tasks =
      this.listTaskStatuses(
        ownerId
      );

    const summary = {
      total: tasks.length,

      queued: 0,

      running: 0,

      paused: 0,

      completed: 0,

      failed: 0,

      cancelled: 0,

      active: 0,

      terminal: 0,
    };

    for (const task of tasks) {
      const status =
        task.status;

      if (
        Object.prototype.hasOwnProperty.call(
          summary,
          status
        )
      ) {
        summary[status]++;
      }

      if (
        this.isTerminalStatus(
          status
        )
      ) {
        summary.terminal++;
      } else {
        summary.active++;
      }
    }

    return summary;
  }

  // ==========================================================
  // ACTIVE TASKS
  // ==========================================================

  getActiveTasks(
    ownerId = null
  ) {
    return this.listTaskStatuses(
      ownerId
    ).filter(
      (task) =>
        !this.isTerminalStatus(
          task.status
        )
    );
  }

  // ==========================================================
  // RUNNING TASKS
  // ==========================================================

  getRunningTasks(
    ownerId = null
  ) {
    return this.listTaskStatuses(
      ownerId
    ).filter(
      (task) =>
        task.status ===
        "running"
    );
  }

  // ==========================================================
  // QUEUED TASKS
  // ==========================================================

  getQueuedTasks(
    ownerId = null
  ) {
    return this.listTaskStatuses(
      ownerId
    ).filter(
      (task) =>
        task.status ===
        "queued"
    );
  }

  // ==========================================================
  // PAUSED TASKS
  // ==========================================================

  getPausedTasks(
    ownerId = null
  ) {
    return this.listTaskStatuses(
      ownerId
    ).filter(
      (task) =>
        task.status ===
        "paused"
    );
  }

  // ==========================================================
  // TERMINAL TASKS
  // ==========================================================

  getTerminalTasks(
    ownerId = null
  ) {
    return this.listTaskStatuses(
      ownerId
    ).filter(
      (task) =>
        this.isTerminalStatus(
          task.status
        )
    );
  }

  // ==========================================================
  // TERMINAL STATUS
  // ==========================================================

  isTerminalStatus(
    status
  ) {
    return TERMINAL_STATUSES.has(
      this.normalizeStatus(
        status
      )
    );
  }

  // ==========================================================
  // NORMALIZE STATUS
  // ==========================================================

  normalizeStatus(
    status
  ) {
    const normalized =
      safeString(
        status,
        "unknown"
      )
        .trim()
        .toLowerCase();

    if (
      VALID_STATUSES.has(
        normalized
      )
    ) {
      return normalized;
    }

    return "unknown";
  }

  // ==========================================================
  // STEP PROGRESS
  // ==========================================================

  _stepProgress(
    currentStep,
    totalSteps
  ) {
    if (
      totalSteps <= 0
    ) {
      return {
        current:
          currentStep,

        total:
          totalSteps,

        percentage: 0,
      };
    }

    return {
      current:
        currentStep,

      total:
        totalSteps,

      percentage:
        clampProgress(
          (currentStep /
            totalSteps) *
            100
        ),
    };
  }
}

// ============================================================
// SINGLETON
// ============================================================

let instance = null;

function getAutonomousTaskStatus(
  options = {}
) {
  if (!instance) {
    instance =
      new AutonomousTaskStatus(
        options
      );
  }

  return instance;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports =
  AutonomousTaskStatus;

module.exports.AutonomousTaskStatus =
  AutonomousTaskStatus;

module.exports.getAutonomousTaskStatus =
  getAutonomousTaskStatus;