// ============================================================
// ALEX — Agent Session Coordinator
// Version: 1.0.0
//
// Purpose:
//   High-level coordinator connecting:
//     AgentSessionManager
//     AgentSessionStore
//     AgentExecutionContext
//     AgentCapabilityManager
//
// This file manages session lifecycle.
// It does NOT execute tools directly.
// ============================================================

"use strict";

const {
  getAgentSessionManager,
} = require("./AgentSessionManager");

const {
  getAgentSessionStore,
} = require("./AgentSessionStore");

const {
  createAgentExecutionContext,
} = require("./AgentExecutionContext");

const {
  getAgentCapabilityManager,
} = require("./AgentCapabilityManager");

const SESSION_COORDINATOR_VERSION = "1.0.0";

const COORDINATOR_STATUS = Object.freeze({
  READY: "ready",
  ACTIVE: "active",
  PAUSED: "paused",
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

class AgentSessionCoordinator {
  constructor(options = {}) {
    this.version =
      SESSION_COORDINATOR_VERSION;

    this.sessionManager =
      options.sessionManager ||
      getAgentSessionManager();

    this.sessionStore =
      options.sessionStore ||
      getAgentSessionStore();

    this.capabilityManager =
      options.capabilityManager ||
      getAgentCapabilityManager();

    this.contexts = new Map();
  }

  // ==========================================================
  // CREATE SESSION
  // ==========================================================

  createSession(options = {}) {
    const session =
      this.sessionManager.create({
        ownerId: options.ownerId,
        userId: options.userId,
        taskId: options.taskId,
        parentSessionId:
          options.parentSessionId,
        goal: options.goal || "",
        originalInput:
          options.originalInput || "",
        metadata:
          options.metadata || {},
        capabilities:
          options.capabilities || [],
        sessionId:
          options.sessionId,
      });

    const context =
      createAgentExecutionContext({
        contextId:
          options.contextId,
        taskId:
          options.taskId ||
          session.taskId ||
          session.sessionId,
        ownerId:
          options.ownerId ||
          session.ownerId,
        sessionId:
          session.sessionId,
        goal:
          options.goal ||
          session.goal,
        originalInput:
          options.originalInput ||
          session.originalInput,
        maxSteps:
          options.maxSteps,
        metadata:
          options.contextMetadata || {},
        capabilities:
          options.capabilities ||
          session.capabilities,
      });

    this.contexts.set(
      session.sessionId,
      context
    );

    this.sessionStore.upsert(
      this._buildStoredSession(session)
    );

    this.sessionStore.recordEvent(
      session.sessionId,
      "coordinator_session_created",
      {
        contextId:
          context.contextId,
      }
    );

    return this._buildSessionResult(
      session.sessionId
    );
  }

  // ==========================================================
  // GET SESSION
  // ==========================================================

  getSession(sessionId) {
    const id = safeString(sessionId).trim();

    if (!id) {
      return null;
    }

    const session =
      this.sessionManager.get(id);

    if (!session) {
      return null;
    }

    return this._buildSessionResult(id);
  }

  // ==========================================================
  // START
  // ==========================================================

  startSession(sessionId) {
    const id = safeString(sessionId).trim();

    const session =
      this.sessionManager.start(id);

    const context =
      this.contexts.get(id);

    if (context) {
      context.setStatus(
        COORDINATOR_STATUS.ACTIVE
      );
    }

    this._syncStore(id);

    return this._buildSessionResult(id);
  }

  // ==========================================================
  // PAUSE
  // ==========================================================

  pauseSession(
    sessionId,
    reason = ""
  ) {
    const id = safeString(sessionId).trim();

    const session =
      this.sessionManager.pause(
        id,
        reason
      );

    const context =
      this.contexts.get(id);

    if (context) {
      context.setStatus(
        COORDINATOR_STATUS.PAUSED
      );
    }

    this._syncStore(id);

    return this._buildSessionResult(id);
  }

  // ==========================================================
  // WAIT FOR CONFIRMATION
  // ==========================================================

  waitForConfirmation(
    sessionId,
    details = {}
  ) {
    const id = safeString(sessionId).trim();

    const session =
      this.sessionManager.waitForConfirmation(
        id,
        details
      );

    const context =
      this.contexts.get(id);

    if (context) {
      context.setStatus(
        COORDINATOR_STATUS.WAITING_CONFIRMATION
      );

      context.setPermissionState({
        pending: true,
        details: clone(details),
      });
    }

    this._syncStore(id);

    return this._buildSessionResult(id);
  }

  // ==========================================================
  // RESUME
  // ==========================================================

  resumeSession(sessionId) {
    const id = safeString(sessionId).trim();

    const session =
      this.sessionManager.resume(id);

    const context =
      this.contexts.get(id);

    if (context) {
      context.setStatus(
        COORDINATOR_STATUS.ACTIVE
      );

      context.setPermissionState({
        pending: false,
      });
    }

    this._syncStore(id);

    return this._buildSessionResult(id);
  }

  // ==========================================================
  // COMPLETE
  // ==========================================================

  completeSession(
    sessionId,
    result = null
  ) {
    const id = safeString(sessionId).trim();

    const session =
      this.sessionManager.complete(
        id,
        result
      );

    const context =
      this.contexts.get(id);

    if (context) {
      context.setStatus(
        COORDINATOR_STATUS.COMPLETED
      );

      context.record(
        "session_completed",
        {
          hasResult:
            result !== null &&
            result !== undefined,
        }
      );
    }

    this.sessionStore.setResult(
      id,
      result
    );

    this._syncStore(id);

    return this._buildSessionResult(id);
  }

  // ==========================================================
  // FAIL
  // ==========================================================

  failSession(
    sessionId,
    error
  ) {
    const id = safeString(sessionId).trim();

    const session =
      this.sessionManager.fail(
        id,
        error
      );

    const context =
      this.contexts.get(id);

    if (context) {
      context.setStatus(
        COORDINATOR_STATUS.FAILED
      );

      context.record(
        "session_failed",
        {
          error:
            error instanceof Error
              ? error.message
              : safeString(error),
        }
      );
    }

    this.sessionStore.setError(
      id,
      error
    );

    this._syncStore(id);

    return this._buildSessionResult(id);
  }

  // ==========================================================
  // CANCEL
  // ==========================================================

  cancelSession(
    sessionId,
    reason = ""
  ) {
    const id = safeString(sessionId).trim();

    const session =
      this.sessionManager.cancel(
        id,
        reason
      );

    const context =
      this.contexts.get(id);

    if (context) {
      context.cancel(reason);

      context.setStatus(
        COORDINATOR_STATUS.CANCELLED
      );
    }

    this.sessionStore.recordEvent(
      id,
      "session_cancelled",
      {
        reason: safeString(reason),
      }
    );

    this._syncStore(id);

    return this._buildSessionResult(id);
  }

  // ==========================================================
  // NEXT STEP
  // ==========================================================

  nextStep(
    sessionId,
    details = {}
  ) {
    const id = safeString(sessionId).trim();

    const step =
      this.sessionManager.nextStep(
        id,
        details
      );

    const context =
      this.contexts.get(id);

    if (context) {
      context.nextStep();

      context.record(
        "step_started",
        {
          stepIndex: step,
          ...details,
        }
      );
    }

    this._syncStore(id);

    return {
      sessionId: id,
      stepIndex: step,
      contextId:
        context?.contextId || null,
    };
  }

  // ==========================================================
  // SET GOAL
  // ==========================================================

  setGoal(
    sessionId,
    goal
  ) {
    const id = safeString(sessionId).trim();

    const session =
      this.sessionManager.setGoal(
        id,
        goal
      );

    const context =
      this.contexts.get(id);

    if (context) {
      context.setGoal(goal);
    }

    this._syncStore(id);

    return this._buildSessionResult(id);
  }

  // ==========================================================
  // ADD CAPABILITY
  // ==========================================================

  addCapability(
    sessionId,
    capabilityId
  ) {
    const id = safeString(sessionId).trim();

    const capability =
      safeString(capabilityId).trim();

    if (!capability) {
      throw new Error(
        "Capability id is required"
      );
    }

    const capabilityInfo =
      this.capabilityManager.get(
        capability
      );

    if (!capabilityInfo) {
      throw new Error(
        `Unknown capability: ${capability}`
      );
    }

    const result =
      this.sessionManager.addCapability(
        id,
        capability
      );

    const context =
      this.contexts.get(id);

    if (context) {
      const current =
        typeof context.getCapabilities ===
        "function"
          ? context.getCapabilities()
          : [];

      if (
        !current.includes(capability)
      ) {
        context.setCapabilities([
          ...current,
          capability,
        ]);
      }
    }

    this.sessionStore.recordEvent(
      id,
      "capability_added",
      {
        capability,
      }
    );

    this._syncStore(id);

    return result;
  }

  // ==========================================================
  // REMOVE CAPABILITY
  // ==========================================================

  removeCapability(
    sessionId,
    capabilityId
  ) {
    const id = safeString(sessionId).trim();

    const capability =
      safeString(capabilityId).trim();

    const result =
      this.sessionManager.removeCapability(
        id,
        capability
      );

    const context =
      this.contexts.get(id);

    if (
      context &&
      typeof context.getCapabilities ===
        "function"
    ) {
      const current =
        context.getCapabilities();

      context.setCapabilities(
        current.filter(
          (item) =>
            item !== capability
        )
      );
    }

    this.sessionStore.recordEvent(
      id,
      "capability_removed",
      {
        capability,
      }
    );

    this._syncStore(id);

    return result;
  }

  // ==========================================================
  // RECORD EVENT
  // ==========================================================

  recordEvent(
    sessionId,
    type,
    data = {}
  ) {
    const id = safeString(sessionId).trim();

    const event =
      this.sessionManager.record(
        id,
        type,
        data
      );

    this.sessionStore.recordEvent(
      id,
      type,
      data
    );

    return event;
  }

  // ==========================================================
  // GET CONTEXT
  // ==========================================================

  getContext(sessionId) {
    const id = safeString(sessionId).trim();

    const context =
      this.contexts.get(id);

    if (!context) {
      return null;
    }

    if (
      typeof context.snapshot ===
      "function"
    ) {
      return context.snapshot();
    }

    if (
      typeof context.toJSON ===
      "function"
    ) {
      return context.toJSON();
    }

    return clone(context);
  }

  // ==========================================================
  // GET CONTEXT INSTANCE
  // ==========================================================

  getContextInstance(sessionId) {
    const id = safeString(sessionId).trim();

    return (
      this.contexts.get(id) ||
      null
    );
  }

  // ==========================================================
  // SNAPSHOT
  // ==========================================================

  createSnapshot(
    sessionId,
    metadata = {}
  ) {
    const id = safeString(sessionId).trim();

    this._syncStore(id);

    return this.sessionStore.createSnapshot(
      id,
      metadata
    );
  }

  // ==========================================================
  // RESTORE SNAPSHOT
  // ==========================================================

  restoreSnapshot(
    sessionId,
    snapshotId
  ) {
    const id = safeString(sessionId).trim();

    const restored =
      this.sessionStore.restoreSnapshot(
        id,
        snapshotId
      );

    const context =
      this.contexts.get(id);

    if (
      context &&
      restored
    ) {
      if (
        restored.goal &&
        typeof context.setGoal ===
          "function"
      ) {
        context.setGoal(
          restored.goal
        );
      }

      if (
        restored.originalInput &&
        typeof context.setOriginalInput ===
          "function"
      ) {
        context.setOriginalInput(
          restored.originalInput
        );
      }

      if (
        Array.isArray(
          restored.capabilities
        ) &&
        typeof context.setCapabilities ===
          "function"
      ) {
        context.setCapabilities(
          restored.capabilities
        );
      }
    }

    this.sessionManager.touch(id);

    return this._buildSessionResult(id);
  }

  // ==========================================================
  // STATUS
  // ==========================================================

  getStatus(sessionId) {
    const id = safeString(sessionId).trim();

    const session =
      this.sessionManager.get(id);

    if (!session) {
      return null;
    }

    return {
      sessionId: id,

      status:
        session.status,

      stepIndex:
        session.stepIndex || 0,

      goal:
        session.goal || "",

      taskId:
        session.taskId || null,

      contextId:
        this.contexts.get(id)
          ?.contextId || null,

      createdAt:
        session.createdAt,

      updatedAt:
        session.updatedAt,

      lastActivityAt:
        session.lastActivityAt,

      capabilities:
        Array.isArray(
          session.capabilities
        )
          ? [
              ...session.capabilities,
            ]
          : [],
    };
  }

  // ==========================================================
  // LIST
  // ==========================================================

  listSessions(options = {}) {
    return this.sessionManager.list(
      options
    );
  }

  // ==========================================================
  // ACTIVE
  // ==========================================================

  listActiveSessions() {
    return this.sessionManager.listActive();
  }

  // ==========================================================
  // REMOVE
  // ==========================================================

  removeSession(sessionId) {
    const id = safeString(sessionId).trim();

    this.contexts.delete(id);

    this.sessionStore.remove(id);

    return this.sessionManager.remove(id);
  }

  // ==========================================================
  // EXPORT
  // ==========================================================

  exportState() {
    const contexts = {};

    for (
      const [
        sessionId,
        context,
      ]
      of this.contexts.entries()
    ) {
      if (
        context &&
        typeof context.snapshot ===
          "function"
      ) {
        contexts[sessionId] =
          context.snapshot();
      } else if (
        context &&
        typeof context.toJSON ===
          "function"
      ) {
        contexts[sessionId] =
          context.toJSON();
      }
    }

    return {
      version:
        this.version,

      exportedAt:
        Date.now(),

      sessions:
        this.sessionManager.list(),

      contexts,

      store:
        this.sessionStore.exportState(),
    };
  }

  // ==========================================================
  // STATS
  // ==========================================================

  getStats() {
    return {
      version:
        this.version,

      sessions:
        this.sessionManager.getStats(),

      store:
        this.sessionStore.getStats(),

      contexts:
        this.contexts.size,

      capabilities:
        this.capabilityManager.getSummary(),
    };
  }

  // ==========================================================
  // INTERNAL SYNC
  // ==========================================================

  _syncStore(sessionId) {
    const id = safeString(sessionId).trim();

    const session =
      this.sessionManager.get(id);

    if (!session) {
      return null;
    }

    return this.sessionStore.upsert(
      this._buildStoredSession(
        session
      )
    );
  }

  // ==========================================================
  // STORED SESSION
  // ==========================================================

  _buildStoredSession(session) {
    const context =
      this.contexts.get(
        session.sessionId
      );

    return {
      ...clone(session),

      contextId:
        context?.contextId ||
        null,

      coordinatorVersion:
        this.version,
    };
  }

  // ==========================================================
  // RESULT
  // ==========================================================

  _buildSessionResult(sessionId) {
    const id = safeString(sessionId).trim();

    const session =
      this.sessionManager.get(id);

    if (!session) {
      return null;
    }

    const context =
      this.contexts.get(id);

    return {
      success: true,

      session: clone(session),

      context:
        context &&
        typeof context.snapshot ===
          "function"
          ? context.snapshot()
          : context &&
            typeof context.toJSON ===
              "function"
            ? context.toJSON()
            : null,

      status:
        session.status,

      sessionId: id,

      contextId:
        context?.contextId ||
        null,
    };
  }
}

// ============================================================
// SINGLETON
// ============================================================

let coordinatorInstance = null;

function getAgentSessionCoordinator(
  options = {}
) {
  if (!coordinatorInstance) {
    coordinatorInstance =
      new AgentSessionCoordinator(
        options
      );
  }

  return coordinatorInstance;
}

function resetAgentSessionCoordinator(
  options = {}
) {
  coordinatorInstance =
    new AgentSessionCoordinator(
      options
    );

  return coordinatorInstance;
}

function createAgentSessionCoordinator(
  options = {}
) {
  return new AgentSessionCoordinator(
    options
  );
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  AgentSessionCoordinator,

  getAgentSessionCoordinator,
  resetAgentSessionCoordinator,
  createAgentSessionCoordinator,

  SESSION_COORDINATOR_VERSION,
  COORDINATOR_STATUS,
};
