// ============================================================
// ALEX — Autonomous Task API
// FILE: backend/alex/AutonomousTaskAPI.js
// ============================================================

"use strict";

const {
  getAutonomousTaskService,
} = require("./AutonomousTaskService");

const {
  getAutonomousTaskStatus,
} = (() => {
  try {
    return require("./AutonomousTaskStatus");
  } catch {
    return {
      getAutonomousTaskStatus: null,
    };
  }
})();

class AutonomousTaskAPI {
  constructor(options = {}) {
    this.service =
      options.service ||
      getAutonomousTaskService();

    this.statusService =
      options.statusService ||
      (typeof getAutonomousTaskStatus === "function"
        ? getAutonomousTaskStatus()
        : null);
  }

  // ------------------------------------------------------------
  // START
  // ------------------------------------------------------------

  async startTask(input = {}) {
    const {
      input: taskInput,
      ownerId = "anonymous",
      sessionId = "default",
      windowsAgentToken = "",
      metadata = {},
      action = "autonomous-task",
      target = "project",
      maxRetries,
      resumeOnRestart = true,
    } = input;

    if (
      typeof taskInput !== "string" ||
      !taskInput.trim()
    ) {
      throw new Error("Task input is required");
    }

    return this.service.startTask({
      input: taskInput.trim(),
      ownerId,
      sessionId,
      windowsAgentToken,
      metadata,
      action,
      target,
      maxRetries,
      resumeOnRestart,
    });
  }

  // ------------------------------------------------------------
  // GET ONE TASK
  // ------------------------------------------------------------

  async getTask(taskId, ownerId = null) {
    this._requireTaskId(taskId);

    return this.service.getTask(
      taskId,
      ownerId
    );
  }

  // ------------------------------------------------------------
  // LIST TASKS
  // ------------------------------------------------------------

  async listTasks(ownerId = null) {
    return this.service.listTasks(ownerId);
  }

  // ------------------------------------------------------------
  // PAUSE
  // ------------------------------------------------------------

  async pauseTask(taskId, ownerId = null) {
    this._requireTaskId(taskId);

    return this.service.pauseTask(
      taskId,
      ownerId
    );
  }

  // ------------------------------------------------------------
  // RESUME
  // ------------------------------------------------------------

  async resumeTask(taskId, ownerId = null) {
    this._requireTaskId(taskId);

    return this.service.resumeTask(
      taskId,
      ownerId
    );
  }

  // ------------------------------------------------------------
  // CANCEL
  // ------------------------------------------------------------

  async cancelTask(taskId, ownerId = null) {
    this._requireTaskId(taskId);

    return this.service.cancelTask(
      taskId,
      ownerId
    );
  }

  // ------------------------------------------------------------
  // SUMMARY
  // ------------------------------------------------------------

  async getSummary(ownerId = null) {
    return this.service.getSummary(ownerId);
  }

  // ------------------------------------------------------------
  // STATUS
  // ------------------------------------------------------------

  async getStatus(taskId, ownerId = null) {
    this._requireTaskId(taskId);

    if (
      this.statusService &&
      typeof this.statusService.getTaskStatus === "function"
    ) {
      return this.statusService.getTaskStatus(
        taskId,
        ownerId
      );
    }

    return this.service.getTask(
      taskId,
      ownerId
    );
  }

  // ------------------------------------------------------------
  // ACTIVE TASKS
  // ------------------------------------------------------------

  async getActiveTasks(ownerId = null) {
    if (
      this.statusService &&
      typeof this.statusService.getActiveTasks === "function"
    ) {
      return this.statusService.getActiveTasks(
        ownerId
      );
    }

    const tasks =
      await this.service.listTasks(ownerId);

    return tasks.filter((task) => {
      return [
        "queued",
        "running",
        "paused",
      ].includes(task.status);
    });
  }

  // ------------------------------------------------------------
  // RUNNING TASKS
  // ------------------------------------------------------------

  async getRunningTasks(ownerId = null) {
    if (
      this.statusService &&
      typeof this.statusService.getRunningTasks === "function"
    ) {
      return this.statusService.getRunningTasks(
        ownerId
      );
    }

    const tasks =
      await this.service.listTasks(ownerId);

    return tasks.filter(
      (task) => task.status === "running"
    );
  }

  // ------------------------------------------------------------
  // TASK RESULT
  // ------------------------------------------------------------

  async getResult(taskId, ownerId = null) {
    this._requireTaskId(taskId);

    const task =
      await this.service.getTask(
        taskId,
        ownerId
      );

    if (!task) {
      return null;
    }

    return {
      taskId: task.id,
      status: task.status,
      result: task.result ?? null,
      error: task.error ?? null,
      completedAt: task.completedAt ?? null,
    };
  }

  // ------------------------------------------------------------
  // TASK PROGRESS
  // ------------------------------------------------------------

  async getProgress(taskId, ownerId = null) {
    this._requireTaskId(taskId);

    const task =
      await this.service.getTask(
        taskId,
        ownerId
      );

    if (!task) {
      return null;
    }

    return {
      taskId: task.id,
      status: task.status,
      progress: task.progress ?? 0,
      currentStep: task.currentStep ?? 0,
      totalSteps: task.totalSteps ?? 0,
      retryCount: task.retryCount ?? 0,
      maxRetries: task.maxRetries ?? 0,
      updatedAt: task.updatedAt ?? null,
    };
  }

  // ------------------------------------------------------------
  // DASHBOARD DATA
  // ------------------------------------------------------------

  async getDashboard(ownerId = null) {
    const [
      summary,
      tasks,
    ] = await Promise.all([
      this.service.getSummary(ownerId),
      this.service.listTasks(ownerId),
    ]);

    return {
      summary,
      tasks,
      generatedAt: new Date().toISOString(),
    };
  }

  // ------------------------------------------------------------
  // OWNERSHIP
  // ------------------------------------------------------------

  async isOwnerTask(taskId, ownerId) {
    this._requireTaskId(taskId);

    if (
      ownerId === null ||
      ownerId === undefined
    ) {
      return false;
    }

    const task =
      await this.service.getTask(
        taskId,
        ownerId
      );

    return Boolean(task);
  }

  // ------------------------------------------------------------
  // ERROR NORMALIZATION
  // ------------------------------------------------------------

  normalizeError(error) {
    if (!error) {
      return {
        message: "Unknown error",
      };
    }

    if (typeof error === "string") {
      return {
        message: error,
      };
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
        name: error.name || "Error",
        message:
          error.message ||
          error.error ||
          "Unknown error",
        code: error.code || null,
      };
    }

    return {
      message: String(error),
    };
  }

  // ------------------------------------------------------------
  // VALIDATION
  // ------------------------------------------------------------

  _requireTaskId(taskId) {
    if (
      taskId === null ||
      taskId === undefined ||
      String(taskId).trim() === ""
    ) {
      throw new Error("Task ID is required");
    }
  }
}

// ============================================================
// SINGLETON
// ============================================================

let apiInstance = null;

function getAutonomousTaskAPI(options = {}) {
  if (!apiInstance) {
    apiInstance = new AutonomousTaskAPI(
      options
    );
  }

  return apiInstance;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  AutonomousTaskAPI,
  getAutonomousTaskAPI,
};