// ============================================================
// ALEX — Agent Session Bridge
// Version: 1.0.0
//
// Purpose:
//   Connect ALEX session lifecycle with:
//     - AgentSessionCoordinator
//     - AgentTaskAdapter
//     - AgentWorkflowCoordinator
//     - AgentExecutionContext
//
// This file does NOT execute tools directly.
// ============================================================

"use strict";

const {
  getAgentSessionCoordinator,
} = require("./AgentSessionCoordinator");

const {
  getAgentTaskAdapter,
} = require("./AgentTaskAdapter");

const SESSION_BRIDGE_VERSION = "1.0.0";

const BRIDGE_STATUS = Object.freeze({
  READY: "ready",
  ACTIVE: "active",
  WAITING_CONFIRMATION: "waiting_confirmation",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

function safeString(value, fallback = "") {
  if (value === null || value === undefined) {
    return fallback;
  }

  return String(value);
}

function clone(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value));
}

class AgentSessionBridge {
  constructor(options = {}) {
    this.version = SESSION_BRIDGE_VERSION;

    this.sessionCoordinator =
      options.sessionCoordinator ||
      getAgentSessionCoordinator();

    this.taskAdapter =
      options.taskAdapter ||
      getAgentTaskAdapter();

    this.links = new Map();
  }

  // ==========================================================
  // CREATE SESSION + TASK
  // ==========================================================

  create(options = {}) {
    const session =
      this.sessionCoordinator.createSession({
        sessionId:
          options.sessionId,

        contextId:
          options.contextId,

        ownerId:
          options.ownerId,

        userId:
          options.userId,

        goal:
          options.goal || "",

        originalInput:
          options.originalInput || "",

        capabilities:
          options.capabilities || [],

        metadata:
          options.metadata || {},

        contextMetadata:
          options.contextMetadata || {},

        maxSteps:
          options.maxSteps,
      });

    let task = null;

    if (options.createTask !== false) {
      task =
        this.taskAdapter.createTask({
          taskId:
            options.taskId,

          ownerId:
            options.ownerId,

          userId:
            options.userId,

          goal:
            options.goal || "",

          originalInput:
            options.originalInput || "",

          sessionId:
            session.sessionId,

          metadata: {
            ...(options.taskMetadata || {}),
            sessionId:
              session.sessionId,
          },
        });
    }

    this.links.set(
      session.sessionId,
      {
        sessionId:
          session.sessionId,

        taskId:
          task?.taskId ||
          options.taskId ||
          null,

        createdAt:
          Date.now(),
      }
    );

    this.sessionCoordinator.recordEvent(
      session.sessionId,
      "session_task_linked",
      {
        taskId:
          task?.taskId ||
          options.taskId ||
          null,
      }
    );

    return {
      success: true,

      session,

      task,

      sessionId:
        session.sessionId,

      taskId:
        task?.taskId ||
        options.taskId ||
        null,

      status:
        BRIDGE_STATUS.READY,
    };
  }

  // ==========================================================
  // GET LINK
  // ==========================================================

  getLink(sessionId) {
    const id =
      safeString(sessionId).trim();

    const link =
      this.links.get(id);

    return link
      ? clone(link)
      : null;
  }

  // ==========================================================
  // GET SESSION
  // ==========================================================

  getSession(sessionId) {
    return this.sessionCoordinator.getSession(
      sessionId
    );
  }

  // ==========================================================
  // GET TASK
  // ==========================================================

  getTask(sessionId) {
    const link =
      this.getLink(sessionId);

    if (!link?.taskId) {
      return null;
    }

    return this.taskAdapter.getTask(
      link.taskId
    );
  }

  // ==========================================================
  // START SESSION
  // ==========================================================

  start(sessionId) {
    const id =
      safeString(sessionId).trim();

    const session =
      this.sessionCoordinator.startSession(
        id
      );

    const link =
      this.links.get(id);

    let task = null;

    if (link?.taskId) {
      task =
        this.taskAdapter.getTask(
          link.taskId
        );
    }

    return {
      success: true,

      session,

      task,

      sessionId: id,

      taskId:
        link?.taskId || null,

      status:
        BRIDGE_STATUS.ACTIVE,
    };
  }

  // ==========================================================
  // ADD ACTION
  // ==========================================================

  addAction(
    sessionId,
    action
  ) {
    const link =
      this._requireLink(sessionId);

    if (!link.taskId) {
      throw new Error(
        "Session is not linked to a task"
      );
    }

    const result =
      this.taskAdapter.addAction(
        link.taskId,
        action
      );

    this.sessionCoordinator.recordEvent(
      link.sessionId,
      "task_action_added",
      {
        taskId:
          link.taskId,

        actionId:
          action?.actionId ||
          null,

        tool:
          action?.tool ||
          null,
      }
    );

    return result;
  }

  // ==========================================================
  // ADD ACTIONS
  // ==========================================================

  addActions(
    sessionId,
    actions
  ) {
    const link =
      this._requireLink(sessionId);

    if (!link.taskId) {
      throw new Error(
        "Session is not linked to a task"
      );
    }

    if (!Array.isArray(actions)) {
      throw new Error(
        "actions must be an array"
      );
    }

    const result =
      this.taskAdapter.addActions(
        link.taskId,
        actions
      );

    this.sessionCoordinator.recordEvent(
      link.sessionId,
      "task_actions_added",
      {
        taskId:
          link.taskId,

        count:
          actions.length,
      }
    );

    return result;
  }

  // ==========================================================
  // RUN
  // ==========================================================

  async run(
    sessionId,
    options = {}
  ) {
    const link =
      this._requireLink(sessionId);

    const id =
      link.sessionId;

    this.sessionCoordinator.startSession(
      id
    );

    this.sessionCoordinator.recordEvent(
      id,
      "session_execution_started",
      {
        taskId:
          link.taskId,
      }
    );

    if (!link.taskId) {
      throw new Error(
        "Session is not linked to a task"
      );
    }

    try {
      const result =
        await this.taskAdapter.runTask(
          link.taskId,
          options
        );

      const status =
        this._extractTaskStatus(
          result
        );

      if (
        status ===
        BRIDGE_STATUS.WAITING_CONFIRMATION
      ) {
        this.sessionCoordinator.waitForConfirmation(
          id,
          {
            taskId:
              link.taskId,

            result:
              clone(result),
          }
        );
      } else if (
        status ===
        BRIDGE_STATUS.FAILED
      ) {
        this.sessionCoordinator.failSession(
          id,
          result?.error ||
            "Task execution failed"
        );
      } else if (
        status ===
        BRIDGE_STATUS.CANCELLED
      ) {
        this.sessionCoordinator.cancelSession(
          id,
          result?.reason ||
            "Task cancelled"
        );
      } else if (
        status ===
        BRIDGE_STATUS.COMPLETED
      ) {
        this.sessionCoordinator.completeSession(
          id,
          result
        );
      }

      return {
        success:
          result?.success !== false,

        sessionId:
          id,

        taskId:
          link.taskId,

        status,

        session:
          this.sessionCoordinator.getSession(
            id
          ),

        task:
          result,
      };
    } catch (error) {
      this.sessionCoordinator.failSession(
        id,
        error
      );

      return {
        success: false,

        sessionId:
          id,

        taskId:
          link.taskId,

        status:
          BRIDGE_STATUS.FAILED,

        error:
          error?.message ||
          String(error),

        session:
          this.sessionCoordinator.getSession(
            id
          ),
      };
    }
  }

  // ==========================================================
  // RUN WITH RECOVERY
  // ==========================================================

  async runWithRecovery(
    sessionId,
    options = {}
  ) {
    const link =
      this._requireLink(sessionId);

    const id =
      link.sessionId;

    if (!link.taskId) {
      throw new Error(
        "Session is not linked to a task"
      );
    }

    this.sessionCoordinator.startSession(
      id
    );

    this.sessionCoordinator.recordEvent(
      id,
      "session_recovery_execution_started",
      {
        taskId:
          link.taskId,
      }
    );

    try {
      const result =
        await this.taskAdapter.runWithRecovery(
          link.taskId,
          options
        );

      const status =
        this._extractTaskStatus(
          result
        );

      if (
        status ===
        BRIDGE_STATUS.WAITING_CONFIRMATION
      ) {
        this.sessionCoordinator.waitForConfirmation(
          id,
          {
            taskId:
              link.taskId,

            result:
              clone(result),
          }
        );
      } else if (
        status ===
        BRIDGE_STATUS.FAILED
      ) {
        this.sessionCoordinator.failSession(
          id,
          result?.error ||
            "Recovered task execution failed"
        );
      } else if (
        status ===
        BRIDGE_STATUS.COMPLETED
      ) {
        this.sessionCoordinator.completeSession(
          id,
          result
        );
      }

      return {
        success:
          result?.success !== false,

        sessionId:
          id,

        taskId:
          link.taskId,

        status,

        session:
          this.sessionCoordinator.getSession(
            id
          ),

        task:
          result,
      };
    } catch (error) {
      this.sessionCoordinator.failSession(
        id,
        error
      );

      return {
        success: false,

        sessionId:
          id,

        taskId:
          link.taskId,

        status:
          BRIDGE_STATUS.FAILED,

        error:
          error?.message ||
          String(error),

        session:
          this.sessionCoordinator.getSession(
            id
          ),
      };
    }
  }

  // ==========================================================
  // RESUME
  // ==========================================================

  async resume(
    sessionId,
    options = {}
  ) {
    const link =
      this._requireLink(sessionId);

    const id =
      link.sessionId;

    if (!link.taskId) {
      throw new Error(
        "Session is not linked to a task"
      );
    }

    this.sessionCoordinator.resumeSession(
      id
    );

    try {
      const result =
        await this.taskAdapter.resumeTask(
          link.taskId,
          options
        );

      const status =
        this._extractTaskStatus(
          result
        );

      if (
        status ===
        BRIDGE_STATUS.WAITING_CONFIRMATION
      ) {
        this.sessionCoordinator.waitForConfirmation(
          id,
          {
            taskId:
              link.taskId,

            result:
              clone(result),
          }
        );
      } else if (
        status ===
        BRIDGE_STATUS.COMPLETED
      ) {
        this.sessionCoordinator.completeSession(
          id,
          result
        );
      } else if (
        status ===
        BRIDGE_STATUS.FAILED
      ) {
        this.sessionCoordinator.failSession(
          id,
          result?.error ||
            "Task resume failed"
        );
      }

      return {
        success:
          result?.success !== false,

        sessionId:
          id,

        taskId:
          link.taskId,

        status,

        session:
          this.sessionCoordinator.getSession(
            id
          ),

        task:
          result,
      };
    } catch (error) {
      this.sessionCoordinator.failSession(
        id,
        error
      );

      return {
        success: false,

        sessionId:
          id,

        taskId:
          link.taskId,

        status:
          BRIDGE_STATUS.FAILED,

        error:
          error?.message ||
          String(error),

        session:
          this.sessionCoordinator.getSession(
            id
          ),
      };
    }
  }

  // ==========================================================
  // CANCEL
  // ==========================================================

  async cancel(
    sessionId,
    reason = ""
  ) {
    const link =
      this._requireLink(sessionId);

    const id =
      link.sessionId;

    let task = null;

    if (link.taskId) {
      try {
        task =
          await this.taskAdapter.cancelTask(
            link.taskId,
            reason
          );
      } catch (error) {
        task = {
          success: false,

          error:
            error?.message ||
            String(error),
        };
      }
    }

    const session =
      this.sessionCoordinator.cancelSession(
        id,
        reason
      );

    return {
      success: true,

      sessionId:
        id,

      taskId:
        link.taskId || null,

      status:
        BRIDGE_STATUS.CANCELLED,

      reason:
        safeString(reason),

      session,

      task,
    };
  }

  // ==========================================================
  // STATUS
  // ==========================================================

  getStatus(sessionId) {
    const link =
      this.getLink(sessionId);

    const session =
      this.sessionCoordinator.getStatus(
        sessionId
      );

    let task = null;

    if (link?.taskId) {
      task =
        this.taskAdapter.getStatus(
          link.taskId
        );
    }

    return {
      success:
        Boolean(session),

      sessionId:
        session?.sessionId ||
        safeString(sessionId),

      taskId:
        link?.taskId || null,

      session,

      task,

      status:
        this._mergeStatus(
          session?.status,
          task?.status
        ),
    };
  }

  // ==========================================================
  // SNAPSHOT
  // ==========================================================

  createSnapshot(
    sessionId,
    metadata = {}
  ) {
    const link =
      this._requireLink(sessionId);

    const snapshot =
      this.sessionCoordinator.createSnapshot(
        sessionId,
        {
          ...metadata,

          taskId:
            link.taskId || null,
        }
      );

    return {
      success: true,

      sessionId:
        link.sessionId,

      taskId:
        link.taskId || null,

      snapshot,
    };
  }

  // ==========================================================
  // REMOVE
  // ==========================================================

  remove(sessionId) {
    const id =
      safeString(sessionId).trim();

    const link =
      this.links.get(id);

    if (link?.taskId) {
      try {
        this.taskAdapter.removeTask(
          link.taskId
        );
      } catch {
        // Session removal should continue.
      }
    }

    this.links.delete(id);

    return this.sessionCoordinator.removeSession(
      id
    );
  }

  // ==========================================================
  // LIST
  // ==========================================================

  list(options = {}) {
    const sessions =
      this.sessionCoordinator.listSessions(
        options
      );

    return sessions.map(
      (session) => {
        const link =
          this.links.get(
            session.sessionId
          );

        return {
          ...clone(session),

          taskId:
            link?.taskId ||
            session.taskId ||
            null,
        };
      }
    );
  }

  // ==========================================================
  // STATS
  // ==========================================================

  getStats() {
    return {
      version:
        this.version,

      links:
        this.links.size,

      sessions:
        this.sessionCoordinator.getStats(),

      tasks:
        typeof this.taskAdapter.getStats ===
        "function"
          ? this.taskAdapter.getStats()
          : null,
    };
  }

  // ==========================================================
  // INTERNAL LINK CHECK
  // ==========================================================

  _requireLink(sessionId) {
    const id =
      safeString(sessionId).trim();

    if (!id) {
      throw new Error(
        "Session id is required"
      );
    }

    let link =
      this.links.get(id);

    if (!link) {
      const session =
        this.sessionCoordinator.getSession(
          id
        );

      if (!session) {
        throw new Error(
          `Session not found: ${id}`
        );
      }

      link = {
        sessionId: id,

        taskId:
          session.session?.taskId ||
          null,

        createdAt:
          session.session?.createdAt ||
          Date.now(),
      };

      this.links.set(id, link);
    }

    return link;
  }

  // ==========================================================
  // STATUS NORMALIZATION
  // ==========================================================

  _extractTaskStatus(result) {
    const status =
      result?.status ||
      result?.task?.status ||
      result?.workflow?.status ||
      result?.state ||
      "";

    const normalized =
      safeString(status)
        .trim()
        .toLowerCase();

    if (
      normalized.includes(
        "waiting"
      ) ||
      normalized.includes(
        "confirmation"
      )
    ) {
      return BRIDGE_STATUS.WAITING_CONFIRMATION;
    }

    if (
      normalized.includes(
        "cancel"
      )
    ) {
      return BRIDGE_STATUS.CANCELLED;
    }

    if (
      normalized.includes(
        "fail"
      ) ||
      normalized.includes(
        "error"
      )
    ) {
      return BRIDGE_STATUS.FAILED;
    }

    if (
      normalized.includes(
        "complete"
      ) ||
      normalized.includes(
        "verified"
      ) ||
      normalized === "success"
    ) {
      return BRIDGE_STATUS.COMPLETED;
    }

    if (
      result?.success === true &&
      result?.completed === true
    ) {
      return BRIDGE_STATUS.COMPLETED;
    }

    if (
      result?.success === false
    ) {
      return BRIDGE_STATUS.FAILED;
    }

    return BRIDGE_STATUS.ACTIVE;
  }

  // ==========================================================
  // MERGE SESSION + TASK STATUS
  // ==========================================================

  _mergeStatus(
    sessionStatus,
    taskStatus
  ) {
    const session =
      safeString(sessionStatus)
        .trim()
        .toLowerCase();

    const task =
      safeString(taskStatus)
        .trim()
        .toLowerCase();

    if (
      session ===
      BRIDGE_STATUS.CANCELLED ||
      task ===
      BRIDGE_STATUS.CANCELLED
    ) {
      return BRIDGE_STATUS.CANCELLED;
    }

    if (
      session ===
      BRIDGE_STATUS.FAILED ||
      task ===
      BRIDGE_STATUS.FAILED
    ) {
      return BRIDGE_STATUS.FAILED;
    }

    if (
      session ===
      BRIDGE_STATUS.WAITING_CONFIRMATION ||
      task ===
      BRIDGE_STATUS.WAITING_CONFIRMATION
    ) {
      return BRIDGE_STATUS.WAITING_CONFIRMATION;
    }

    if (
      session ===
      BRIDGE_STATUS.COMPLETED &&
      task ===
      BRIDGE_STATUS.COMPLETED
    ) {
      return BRIDGE_STATUS.COMPLETED;
    }

    if (
      session ===
      BRIDGE_STATUS.ACTIVE ||
      task ===
      BRIDGE_STATUS.ACTIVE
    ) {
      return BRIDGE_STATUS.ACTIVE;
    }

    return (
      session ||
      task ||
      BRIDGE_STATUS.READY
    );
  }
}

// ============================================================
// SINGLETON
// ============================================================

let bridgeInstance = null;

function getAgentSessionBridge(
  options = {}
) {
  if (!bridgeInstance) {
    bridgeInstance =
      new AgentSessionBridge(
        options
      );
  }

  return bridgeInstance;
}

function resetAgentSessionBridge(
  options = {}
) {
  bridgeInstance =
    new AgentSessionBridge(
      options
    );

  return bridgeInstance;
}

function createAgentSessionBridge(
  options = {}
) {
  return new AgentSessionBridge(
    options
  );
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  AgentSessionBridge,

  getAgentSessionBridge,
  resetAgentSessionBridge,
  createAgentSessionBridge,

  SESSION_BRIDGE_VERSION,
  BRIDGE_STATUS,
};