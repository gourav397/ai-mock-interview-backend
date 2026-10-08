// ============================================================
// ALEX AGENT EXECUTION CONTEXT
// Version: 1.0.0
//
// Purpose:
//   Shared runtime context for ALEX agent executions.
//
// Used by future:
//   - Computer Agent
//   - Browser Agent
//   - Form Agent
//   - Document Agent
//   - Web Agent
//   - Autonomous Task Agent
//
// Design:
//   - No external dependency
//   - No secret logging
//   - Immutable identity fields
//   - Safe metadata
//   - Cancellation support
//   - Execution history
//   - Permission state
// ============================================================

"use strict";

// ============================================================
// CONSTANTS
// ============================================================

const CONTEXT_VERSION = "1.0.0";

const MAX_HISTORY_ITEMS = 500;
const MAX_METADATA_KEYS = 100;
const MAX_STRING_LENGTH = 20000;

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

function safeId(
  value,
  fallback
) {
  const result =
    safeString(
      value,
      fallback
    );

  if (!result) {
    return fallback;
  }

  return result.slice(
    0,
    300
  );
}

function safeBoolean(
  value,
  fallback = false
) {
  if (
    typeof value !==
    "boolean"
  ) {
    return fallback;
  }

  return value;
}

function safeObject(
  value
) {
  if (
    !value ||
    typeof value !==
      "object" ||
    Array.isArray(value)
  ) {
    return {};
  }

  return value;
}

function sanitizeValue(
  value,
  depth = 0
) {
  if (depth > 6) {
    return "[depth-limit]";
  }

  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (
    typeof value ===
      "string"
  ) {
    return value.slice(
      0,
      MAX_STRING_LENGTH
    );
  }

  if (
    typeof value ===
      "number" ||
    typeof value ===
      "boolean"
  ) {
    return value;
  }

  if (
    Array.isArray(value)
  ) {
    return value
      .slice(
        0,
        100
      )
      .map(
        (item) =>
          sanitizeValue(
            item,
            depth + 1
          )
      );
  }

  if (
    typeof value ===
      "object"
  ) {
    const output = {};

    for (
      const [
        key,
        item,
      ] of Object.entries(
        value
      )
    ) {
      // Never copy secrets into generic context metadata.
      if (
        /^(token|accessToken|agentToken|apiKey|api_key|secret|password|authorization|credential)$/i.test(
          key
        )
      ) {
        output[key] =
          "[REDACTED]";
        continue;
      }

      if (
        Object.keys(
          output
        ).length >=
        MAX_METADATA_KEYS
      ) {
        break;
      }

      output[key] =
        sanitizeValue(
          item,
          depth + 1
        );
    }

    return output;
  }

  return String(value).slice(
    0,
    MAX_STRING_LENGTH
  );
}

function createId(
  prefix
) {
  const timestamp =
    Date.now().toString(
      36
    );

  const random =
    Math.random()
      .toString(36)
      .slice(
        2,
        10
      );

  return `${prefix}_${timestamp}_${random}`;
}

// ============================================================
// EXECUTION CONTEXT
// ============================================================

class AgentExecutionContext {
  constructor(
    options = {}
  ) {
    this.version =
      CONTEXT_VERSION;

    // --------------------------------------------------------
    // Identity
    // --------------------------------------------------------

    this.contextId =
      safeId(
        options.contextId,
        createId("ctx")
      );

    this.taskId =
      safeId(
        options.taskId,
        createId("task")
      );

    this.ownerId =
      safeId(
        options.ownerId,
        "owner"
      );

    this.sessionId =
      safeId(
        options.sessionId,
        "default"
      );

    // --------------------------------------------------------
    // Goal
    // --------------------------------------------------------

    this.goal =
      safeString(
        options.goal
      );

    this.originalInput =
      safeString(
        options.originalInput ||
        options.input
      );

    // --------------------------------------------------------
    // Runtime
    // --------------------------------------------------------

    this.startedAt =
      options.startedAt ||
      new Date().toISOString();

    this.updatedAt =
      new Date().toISOString();

    this.status =
      safeString(
        options.status,
        "created"
      );

    this.stepIndex =
      Number.isFinite(
        Number(
          options.stepIndex
        )
      )
        ? Math.max(
            0,
            Math.floor(
              Number(
                options.stepIndex
              )
            )
          )
        : 0;

    this.maxSteps =
      Number.isFinite(
        Number(
          options.maxSteps
        )
      )
        ? Math.max(
            1,
            Math.min(
              1000,
              Math.floor(
                Number(
                  options.maxSteps
                )
              )
            )
          )
        : 100;

    // --------------------------------------------------------
    // Agent token
    //
    // Kept private-ish inside the runtime object.
    // It is NEVER returned by toJSON().
    // --------------------------------------------------------

    this._agentToken =
      safeString(
        options.agentToken
      );

    // --------------------------------------------------------
    // Cancellation
    // --------------------------------------------------------

    this._cancelled =
      false;

    this._cancelReason =
      "";

    // --------------------------------------------------------
    // Permission state
    // --------------------------------------------------------

    this.permissionState = {
      confirmedActions: new Set(),
      deniedActions: new Set(),
      pendingActions: new Map(),
    };

    // --------------------------------------------------------
    // Execution history
    // --------------------------------------------------------

    this.history = [];

    // --------------------------------------------------------
    // Runtime metadata
    // --------------------------------------------------------

    this.metadata =
      sanitizeValue(
        safeObject(
          options.metadata
        )
      );

    // --------------------------------------------------------
    // Parent task information
    // --------------------------------------------------------

    this.parentTaskId =
      safeId(
        options.parentTaskId,
        ""
      );

    this.parentContextId =
      safeId(
        options.parentContextId,
        ""
      );

    // --------------------------------------------------------
    // Capabilities
    // --------------------------------------------------------

    this.capabilities =
      Array.isArray(
        options.capabilities
      )
        ? [
            ...new Set(
              options.capabilities
                .map(
                  (item) =>
                    safeString(
                      item
                    )
                )
                .filter(Boolean)
            ),
          ].slice(
            0,
            200
          )
        : [];

    // --------------------------------------------------------
    // Initialization event
    // --------------------------------------------------------

    this.record(
      "context.created",
      {
        contextId:
          this.contextId,

        taskId:
          this.taskId,

        ownerId:
          this.ownerId,

        sessionId:
          this.sessionId,
      }
    );
  }

  // ==========================================================
  // TOKEN ACCESS
  // ==========================================================

  getAgentToken() {
    return this._agentToken;
  }

  hasAgentToken() {
    return Boolean(
      this._agentToken
    );
  }

  // ==========================================================
  // GOAL
  // ==========================================================

  setGoal(
    goal
  ) {
    this.goal =
      safeString(
        goal
      );

    this.touch();

    this.record(
      "goal.updated",
      {
        hasGoal:
          Boolean(
            this.goal
          ),
      }
    );

    return this.goal;
  }

  getGoal() {
    return this.goal;
  }

  // ==========================================================
  // STATUS
  // ==========================================================

  setStatus(
    status
  ) {
    const next =
      safeString(
        status
      );

    if (!next) {
      throw new Error(
        "Agent context status cannot be empty."
      );
    }

    this.status =
      next.slice(
        0,
        100
      );

    this.touch();

    return this.status;
  }

  getStatus() {
    return this.status;
  }

  // ==========================================================
  // STEP CONTROL
  // ==========================================================

  nextStep() {
    if (
      this.isCancelled()
    ) {
      throw new Error(
        "Agent execution has been cancelled."
      );
    }

    this.stepIndex += 1;

    if (
      this.stepIndex >
      this.maxSteps
    ) {
      throw new Error(
        `Agent execution exceeded the maximum step limit of ${this.maxSteps}.`
      );
    }

    this.touch();

    this.record(
      "step.started",
      {
        stepIndex:
          this.stepIndex,
      }
    );

    return this.stepIndex;
  }

  getStepIndex() {
    return this.stepIndex;
  }

  getRemainingSteps() {
    return Math.max(
      0,
      this.maxSteps -
        this.stepIndex
    );
  }

  // ==========================================================
  // CANCELLATION
  // ==========================================================

  cancel(
    reason = "Cancelled by user."
  ) {
    this._cancelled =
      true;

    this._cancelReason =
      safeString(
        reason,
        "Cancelled by user."
      ).slice(
        0,
        2000
      );

    this.status =
      "cancelled";

    this.touch();

    this.record(
      "context.cancelled",
      {
        reason:
          this._cancelReason,
      }
    );

    return true;
  }

  isCancelled() {
    return (
      this._cancelled ===
      true
    );
  }

  getCancelReason() {
    return this._cancelReason;
  }

  throwIfCancelled() {
    if (
      this.isCancelled()
    ) {
      const error =
        new Error(
          this._cancelReason ||
            "Agent execution cancelled."
        );

      error.code =
        "ALEX_AGENT_CANCELLED";

      throw error;
    }
  }

  // ==========================================================
  // PERMISSION STATE
  // ==========================================================

  makeActionKey(
    tool,
    args = {}
  ) {
    const toolName =
      safeString(
        tool
      );

    let serialized =
      "{}";

    try {
      serialized =
        JSON.stringify(
          sanitizeValue(
            args
          )
        );
    } catch {
      serialized =
        "[unserializable]";
    }

    return `${toolName}:${serialized}`;
  }

  markActionConfirmed(
    tool,
    args = {}
  ) {
    const key =
      this.makeActionKey(
        tool,
        args
      );

    this.permissionState.confirmedActions.add(
      key
    );

    this.permissionState.pendingActions.delete(
      key
    );

    this.permissionState.deniedActions.delete(
      key
    );

    this.touch();

    this.record(
      "permission.confirmed",
      {
        tool:
          safeString(
            tool
          ),
      }
    );

    return true;
  }

  markActionDenied(
    tool,
    args = {},
    reason = ""
  ) {
    const key =
      this.makeActionKey(
        tool,
        args
      );

    this.permissionState.deniedActions.add(
      key
    );

    this.permissionState.pendingActions.delete(
      key
    );

    this.permissionState.confirmedActions.delete(
      key
    );

    this.touch();

    this.record(
      "permission.denied",
      {
        tool:
          safeString(
            tool
          ),

        reason:
          safeString(
            reason
          ).slice(
            0,
            1000
          ),
      }
    );

    return true;
  }

  markActionPending(
    tool,
    args = {}
  ) {
    const key =
      this.makeActionKey(
        tool,
        args
      );

    this.permissionState.pendingActions.set(
      key,
      {
        tool:
          safeString(
            tool
          ),

        createdAt:
          new Date().toISOString(),
      }
    );

    this.touch();

    return key;
  }

  isActionConfirmed(
    tool,
    args = {}
  ) {
    return this.permissionState.confirmedActions.has(
      this.makeActionKey(
        tool,
        args
      )
    );
  }

  isActionDenied(
    tool,
    args = {}
  ) {
    return this.permissionState.deniedActions.has(
      this.makeActionKey(
        tool,
        args
      )
    );
  }

  // ==========================================================
  // HISTORY
  // ==========================================================

  record(
    type,
    data = {}
  ) {
    const event = {
      id:
        createId(
          "evt"
        ),

      type:
        safeString(
          type,
          "agent.event"
        ).slice(
          0,
          150
        ),

      timestamp:
        new Date().toISOString(),

      stepIndex:
        this.stepIndex,

      data:
        sanitizeValue(
          safeObject(
            data
          )
        ),
    };

    this.history.push(
      event
    );

    if (
      this.history.length >
      MAX_HISTORY_ITEMS
    ) {
      this.history =
        this.history.slice(
          -MAX_HISTORY_ITEMS
        );
    }

    this.touch();

    return event;
  }

  getHistory(
    options = {}
  ) {
    const limit =
      Number.isFinite(
        Number(
          options.limit
        )
      )
        ? Math.max(
            1,
            Math.min(
              MAX_HISTORY_ITEMS,
              Math.floor(
                Number(
                  options.limit
                )
              )
            )
          )
        : 100;

    return this.history
      .slice(
        -limit
      )
      .map(
        (event) =>
          sanitizeValue(
            event
          )
      );
  }

  clearHistory() {
    this.history = [];

    this.touch();

    this.record(
      "history.cleared"
    );

    return true;
  }

  // ==========================================================
  // METADATA
  // ==========================================================

  setMetadata(
    key,
    value
  ) {
    const name =
      safeString(
        key
      );

    if (!name) {
      throw new Error(
        "Metadata key is required."
      );
    }

    if (
      /^(token|accessToken|agentToken|apiKey|api_key|secret|password|authorization|credential)$/i.test(
        name
      )
    ) {
      throw new Error(
        `Sensitive metadata key '${name}' is not allowed.`
      );
    }

    if (
      !Object.prototype.hasOwnProperty.call(
        this.metadata,
        name
      ) &&
      Object.keys(
        this.metadata
      ).length >=
        MAX_METADATA_KEYS
    ) {
      throw new Error(
        "Maximum metadata key limit reached."
      );
    }

    this.metadata[name] =
      sanitizeValue(
        value
      );

    this.touch();

    return this.metadata[name];
  }

  getMetadata(
    key
  ) {
    const name =
      safeString(
        key
      );

    return this.metadata[
      name
    ];
  }

  getAllMetadata() {
    return sanitizeValue(
      this.metadata
    );
  }

  // ==========================================================
  // CAPABILITIES
  // ==========================================================

  hasCapability(
    capability
  ) {
    const name =
      safeString(
        capability
      );

    return this.capabilities.includes(
      name
    );
  }

  addCapability(
    capability
  ) {
    const name =
      safeString(
        capability
      );

    if (!name) {
      return false;
    }

    if (
      !this.capabilities.includes(
        name
      )
    ) {
      this.capabilities.push(
        name
      );
    }

    return true;
  }

  // ==========================================================
  // TIMESTAMP
  // ==========================================================

  touch() {
    this.updatedAt =
      new Date().toISOString();

    return this.updatedAt;
  }

  // ==========================================================
  // SAFE SNAPSHOT
  // ==========================================================

  snapshot() {
    return {
      version:
        this.version,

      contextId:
        this.contextId,

      taskId:
        this.taskId,

      ownerId:
        this.ownerId,

      sessionId:
        this.sessionId,

      parentTaskId:
        this.parentTaskId,

      parentContextId:
        this.parentContextId,

      goal:
        this.goal,

      originalInput:
        this.originalInput,

      startedAt:
        this.startedAt,

      updatedAt:
        this.updatedAt,

      status:
        this.status,

      stepIndex:
        this.stepIndex,

      maxSteps:
        this.maxSteps,

      remainingSteps:
        this.getRemainingSteps(),

      cancelled:
        this.isCancelled(),

      cancelReason:
        this._cancelReason,

      capabilities:
        [
          ...this.capabilities,
        ],

      metadata:
        this.getAllMetadata(),

      historyCount:
        this.history.length,

      hasAgentToken:
        this.hasAgentToken(),
    };
  }

  // ==========================================================
  // JSON SAFE OUTPUT
  // ==========================================================

  toJSON() {
    return this.snapshot();
  }

  // ==========================================================
  // SERIALIZE FOR PERSISTENCE
  // ==========================================================

  serialize() {
    return {
      ...this.snapshot(),

      history:
        this.getHistory({
          limit:
            MAX_HISTORY_ITEMS,
        }),

      permissions: {
        confirmed:
          this.permissionState
            .confirmedActions
            .size,

        denied:
          this.permissionState
            .deniedActions
            .size,

        pending:
          this.permissionState
            .pendingActions
            .size,
      },
    };
  }
}

// ============================================================
// FACTORY
// ============================================================

function createAgentExecutionContext(
  options = {}
) {
  return new AgentExecutionContext(
    options
  );
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  CONTEXT_VERSION,

  MAX_HISTORY_ITEMS,

  AgentExecutionContext,

  createAgentExecutionContext,
};