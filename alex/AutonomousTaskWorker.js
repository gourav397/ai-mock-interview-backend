// ============================================================
// ALEX AUTONOMOUS TASK WORKER
// Version: 2.0.0
//
// Purpose:
//   - Provide a safe worker/orchestration interface
//   - Start persistent autonomous tasks
//   - Resume queued/paused tasks
//   - Prevent duplicate starts
//   - Monitor active task IDs
//
// IMPORTANT ARCHITECTURE:
//
//   AutonomousTaskWorker
//          |
//          v
//   PersistentTaskManager
//          |
//          v
//   Registered "alex-autonomous" executor
//          |
//          v
//   AutonomousTaskExecutor
//          |
//          v
//   TaskExecutionBridge
//
// The PersistentTaskManager owns the actual background
// execution loop. This class MUST NOT create another loop.
// ============================================================

"use strict";

const {
  getPersistentTaskManager,
} = require("./PersistentTaskManager");

const {
  getAutonomousTaskExecutor,
} = require("./AutonomousTaskExecutor");

const { getEventBus, EVENTS } = require("./EventBus");

// ============================================================
// CONSTANTS
// ============================================================

const EXECUTOR_TYPE =
  "alex-autonomous";

// ============================================================
// ACTIVE TASK TRACKING
// ============================================================

const activeTasks =
  new Set();
  const eventBus = getEventBus();
eventBus.onAny((e) => {
  if (["action_failed", "verification_failed", "task_replanned", "task_recovered"].includes(e.type)) {
    console.log(`📡 [${e.type}]`, e.payload?.goal || e.payload?.action || "", e.meta.taskId ? `(task ${e.meta.taskId})` : "");
  }
});

// ============================================================
// HELPERS
// ============================================================

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

function isTerminalStatus(
  status
) {
  const normalized =
    safeString(
      status
    )
      .trim()
      .toLowerCase();

  return (
    normalized ===
      "completed" ||
    normalized ===
      "failed" ||
    normalized ===
      "cancelled"
  );
}

// ============================================================
// WORKER
// ============================================================

class AutonomousTaskWorker {
  constructor(options = {}) {
    this.taskManager =
      options.taskManager ||
      getPersistentTaskManager();

    // Creating/getting the executor here is important because
    // its constructor registers the "alex-autonomous" executor
    // with PersistentTaskManager.
    this.executor =
      options.executor ||
      getAutonomousTaskExecutor({
        taskManager:
          this.taskManager,
      });

    this.executorType =
      options.executorType ||
      EXECUTOR_TYPE;
  }

  // ==========================================================
  // START EXISTING TASK
  // ==========================================================

  async start(taskId) {
    if (!taskId) {
      throw new Error(
        "Task ID is required."
      );
    }

    const normalizedTaskId =
      String(taskId);

    // Prevent duplicate worker starts.
    if (
      activeTasks.has(
        normalizedTaskId
      )
    ) {
      return {
        taskId:
          normalizedTaskId,

        started: false,

        alreadyRunning: true,
      };
    }

    const task =
      this._getTask(
        normalizedTaskId
      );

    if (!task) {
      throw new Error(
        "Autonomous task not found."
      );
    }

    // Never restart terminal tasks.
    if (
      isTerminalStatus(
        task.status
      )
    ) {
      return {
        taskId:
          normalizedTaskId,

        started: false,

        terminal: true,

        status:
          task.status,
      };
    }

    // If the manager already has the task running,
    // do not start a second execution loop.
    if (
      task.status ===
      "running"
    ) {
      activeTasks.add(
        normalizedTaskId
      );

      return {
        taskId:
          normalizedTaskId,

        started: false,

        alreadyRunning: true,

        status: "running",
      };
    }

    // Make sure the executor is registered.
    this._ensureExecutorReady();

    activeTasks.add(
      normalizedTaskId
    );

    try {
      const result =
        await this.taskManager.startTask(
          normalizedTaskId,
          {
            executorType:
              this.executorType,
          }
        );

      const latestTask =
        this._getTask(
          normalizedTaskId
        );

      // The PersistentTaskManager owns the
      // actual background loop. We only start it.
      return {
        taskId:
          normalizedTaskId,

        started: true,

        status:
          latestTask?.status ||
          result?.status ||
          "running",

        task:
          latestTask || null,
      };
    } catch (error) {
      activeTasks.delete(
        normalizedTaskId
      );

      throw error;
    }
  }

  // ==========================================================
  // RESUME EXISTING TASK
  // ==========================================================

  async resume(taskId) {
    if (!taskId) {
      throw new Error(
        "Task ID is required."
      );
    }

    const normalizedTaskId =
      String(taskId);

    const task =
      this._getTask(
        normalizedTaskId
      );

    if (!task) {
      throw new Error(
        "Autonomous task not found."
      );
    }

    if (
      isTerminalStatus(
        task.status
      )
    ) {
      return {
        taskId:
          normalizedTaskId,

        resumed: false,

        terminal: true,

        status:
          task.status,
      };
    }

    if (
      task.status ===
      "running"
    ) {
      activeTasks.add(
        normalizedTaskId
      );

      return {
        taskId:
          normalizedTaskId,

        resumed: false,

        alreadyRunning: true,

        status: "running",
      };
    }

    this._ensureExecutorReady();

    activeTasks.add(
      normalizedTaskId
    );

    try {
      const result =
        await this.taskManager.resumeTask(
          normalizedTaskId
        );

      const latestTask =
        this._getTask(
          normalizedTaskId
        );

      return {
        taskId:
          normalizedTaskId,

        resumed: true,

        status:
          latestTask?.status ||
          result?.status ||
          "running",

        task:
          latestTask || null,
      };
    } catch (error) {
      activeTasks.delete(
        normalizedTaskId
      );

      throw error;
    }
  }

  // ==========================================================
  // START QUEUED TASKS
  //
  // Useful after application restart.
  // ==========================================================

  async startQueuedTasks(
    options = {}
  ) {
    const limit =
      Math.max(
        1,
        Math.min(
          1000,
          Number(
            options.limit
          ) || 100
        )
      );

    const ownerId =
      options.ownerId !==
        undefined &&
      options.ownerId !==
        null
        ? String(
            options.ownerId
          )
        : null;

    const tasks =
      this.taskManager.listTasks({
        ownerId,
        status: "queued",
        limit,
      }) || [];

    const results = [];

    for (
      const task of tasks
    ) {
      if (!task?.id) {
        continue;
      }

      try {
        const result =
          await this.start(
            task.id
          );

        results.push(
          result
        );
      } catch (error) {
        results.push({
          taskId:
            task.id,

          started: false,

          error:
            safeString(
              error?.message,
              "Failed to start task."
            ),
        });
      }
    }

    return results;
  }

  // ==========================================================
  // START RESUMABLE TASKS
  //
  // Queued tasks are normally produced after restart.
  // Paused tasks remain paused unless explicitly resumed.
  // ==========================================================

  async recoverQueuedTasks(
    options = {}
  ) {
    return this.startQueuedTasks(
      options
    );
  }

  // ==========================================================
  // GET TASK
  // ==========================================================

  getTask(taskId) {
    if (!taskId) {
      return null;
    }

    return this._getTask(
      String(taskId)
    );
  }

  // ==========================================================
  // IS RUNNING
  // ==========================================================

  isRunning(taskId) {
    if (!taskId) {
      return false;
    }

    const normalizedTaskId =
      String(taskId);

    if (
      activeTasks.has(
        normalizedTaskId
      )
    ) {
      return true;
    }

    const task =
      this._getTask(
        normalizedTaskId
      );

    return (
      task?.status ===
      "running"
    );
  }

  // ==========================================================
  // GET ACTIVE TASK IDS
  // ==========================================================

  getActiveTaskIds() {
    const ids =
      new Set(
        activeTasks
      );

    // Synchronize with persistent state.
    if (
      this.taskManager &&
      typeof this.taskManager.listTasks ===
        "function"
    ) {
      const runningTasks =
        this.taskManager.listTasks({
          status: "running",
          limit: 1000,
        }) || [];

      for (
        const task of runningTasks
      ) {
        if (task?.id) {
          ids.add(
            String(task.id)
          );
        }
      }
    }

    return Array.from(
      ids
    );
  }

  // ==========================================================
  // GET ACTIVE TASKS
  // ==========================================================

  getActiveTasks(
    options = {}
  ) {
    const ownerId =
      options.ownerId !==
        undefined &&
      options.ownerId !==
        null
        ? String(
            options.ownerId
          )
        : null;

    const tasks =
      this.taskManager.listTasks({
        ownerId,
        status: "running",
        limit:
          Math.max(
            1,
            Math.min(
              1000,
              Number(
                options.limit
              ) || 100
            )
          ),
      }) || [];

    return tasks;
  }

  // ==========================================================
  // STOP TRACKING
  //
  // This does NOT cancel the persistent task.
  // It only removes local worker tracking.
  // ==========================================================

  stopTracking(taskId) {
    if (!taskId) {
      return false;
    }

    return activeTasks.delete(
      String(taskId)
    );
  }

  // ==========================================================
  // CANCEL
  //
  // Actual cancellation belongs to
  // PersistentTaskManager.
  // ==========================================================

  async cancel(taskId) {
    if (!taskId) {
      throw new Error(
        "Task ID is required."
      );
    }

    const normalizedTaskId =
      String(taskId);

    if (
      typeof this.taskManager.cancelTask !==
      "function"
    ) {
      throw new Error(
        "PersistentTaskManager.cancelTask() is unavailable."
      );
    }

    try {
      const result =
        await this.taskManager.cancelTask(
          normalizedTaskId
        );

      activeTasks.delete(
        normalizedTaskId
      );

      const latestTask =
        this._getTask(
          normalizedTaskId
        );

      return (
        result ||
        latestTask ||
        {
          taskId:
            normalizedTaskId,

          status:
            "cancelled",
        }
      );
    } catch (error) {
      throw error;
    }
  }

  // ==========================================================
  // PAUSE
  // ==========================================================

  async pause(taskId) {
    if (!taskId) {
      throw new Error(
        "Task ID is required."
      );
    }

    const normalizedTaskId =
      String(taskId);

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
        normalizedTaskId
      );

    activeTasks.delete(
      normalizedTaskId
    );

    return (
      result ||
      this._getTask(
        normalizedTaskId
      )
    );
  }

  // ==========================================================
  // INTERNAL TASK LOOKUP
  // ==========================================================

  _getTask(taskId) {
    if (
      !this.taskManager ||
      typeof this.taskManager.getTask !==
        "function"
    ) {
      throw new Error(
        "PersistentTaskManager.getTask() is unavailable."
      );
    }

    return this.taskManager.getTask(
      taskId
    );
  }

  // ==========================================================
  // ENSURE EXECUTOR
  // ==========================================================

  _ensureExecutorReady() {
    if (!this.executor) {
      throw new Error(
        "AutonomousTaskExecutor is unavailable."
      );
    }

    if (
      typeof this.taskManager.registerExecutor !==
      "function"
    ) {
      throw new Error(
        "PersistentTaskManager.registerExecutor() is unavailable."
      );
    }

    return true;
  }
}

// ============================================================
// SINGLETON
// ============================================================

let instance = null;

function getAutonomousTaskWorker(
  options = {}
) {
  if (!instance) {
    instance =
      new AutonomousTaskWorker(
        options
      );
  }

  return instance;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports =
  AutonomousTaskWorker;

module.exports.AutonomousTaskWorker =
  AutonomousTaskWorker;

module.exports.getAutonomousTaskWorker =
  getAutonomousTaskWorker;