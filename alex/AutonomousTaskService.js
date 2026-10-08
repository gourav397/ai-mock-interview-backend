// ============================================================
// ALEX AUTONOMOUS TASK SERVICE
// Version: 1.1.0
//
// Purpose:
//   - Central service for ALEX long-running tasks
//   - Start autonomous tasks
//   - Read task status
//   - List owner tasks
//   - Pause / resume / cancel tasks
//   - Provide a single safe interface to the executor
//   - Protect internal task secrets from API consumers
// ============================================================

"use strict";

const {
  getPersistentTaskManager,
} = require("./PersistentTaskManager");

const {
  getAutonomousTaskExecutor,
} = require("./AutonomousTaskExecutor");

// ============================================================
// SERVICE
// ============================================================

class AutonomousTaskService {
  constructor(options = {}) {
    this.taskManager =
      options.taskManager ||
      getPersistentTaskManager();

    this.executor =
      options.executor ||
      getAutonomousTaskExecutor({
        taskManager: this.taskManager,
      });
  }

  // ==========================================================
  // START TASK
  // ==========================================================

  async startTask({
    input,
    ownerId = "anonymous",
    sessionId = "default",
    windowsAgentToken = "",
    metadata = {},
    action = "autonomous-task",
    target = "project",
    maxRetries,
    resumeOnRestart = true,
  } = {}) {
    const cleanInput =
      typeof input === "string"
        ? input.trim()
        : "";

    if (!cleanInput) {
      throw new Error(
        "Autonomous task input is required."
      );
    }

    const safeOwnerId =
      ownerId === null ||
      ownerId === undefined
        ? "anonymous"
        : String(ownerId);

    const safeSessionId =
      sessionId === null ||
      sessionId === undefined ||
      String(sessionId).trim() === ""
        ? "default"
        : String(sessionId);

    const safeMetadata =
      metadata &&
      typeof metadata === "object" &&
      !Array.isArray(metadata)
        ? {
            ...metadata,
          }
        : {};

    const task =
      await this.executor.start({
        input: cleanInput,

        ownerId: safeOwnerId,

        sessionId: safeSessionId,

        windowsAgentToken:
          typeof windowsAgentToken === "string"
            ? windowsAgentToken
            : "",

        action:
          typeof action === "string" &&
          action.trim()
            ? action.trim()
            : "autonomous-task",

        target:
          typeof target === "string" &&
          target.trim()
            ? target.trim()
            : "project",

        maxRetries,

        resumeOnRestart:
          resumeOnRestart !== false,

        metadata: safeMetadata,
      });

    return this._publicTask(task);
  }

  // ==========================================================
  // GET ONE TASK
  // ==========================================================

  getTask(
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

    if (
      ownerId !== null &&
      ownerId !== undefined &&
      String(task.ownerId) !==
        String(ownerId)
    ) {
      return null;
    }

    return this._publicTask(task);
  }

  // ==========================================================
  // LIST TASKS
  // ==========================================================

  listTasks(
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
      options.ownerId = String(ownerId);
    }

    const tasks =
      this.taskManager.listTasks(
        options
      ) || [];

    return tasks.map(
      (task) =>
        this._publicTask(task)
    );
  }

  // ==========================================================
  // PAUSE TASK
  // ==========================================================

  async pauseTask(
    taskId,
    ownerId = null
  ) {
    const task =
      this._getOwnedTask(
        taskId,
        ownerId
      );

    if (!task) {
      throw new Error(
        "Autonomous task not found."
      );
    }

    if (
      typeof this.taskManager.pauseTask !==
      "function"
    ) {
      throw new Error(
        "PersistentTaskManager.pauseTask() is unavailable."
      );
    }

    const result =
      await this.taskManager.pauseTask(
        taskId
      );

    return this._publicTask(
      result ||
        this.taskManager.getTask(
          taskId
        )
    );
  }

  // ==========================================================
  // RESUME TASK
  // ==========================================================

  async resumeTask(
    taskId,
    ownerId = null
  ) {
    const task =
      this._getOwnedTask(
        taskId,
        ownerId
      );

    if (!task) {
      throw new Error(
        "Autonomous task not found."
      );
    }

    if (
      typeof this.taskManager.resumeTask !==
      "function"
    ) {
      throw new Error(
        "PersistentTaskManager.resumeTask() is unavailable."
      );
    }

    const result =
      await this.taskManager.resumeTask(
        taskId
      );

    return this._publicTask(
      result ||
        this.taskManager.getTask(
          taskId
        )
    );
  }

  // ==========================================================
  // CANCEL TASK
  // ==========================================================

  async cancelTask(
    taskId,
    ownerId = null
  ) {
    const task =
      this._getOwnedTask(
        taskId,
        ownerId
      );

    if (!task) {
      throw new Error(
        "Autonomous task not found."
      );
    }

    if (
      typeof this.taskManager.cancelTask !==
      "function"
    ) {
      throw new Error(
        "PersistentTaskManager.cancelTask() is unavailable."
      );
    }

    const result =
      await this.taskManager.cancelTask(
        taskId
      );

    return this._publicTask(
      result ||
        this.taskManager.getTask(
          taskId
        )
    );
  }

  // ==========================================================
  // DELETE TASK
  // ==========================================================

  async deleteTask(
    taskId,
    ownerId = null
  ) {
    const task =
      this._getOwnedTask(
        taskId,
        ownerId
      );

    if (!task) {
      throw new Error(
        "Autonomous task not found."
      );
    }

    if (
      typeof this.taskManager.deleteTask !==
      "function"
    ) {
      throw new Error(
        "PersistentTaskManager.deleteTask() is unavailable."
      );
    }

    const result =
      await this.taskManager.deleteTask(
        taskId
      );

    return {
      success:
        result === undefined
          ? true
          : Boolean(result),

      taskId: String(taskId),
    };
  }

  // ==========================================================
  // SUMMARY
  // ==========================================================

  getSummary(
    ownerId = null
  ) {
    const tasks =
      this.listTasks(
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
    };

    for (const task of tasks) {
      const status =
        String(
          task.status || ""
        ).toLowerCase();

      if (
        Object.prototype.hasOwnProperty.call(
          summary,
          status
        )
      ) {
        summary[status]++;
      }
    }

    return summary;
  }

  // ==========================================================
  // INTERNAL OWNER CHECK
  // ==========================================================

  _getOwnedTask(
    taskId,
    ownerId
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

    if (
      ownerId !== null &&
      ownerId !== undefined &&
      String(task.ownerId) !==
        String(ownerId)
    ) {
      return null;
    }

    return task;
  }

  // ==========================================================
  // PUBLIC TASK FORMAT
  //
  // Never expose:
  //   - WindowsAgent token
  //   - agent token
  //   - API keys
  //   - Gemini keys
  //   - internal secrets
  // ==========================================================

  _publicTask(task) {
    if (!task) {
      return null;
    }

    const metadata =
      task.metadata &&
      typeof task.metadata === "object" &&
      !Array.isArray(task.metadata)
        ? {
            ...task.metadata,
          }
        : {};

    // Remove known sensitive values.
    delete metadata.windowsAgentToken;
    delete metadata.agentToken;
    delete metadata.apiKey;
    delete metadata.apiKeys;
    delete metadata.GEMINI_API_KEYS;
    delete metadata.geminiApiKey;
    delete metadata.geminiApiKeys;

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
        task.input ||
        "",

      action:
        task.action ||
        null,

      target:
        task.target ||
        null,

      status:
        task.status ||
        "unknown",

      progress:
        Number.isFinite(
          Number(task.progress)
        )
          ? Number(task.progress)
          : 0,

      currentStep:
        Number.isFinite(
          Number(task.currentStep)
        )
          ? Number(task.currentStep)
          : 0,

      totalSteps:
        Number.isFinite(
          Number(task.totalSteps)
        )
          ? Number(task.totalSteps)
          : 0,

      retryCount:
        Number.isFinite(
          Number(task.retryCount)
        )
          ? Number(task.retryCount)
          : 0,

      maxRetries:
        Number.isFinite(
          Number(task.maxRetries)
        )
          ? Number(task.maxRetries)
          : 0,

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

      metadata,
    };
  }
}

// ============================================================
// SINGLETON
// ============================================================

let instance = null;

function getAutonomousTaskService(
  options = {}
) {
  if (!instance) {
    instance =
      new AutonomousTaskService(
        options
      );
  }

  return instance;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports =
  AutonomousTaskService;

module.exports.AutonomousTaskService =
  AutonomousTaskService;

module.exports.getAutonomousTaskService =
  getAutonomousTaskService;