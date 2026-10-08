// ============================================================
// ALEX AGENT TASK ADAPTER
// Version: 1.0.0
//
// Purpose:
//   Adapter between the new Agent Workflow system and ALEX's
//   existing task infrastructure.
//
//   This file does NOT replace:
//     - AutonomousTaskService
//     - AutonomousTaskExecutor
//     - PersistentTaskManager
//     - TaskExecutionBridge
//
//   It only provides a clean adapter layer so those systems can
//   be connected later without duplicating workflow logic.
//
// ============================================================

"use strict";

const {
  getAgentWorkflowCoordinator,
} = require("./AgentWorkflowCoordinator");

const {
  getAgentWorkflowStore,
} = require("./AgentWorkflowStore");

const {
  getAgentWorkflowRecovery,
} = require("./AgentWorkflowRecovery");

// ============================================================
// CONSTANTS
// ============================================================

const AGENT_TASK_ADAPTER_VERSION =
  "1.0.0";

const TASK_ADAPTER_STATUS = Object.freeze({
  CREATED: "created",
  RUNNING: "running",
  WAITING_CONFIRMATION:
    "waiting_confirmation",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
  RECOVERING: "recovering",
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

  return String(value).trim();
}

function safeObject(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return {};
  }

  return value;
}

function clone(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  try {
    return JSON.parse(
      JSON.stringify(value)
    );
  } catch {
    return value;
  }
}

// ============================================================
// AGENT TASK ADAPTER
// ============================================================

class AgentTaskAdapter {
  constructor(options = {}) {
    this.version =
      AGENT_TASK_ADAPTER_VERSION;

    this.coordinator =
      options.coordinator ||
      getAgentWorkflowCoordinator();

    this.store =
      options.store ||
      getAgentWorkflowStore();

    this.recovery =
      options.recovery ||
      getAgentWorkflowRecovery();

    this.tasks =
      new Map();
  }

  // ==========================================================
  // CREATE TASK
  // ==========================================================

  createTask({
    taskId = null,
    workflowId = null,
    ownerId = null,
    sessionId = null,
    goal = "",
    originalInput = "",
    metadata = {},
    maxSteps = 30,
    contextOptions = {},
    planOptions = {},
  } = {}) {
    const id =
      safeString(
        taskId
      ) ||
      this._createTaskId();

    if (
      this.tasks.has(id)
    ) {
      return this.getTask(id);
    }

    const workflow =
      this.coordinator.create({
        workflowId:
          workflowId ||
          `${id}_workflow`,

        taskId:
          id,

        ownerId:
          ownerId ||
          null,

        sessionId:
          sessionId ||
          null,

        goal:
          safeString(
            goal
          ),

        originalInput:
          safeString(
            originalInput
          ),

        maxSteps,

        metadata:
          safeObject(
            metadata
          ),

        contextOptions,

        planOptions,
      });

    const task = {
      taskId:
        id,

      workflowId:
        workflow.workflowId,

      status:
        TASK_ADAPTER_STATUS.CREATED,

      goal:
        safeString(
          goal
        ),

      originalInput:
        safeString(
          originalInput
        ),

      ownerId:
        ownerId ||
        null,

      sessionId:
        sessionId ||
        null,

      createdAt:
        new Date().toISOString(),

      updatedAt:
        new Date().toISOString(),

      workflow,
    };

    this.tasks.set(
      id,
      task
    );

    this.store.recordEvent(
      workflow.workflowId,
      "task_created",
      {
        taskId:
          id,

        goal:
          safeString(
            goal
          ),
      }
    );

    return this.getTask(id);
  }

  // ==========================================================
  // ADD ACTION
  // ==========================================================

  addAction(
    taskId,
    action
  ) {
    const task =
      this._getTask(
        taskId
      );

    if (!task) {
      throw new Error(
        `Task not found: ${taskId}`
      );
    }

    const result =
      this.coordinator.addAction(
        task.workflowId,
        action
      );

    task.updatedAt =
      new Date().toISOString();

    return result;
  }

  // ==========================================================
  // ADD ACTIONS
  // ==========================================================

  addActions(
    taskId,
    actions
  ) {
    if (
      !Array.isArray(actions)
    ) {
      throw new Error(
        "actions must be an array."
      );
    }

    return actions.map(
      (action) =>
        this.addAction(
          taskId,
          action
        )
    );
  }

  // ==========================================================
  // RUN TASK
  // ==========================================================

  async runTask(
    taskId,
    options = {}
  ) {
    const task =
      this._getTask(
        taskId
      );

    if (!task) {
      throw new Error(
        `Task not found: ${taskId}`
      );
    }

    task.status =
      TASK_ADAPTER_STATUS.RUNNING;

    task.updatedAt =
      new Date().toISOString();

    try {
      const result =
        await this.coordinator.run(
          task.workflowId,
          options
        );

      this._syncTaskStatus(
        task,
        result
      );

      return {
        success:
          result.success ===
          true,

        taskId:
          task.taskId,

        workflowId:
          task.workflowId,

        status:
          task.status,

        result,
      };
    } catch (error) {
      task.status =
        TASK_ADAPTER_STATUS.FAILED;

      task.updatedAt =
        new Date().toISOString();

      this.store.setError(
        task.workflowId,
        error
      );

      return {
        success:
          false,

        taskId:
          task.taskId,

        workflowId:
          task.workflowId,

        status:
          TASK_ADAPTER_STATUS.FAILED,

        error:
          this._normalizeError(
            error
          ),
      };
    }
  }

  // ==========================================================
  // RUN WITH RECOVERY
  // ==========================================================

  async runWithRecovery(
    taskId,
    options = {}
  ) {
    const task =
      this._getTask(
        taskId
      );

    if (!task) {
      throw new Error(
        `Task not found: ${taskId}`
      );
    }

    task.status =
      TASK_ADAPTER_STATUS.RUNNING;

    task.updatedAt =
      new Date().toISOString();

    try {
      const result =
        await this.coordinator.runWithRecovery(
          task.workflowId,
          options
        );

      this._syncTaskStatus(
        task,
        result
      );

      return {
        success:
          result.success ===
          true,

        taskId:
          task.taskId,

        workflowId:
          task.workflowId,

        status:
          task.status,

        recoveryAttempts:
          result.recoveryAttempts ||
          0,

        result,
      };
    } catch (error) {
      task.status =
        TASK_ADAPTER_STATUS.FAILED;

      task.updatedAt =
        new Date().toISOString();

      this.store.setError(
        task.workflowId,
        error
      );

      return {
        success:
          false,

        taskId:
          task.taskId,

        workflowId:
          task.workflowId,

        status:
          TASK_ADAPTER_STATUS.FAILED,

        error:
          this._normalizeError(
            error
          ),
      };
    }
  }

  // ==========================================================
  // RESUME TASK
  // ==========================================================

  async resumeTask(
    taskId,
    options = {}
  ) {
    const task =
      this._getTask(
        taskId
      );

    if (!task) {
      throw new Error(
        `Task not found: ${taskId}`
      );
    }

    task.status =
      TASK_ADAPTER_STATUS.RUNNING;

    task.updatedAt =
      new Date().toISOString();

    try {
      const result =
        await this.coordinator.resume(
          task.workflowId,
          options
        );

      this._syncTaskStatus(
        task,
        result
      );

      return {
        success:
          result.success ===
          true,

        taskId:
          task.taskId,

        workflowId:
          task.workflowId,

        status:
          task.status,

        result,
      };
    } catch (error) {
      task.status =
        TASK_ADAPTER_STATUS.FAILED;

      task.updatedAt =
        new Date().toISOString();

      return {
        success:
          false,

        taskId:
          task.taskId,

        workflowId:
          task.workflowId,

        status:
          TASK_ADAPTER_STATUS.FAILED,

        error:
          this._normalizeError(
            error
          ),
      };
    }
  }

  // ==========================================================
  // CANCEL TASK
  // ==========================================================

  cancelTask(
    taskId,
    reason =
      "Task cancelled."
  ) {
    const task =
      this._getTask(
        taskId
      );

    if (!task) {
      throw new Error(
        `Task not found: ${taskId}`
      );
    }

    const result =
      this.coordinator.cancel(
        task.workflowId,
        reason
      );

    task.status =
      TASK_ADAPTER_STATUS.CANCELLED;

    task.updatedAt =
      new Date().toISOString();

    return {
      ...result,

      taskId:
        task.taskId,

      workflowId:
        task.workflowId,

      status:
        task.status,
    };
  }

  // ==========================================================
  // RECOVER TASK
  // ==========================================================

  recoverTask(
    taskId,
    options = {}
  ) {
    const task =
      this._getTask(
        taskId
      );

    if (!task) {
      throw new Error(
        `Task not found: ${taskId}`
      );
    }

    task.status =
      TASK_ADAPTER_STATUS.RECOVERING;

    task.updatedAt =
      new Date().toISOString();

    const result =
      this.coordinator.recover(
        task.workflowId,
        options
      );

    if (
      result.success
    ) {
      task.status =
        TASK_ADAPTER_STATUS.RUNNING;
    } else {
      task.status =
        TASK_ADAPTER_STATUS.FAILED;
    }

    task.updatedAt =
      new Date().toISOString();

    return {
      ...result,

      taskId:
        task.taskId,

      workflowId:
        task.workflowId,

      status:
        task.status,
    };
  }

  // ==========================================================
  // GET TASK
  // ==========================================================

  getTask(
    taskId
  ) {
    const task =
      this._getTask(
        taskId
      );

    if (!task) {
      return null;
    }

    return {
      ...clone(task),

      workflow:
        this.coordinator.snapshot(
          task.workflowId
        ),
    };
  }

  // ==========================================================
  // GET STATUS
  // ==========================================================

  getStatus(
    taskId
  ) {
    const task =
      this._getTask(
        taskId
      );

    if (!task) {
      return null;
    }

    return {
      taskId:
        task.taskId,

      workflowId:
        task.workflowId,

      status:
        task.status,

      workflow:
        this.coordinator.status(
          task.workflowId
        ),
    };
  }

  // ==========================================================
  // LIST TASKS
  // ==========================================================

  listTasks(
    options = {}
  ) {
    let tasks =
      Array.from(
        this.tasks.values()
      );

    if (
      options.status
    ) {
      const status =
        safeString(
          options.status
        );

      tasks =
        tasks.filter(
          (task) =>
            task.status ===
            status
        );
    }

    if (
      options.ownerId
    ) {
      const ownerId =
        safeString(
          options.ownerId
        );

      tasks =
        tasks.filter(
          (task) =>
            task.ownerId ===
            ownerId
        );
    }

    if (
      options.sessionId
    ) {
      const sessionId =
        safeString(
          options.sessionId
        );

      tasks =
        tasks.filter(
          (task) =>
            task.sessionId ===
            sessionId
        );
    }

    tasks.sort(
      (
        a,
        b
      ) =>
        String(
          b.updatedAt
        ).localeCompare(
          String(
            a.updatedAt
          )
        )
    );

    const limit =
      Number.isInteger(
        options.limit
      ) &&
      options.limit > 0
        ? options.limit
        : tasks.length;

    return clone(
      tasks.slice(
        0,
        limit
      )
    );
  }

  // ==========================================================
  // SNAPSHOT
  // ==========================================================

  snapshot(
    taskId
  ) {
    const task =
      this._getTask(
        taskId
      );

    if (!task) {
      return null;
    }

    return {
      taskId:
        task.taskId,

      workflowId:
        task.workflowId,

      status:
        task.status,

      goal:
        task.goal,

      originalInput:
        task.originalInput,

      ownerId:
        task.ownerId,

      sessionId:
        task.sessionId,

      createdAt:
        task.createdAt,

      updatedAt:
        task.updatedAt,

      workflow:
        this.coordinator.snapshot(
          task.workflowId
        ),

      recovery:
        this.recovery.getRecord(
          task.workflowId
        ),
    };
  }

  // ==========================================================
  // REMOVE TASK
  // ==========================================================

  removeTask(
    taskId,
    options = {}
  ) {
    const id =
      safeString(
        taskId
      );

    if (!id) {
      return false;
    }

    const task =
      this._getTask(id);

    if (!task) {
      return false;
    }

    if (
      options.removeWorkflow !==
      false
    ) {
      this.coordinator.remove(
        task.workflowId
      );
    }

    return this.tasks.delete(
      id
    );
  }

  // ==========================================================
  // STATS
  // ==========================================================

  getStats() {
    const counts = {};

    for (
      const status
      of Object.values(
        TASK_ADAPTER_STATUS
      )
    ) {
      counts[status] =
        0;
    }

    for (
      const task
      of this.tasks.values()
    ) {
      if (
        counts[
          task.status
        ] === undefined
      ) {
        counts[
          task.status
        ] = 0;
      }

      counts[
        task.status
      ]++;
    }

    return {
      version:
        this.version,

      total:
        this.tasks.size,

      counts,

      workflowStore:
        this.store.getStats(),

      recovery:
        this.recovery.getStats(),
    };
  }

  // ==========================================================
  // PRIVATE: GET TASK
  // ==========================================================

  _getTask(
    taskId
  ) {
    const id =
      safeString(
        taskId
      );

    if (!id) {
      return null;
    }

    return (
      this.tasks.get(
        id
      ) || null
    );
  }

  // ==========================================================
  // PRIVATE: SYNC STATUS
  // ==========================================================

  _syncTaskStatus(
    task,
    result
  ) {
    if (
      !task ||
      !result
    ) {
      return;
    }

    if (
      result.paused ||
      result.status ===
        "waiting_confirmation"
    ) {
      task.status =
        TASK_ADAPTER_STATUS.WAITING_CONFIRMATION;
    } else if (
      result.success &&
      result.completed
    ) {
      task.status =
        TASK_ADAPTER_STATUS.COMPLETED;
    } else if (
      result.status ===
        "cancelled"
    ) {
      task.status =
        TASK_ADAPTER_STATUS.CANCELLED;
    } else if (
      result.success ===
        false
    ) {
      task.status =
        TASK_ADAPTER_STATUS.FAILED;
    } else {
      task.status =
        TASK_ADAPTER_STATUS.RUNNING;
    }

    task.updatedAt =
      new Date().toISOString();
  }

  // ==========================================================
  // PRIVATE: TASK ID
  // ==========================================================

  _createTaskId() {
    return [
      "agent_task",
      Date.now(),
      Math.random()
        .toString(36)
        .slice(2, 10),
    ].join("_");
  }

  // ==========================================================
  // PRIVATE: ERROR
  // ==========================================================

  _normalizeError(
    error
  ) {
    if (
      error === null ||
      error === undefined
    ) {
      return null;
    }

    if (
      error instanceof Error
    ) {
      return {
        name:
          error.name ||
          "Error",

        message:
          error.message ||
          String(error),

        code:
          error.code ||
          null,
      };
    }

    if (
      typeof error ===
      "object"
    ) {
      return {
        name:
          safeString(
            error.name,
            "Error"
          ),

        message:
          safeString(
            error.message,
            "Unknown error"
          ),

        code:
          safeString(
            error.code
          ) ||
          null,
      };
    }

    return {
      name:
        "Error",

      message:
        String(error),

      code:
        null,
    };
  }
}

// ============================================================
// SINGLETON
// ============================================================

let instance =
  null;

function getAgentTaskAdapter(
  options = {}
) {
  if (!instance) {
    instance =
      new AgentTaskAdapter(
        options
      );
  }

  return instance;
}

// ============================================================
// RESET
// ============================================================

function resetAgentTaskAdapter() {
  instance =
    null;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  AGENT_TASK_ADAPTER_VERSION,

  TASK_ADAPTER_STATUS,

  AgentTaskAdapter,

  getAgentTaskAdapter,

  resetAgentTaskAdapter,
};