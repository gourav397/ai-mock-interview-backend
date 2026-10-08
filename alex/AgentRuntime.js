// ============================================================
// ALEX — Agent Runtime
// Version: 1.0.0
//
// Purpose:
//   Central runtime that connects the new Agent subsystems:
//
//   - Capability Manager
//   - Session Coordinator
//   - Session Bridge
//   - Task Adapter
//   - Workflow Coordinator
//   - Orchestrator
//   - Verification Engine
//
// This file does not replace the existing ALEX runtime.
// It provides a new unified runtime layer that can be connected
// to existing routes later.
// ============================================================

"use strict";

const {
  getAgentCapabilityManager,
} = require("./AgentCapabilityManager");

const {
  getAgentSessionCoordinator,
} = require("./AgentSessionCoordinator");

const {
  getAgentSessionBridge,
} = require("./AgentSessionBridge");

const {
  getAgentTaskAdapter,
} = require("./AgentTaskAdapter");

const {
  getAgentWorkflowCoordinator,
} = require("./AgentWorkflowCoordinator");

const {
  getAgentOrchestrator,
} = require("./AgentOrchestrator");

const {
  getAgentVerificationEngine,
} = require("./AgentVerificationEngine");

const {
  getAgentExecutionVerifier,
} = require("./AgentExecutionVerifier");

const AGENT_RUNTIME_VERSION = "1.0.0";

const RUNTIME_STATUS = Object.freeze({
  CREATED: "created",
  READY: "ready",
  RUNNING: "running",
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

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

class AgentRuntime {
  constructor(options = {}) {
    this.version = AGENT_RUNTIME_VERSION;

    this.capabilityManager =
      options.capabilityManager ||
      getAgentCapabilityManager();

    this.sessionCoordinator =
      options.sessionCoordinator ||
      getAgentSessionCoordinator();

    this.sessionBridge =
      options.sessionBridge ||
      getAgentSessionBridge();

    this.taskAdapter =
      options.taskAdapter ||
      getAgentTaskAdapter();

    this.workflowCoordinator =
      options.workflowCoordinator ||
      getAgentWorkflowCoordinator();

    this.orchestrator =
      options.orchestrator ||
      getAgentOrchestrator();

    this.verificationEngine =
      options.verificationEngine ||
      getAgentVerificationEngine();

    this.executionVerifier =
      options.executionVerifier ||
      getAgentExecutionVerifier();

    this.startedAt = Date.now();

    this.status =
      RUNTIME_STATUS.CREATED;

    this.runtimeEvents = [];

    this.maxRuntimeEvents =
      Number.isFinite(options.maxRuntimeEvents)
        ? Math.max(
            100,
            Math.min(
              5000,
              options.maxRuntimeEvents
            )
          )
        : 1000;

    this._record(
      "runtime_created"
    );

    this.status =
      RUNTIME_STATUS.READY;

    this._record(
      "runtime_ready"
    );
  }

  // ==========================================================
  // RUNTIME STATUS
  // ==========================================================

  getStatus() {
    return {
      success: true,

      version:
        this.version,

      status:
        this.status,

      startedAt:
        this.startedAt,

      uptime:
        Date.now() - this.startedAt,

      events:
        this.runtimeEvents.length,

      components:
        {
          capabilities:
            Boolean(this.capabilityManager),

          sessions:
            Boolean(this.sessionCoordinator),

          sessionBridge:
            Boolean(this.sessionBridge),

          tasks:
            Boolean(this.taskAdapter),

          workflows:
            Boolean(this.workflowCoordinator),

          orchestrator:
            Boolean(this.orchestrator),

          verification:
            Boolean(this.verificationEngine),

          executionVerifier:
            Boolean(this.executionVerifier),
        },
    };
  }

  // ==========================================================
  // CAPABILITIES
  // ==========================================================

  getCapabilities(options = {}) {
    if (
      !this.capabilityManager ||
      typeof this.capabilityManager.list !==
        "function"
    ) {
      return [];
    }

    return this.capabilityManager.list(
      options
    );
  }

  getCapabilitySummary() {
    if (
      !this.capabilityManager ||
      typeof this.capabilityManager.summary !==
        "function"
    ) {
      return null;
    }

    return this.capabilityManager.summary();
  }

  hasCapability(
    capability,
    options = {}
  ) {
    if (
      !this.capabilityManager ||
      typeof this.capabilityManager.has !==
        "function"
    ) {
      return false;
    }

    return Boolean(
      this.capabilityManager.has(
        capability,
        options
      )
    );
  }

  // ==========================================================
  // CREATE SESSION
  // ==========================================================

  createSession(options = {}) {
    this._setStatus(
      RUNTIME_STATUS.RUNNING
    );

    const result =
      this.sessionBridge.create(
        options
      );

    this._record(
      "session_created",
      {
        sessionId:
          result?.sessionId ||
          null,

        taskId:
          result?.taskId ||
          null,
      }
    );

    return result;
  }

  // ==========================================================
  // GET SESSION
  // ==========================================================

  getSession(sessionId) {
    return this.sessionBridge.getSession(
      sessionId
    );
  }

  // ==========================================================
  // GET SESSION STATUS
  // ==========================================================

  getSessionStatus(sessionId) {
    return this.sessionBridge.getStatus(
      sessionId
    );
  }

  // ==========================================================
  // ADD ONE ACTION
  // ==========================================================

  addAction(
    sessionId,
    action
  ) {
    const result =
      this.sessionBridge.addAction(
        sessionId,
        action
      );

    this._record(
      "action_added",
      {
        sessionId,
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
  // ADD MULTIPLE ACTIONS
  // ==========================================================

  addActions(
    sessionId,
    actions
  ) {
    const result =
      this.sessionBridge.addActions(
        sessionId,
        actions
      );

    this._record(
      "actions_added",
      {
        sessionId,

        count:
          Array.isArray(actions)
            ? actions.length
            : 0,
      }
    );

    return result;
  }

  // ==========================================================
  // RUN SESSION
  // ==========================================================

  async runSession(
    sessionId,
    options = {}
  ) {
    this._setStatus(
      RUNTIME_STATUS.RUNNING
    );

    this._record(
      "session_run_started",
      {
        sessionId,
      }
    );

    try {
      const result =
        await this.sessionBridge.run(
          sessionId,
          options
        );

      const runtimeStatus =
        this._normalizeRuntimeStatus(
          result
        );

      this._setStatus(
        runtimeStatus
      );

      this._record(
        "session_run_finished",
        {
          sessionId,

          status:
            runtimeStatus,

          success:
            result?.success !== false,
        }
      );

      return result;
    } catch (error) {
      this._setStatus(
        RUNTIME_STATUS.FAILED
      );

      this._record(
        "session_run_failed",
        {
          sessionId,

          error:
            error?.message ||
            String(error),
        }
      );

      throw error;
    }
  }

  // ==========================================================
  // RUN WITH RECOVERY
  // ==========================================================

  async runSessionWithRecovery(
    sessionId,
    options = {}
  ) {
    this._setStatus(
      RUNTIME_STATUS.RUNNING
    );

    this._record(
      "session_recovery_run_started",
      {
        sessionId,
      }
    );

    try {
      const result =
        await this.sessionBridge.runWithRecovery(
          sessionId,
          options
        );

      const runtimeStatus =
        this._normalizeRuntimeStatus(
          result
        );

      this._setStatus(
        runtimeStatus
      );

      this._record(
        "session_recovery_run_finished",
        {
          sessionId,

          status:
            runtimeStatus,

          success:
            result?.success !== false,
        }
      );

      return result;
    } catch (error) {
      this._setStatus(
        RUNTIME_STATUS.FAILED
      );

      this._record(
        "session_recovery_run_failed",
        {
          sessionId,

          error:
            error?.message ||
            String(error),
        }
      );

      throw error;
    }
  }

  // ==========================================================
  // RESUME SESSION
  // ==========================================================

  async resumeSession(
    sessionId,
    options = {}
  ) {
    this._setStatus(
      RUNTIME_STATUS.RUNNING
    );

    this._record(
      "session_resume_started",
      {
        sessionId,
      }
    );

    try {
      const result =
        await this.sessionBridge.resume(
          sessionId,
          options
        );

      const runtimeStatus =
        this._normalizeRuntimeStatus(
          result
        );

      this._setStatus(
        runtimeStatus
      );

      this._record(
        "session_resume_finished",
        {
          sessionId,

          status:
            runtimeStatus,

          success:
            result?.success !== false,
        }
      );

      return result;
    } catch (error) {
      this._setStatus(
        RUNTIME_STATUS.FAILED
      );

      this._record(
        "session_resume_failed",
        {
          sessionId,

          error:
            error?.message ||
            String(error),
        }
      );

      throw error;
    }
  }

  // ==========================================================
  // CANCEL SESSION
  // ==========================================================

  async cancelSession(
    sessionId,
    reason = ""
  ) {
    const result =
      await this.sessionBridge.cancel(
        sessionId,
        reason
      );

    this._setStatus(
      RUNTIME_STATUS.CANCELLED
    );

    this._record(
      "session_cancelled",
      {
        sessionId,

        reason:
          safeString(reason),
      }
    );

    return result;
  }

  // ==========================================================
  // CREATE SNAPSHOT
  // ==========================================================

  createSnapshot(
    sessionId,
    metadata = {}
  ) {
    const result =
      this.sessionBridge.createSnapshot(
        sessionId,
        metadata
      );

    this._record(
      "session_snapshot_created",
      {
        sessionId,
      }
    );

    return result;
  }

  // ==========================================================
  // TASK API
  // ==========================================================

  getTask(sessionId) {
    return this.sessionBridge.getTask(
      sessionId
    );
  }

  getTaskStatus(sessionId) {
    const task =
      this.sessionBridge.getTask(
        sessionId
      );

    return task;
  }

  // ==========================================================
  // WORKFLOW API
  // ==========================================================

  createWorkflow(options = {}) {
    if (
      !this.workflowCoordinator ||
      typeof this.workflowCoordinator.create !==
        "function"
    ) {
      throw new Error(
        "AgentWorkflowCoordinator.create is unavailable"
      );
    }

    const workflow =
      this.workflowCoordinator.create(
        options
      );

    this._record(
      "workflow_created",
      {
        workflowId:
          workflow?.workflowId ||
          workflow?.id ||
          null,
      }
    );

    return workflow;
  }

  getWorkflow(workflowId) {
    if (
      !this.workflowCoordinator ||
      typeof this.workflowCoordinator.get !==
        "function"
    ) {
      return null;
    }

    return this.workflowCoordinator.get(
      workflowId
    );
  }

  getWorkflowStatus(workflowId) {
    if (
      !this.workflowCoordinator ||
      typeof this.workflowCoordinator.status !==
        "function"
    ) {
      return null;
    }

    return this.workflowCoordinator.status(
      workflowId
    );
  }

  // ==========================================================
  // TOOL INSPECTION
  // ==========================================================

  inspectTool(
    tool,
    args = {},
    context = null
  ) {
    if (
      !this.orchestrator ||
      typeof this.orchestrator.inspectAction !==
        "function"
    ) {
      throw new Error(
        "AgentOrchestrator.inspectAction is unavailable"
      );
    }

    return this.orchestrator.inspectAction(
      {
        tool,
        args,
        context,
      }
    );
  }

  // ==========================================================
  // DIRECT TOOL EXECUTION
  //
  // This method intentionally delegates to the
  // AgentOrchestrator. It does not call WindowsAgent directly.
  // ==========================================================

  async executeTool(
    context,
    tool,
    args = {},
    options = {}
  ) {
    if (
      !this.orchestrator ||
      typeof this.orchestrator.execute !==
        "function"
    ) {
      throw new Error(
        "AgentOrchestrator.execute is unavailable"
      );
    }

    this._setStatus(
      RUNTIME_STATUS.RUNNING
    );

    this._record(
      "tool_execution_started",
      {
        tool,
      }
    );

    try {
      const result =
        await this.orchestrator.execute(
          {
            context,

            tool,

            args,

            confirmed:
              options.confirmed === true,

            confirmationReason:
              options.confirmationReason ||
              "",
          }
        );

      const runtimeStatus =
        this._normalizeToolStatus(
          result
        );

      this._setStatus(
        runtimeStatus
      );

      this._record(
        "tool_execution_finished",
        {
          tool,

          status:
            runtimeStatus,

          success:
            result?.success !== false,

          requiresConfirmation:
            result?.requiresConfirmation === true,
        }
      );

      return result;
    } catch (error) {
      this._setStatus(
        RUNTIME_STATUS.FAILED
      );

      this._record(
        "tool_execution_failed",
        {
          tool,

          error:
            error?.message ||
            String(error),
        }
      );

      throw error;
    }
  }

  // ==========================================================
  // VERIFY RESULT
  // ==========================================================

  async verifyResult(
    result,
    expectation,
    options = {}
  ) {
    if (
      !this.verificationEngine ||
      typeof this.verificationEngine.verify !==
        "function"
    ) {
      throw new Error(
        "AgentVerificationEngine.verify is unavailable"
      );
    }

    const verification =
      await this.verificationEngine.verify(
        {
          result,

          expectation,

          action:
            options.action ||
            null,

          context:
            options.context ||
            null,
        }
      );

    this._record(
      "result_verified",
      {
        status:
          verification?.status ||
          null,

        success:
          verification?.success === true,
      }
    );

    return verification;
  }

  // ==========================================================
  // VERIFY ACTION
  // ==========================================================

  async verifyAction(
    action,
    result,
    context = null
  ) {
    if (
      !this.executionVerifier ||
      typeof this.executionVerifier.verifyAction !==
        "function"
    ) {
      throw new Error(
        "AgentExecutionVerifier.verifyAction is unavailable"
      );
    }

    const verification =
      await this.executionVerifier.verifyAction(
        {
          action,
          result,
          context,
        }
      );

    this._record(
      "action_verified",
      {
        actionId:
          action?.actionId ||
          null,

        success:
          verification?.success === true,

        status:
          verification?.status ||
          null,
      }
    );

    return verification;
  }

  // ==========================================================
  // RUNTIME SNAPSHOT
  // ==========================================================

  snapshot() {
    return {
      version:
        this.version,

      status:
        this.status,

      startedAt:
        this.startedAt,

      uptime:
        Date.now() - this.startedAt,

      capabilities:
        this.getCapabilitySummary(),

      runtimeEvents:
        this.runtimeEvents.length,

      components:
        {
          sessionCoordinator:
            Boolean(
              this.sessionCoordinator
            ),

          sessionBridge:
            Boolean(
              this.sessionBridge
            ),

          taskAdapter:
            Boolean(
              this.taskAdapter
            ),

          workflowCoordinator:
            Boolean(
              this.workflowCoordinator
            ),

          orchestrator:
            Boolean(
              this.orchestrator
            ),

          verificationEngine:
            Boolean(
              this.verificationEngine
            ),

          executionVerifier:
            Boolean(
              this.executionVerifier
            ),
        },
    };
  }

  // ==========================================================
  // RUNTIME EVENTS
  // ==========================================================

  getEvents(options = {}) {
    const limit =
      Number.isFinite(options.limit)
        ? Math.max(
            1,
            Math.min(
              1000,
              options.limit
            )
          )
        : 100;

    const reverse =
      options.reverse === true;

    const events =
      reverse
        ? [...this.runtimeEvents].reverse()
        : [...this.runtimeEvents];

    return clone(
      events.slice(
        0,
        limit
      )
    );
  }

  clearEvents() {
    this.runtimeEvents = [];

    this._record(
      "runtime_events_cleared"
    );

    return {
      success: true,

      count:
        this.runtimeEvents.length,
    };
  }

  // ==========================================================
  // HEALTH CHECK
  // ==========================================================

  health() {
    const components = {
      capabilityManager:
        Boolean(
          this.capabilityManager
        ),

      sessionCoordinator:
        Boolean(
          this.sessionCoordinator
        ),

      sessionBridge:
        Boolean(
          this.sessionBridge
        ),

      taskAdapter:
        Boolean(
          this.taskAdapter
        ),

      workflowCoordinator:
        Boolean(
          this.workflowCoordinator
        ),

      orchestrator:
        Boolean(
          this.orchestrator
        ),

      verificationEngine:
        Boolean(
          this.verificationEngine
        ),

      executionVerifier:
        Boolean(
          this.executionVerifier
        ),
    };

    const healthy =
      Object.values(
        components
      ).every(Boolean);

    return {
      healthy,

      status:
        healthy
          ? "healthy"
          : "degraded",

      version:
        this.version,

      components,

      timestamp:
        new Date().toISOString(),
    };
  }

  // ==========================================================
  // INTERNAL STATUS
  // ==========================================================

  _setStatus(status) {
    this.status =
      status;

    this._record(
      "runtime_status_changed",
      {
        status,
      }
    );
  }

  // ==========================================================
  // INTERNAL EVENT LOGGER
  // ==========================================================

  _record(
    type,
    data = {}
  ) {
    this.runtimeEvents.push(
      {
        id:
          `runtime_event_${Date.now()}_${Math.random()
            .toString(36)
            .slice(2, 8)}`,

        type:

          safeString(type) ||
          "runtime_event",

        timestamp:
          Date.now(),

        data:
          clone(data),
      }
    );

    if (
      this.runtimeEvents.length >
      this.maxRuntimeEvents
    ) {
      this.runtimeEvents.splice(
        0,
        this.runtimeEvents.length -
          this.maxRuntimeEvents
      );
    }
  }

  // ==========================================================
  // NORMALIZE SESSION RESULT STATUS
  // ==========================================================

  _normalizeRuntimeStatus(
    result
  ) {
    const status =
      safeString(
        result?.status
      )
        .trim()
        .toLowerCase();

    if (
      status.includes(
        "waiting"
      ) ||
      status.includes(
        "confirmation"
      )
    ) {
      return RUNTIME_STATUS.WAITING_CONFIRMATION;
    }

    if (
      status.includes(
        "cancel"
      )
    ) {
      return RUNTIME_STATUS.CANCELLED;
    }

    if (
      status.includes(
        "fail"
      ) ||
      status.includes(
        "error"
      )
    ) {
      return RUNTIME_STATUS.FAILED;
    }

    if (
      status.includes(
        "complete"
      ) ||
      status.includes(
        "verified"
      ) ||
      result?.completed === true
    ) {
      return RUNTIME_STATUS.COMPLETED;
    }

    if (
      result?.success === false
    ) {
      return RUNTIME_STATUS.FAILED;
    }

    return RUNTIME_STATUS.RUNNING;
  }

  // ==========================================================
  // NORMALIZE TOOL RESULT STATUS
  // ==========================================================

  _normalizeToolStatus(
    result
  ) {
    if (
      result?.requiresConfirmation === true
    ) {
      return RUNTIME_STATUS.WAITING_CONFIRMATION;
    }

    if (
      result?.success === false
    ) {
      return RUNTIME_STATUS.FAILED;
    }

    if (
      result?.success === true
    ) {
      return RUNTIME_STATUS.COMPLETED;
    }

    return RUNTIME_STATUS.RUNNING;
  }
}

// ============================================================
// SINGLETON
// ============================================================

let runtimeInstance = null;

function getAgentRuntime(
  options = {}
) {
  if (!runtimeInstance) {
    runtimeInstance =
      new AgentRuntime(
        options
      );
  }

  return runtimeInstance;
}

function resetAgentRuntime(
  options = {}
) {
  runtimeInstance =
    new AgentRuntime(
      options
    );

  return runtimeInstance;
}

function createAgentRuntime(
  options = {}
) {
  return new AgentRuntime(
    options
  );
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  AgentRuntime,

  getAgentRuntime,
  resetAgentRuntime,
  createAgentRuntime,

  AGENT_RUNTIME_VERSION,
  RUNTIME_STATUS,
};