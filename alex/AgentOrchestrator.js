// ============================================================
// ALEX AGENT ORCHESTRATOR
// Version: 1.0.0
//
// Purpose:
//   Central execution layer for ALEX's agent tools.
//
// Flow:
//
//   Goal / Task
//       ↓
//   AgentExecutionContext
//       ↓
//   AgentPermissionManager
//       ↓
//   AgentToolRegistry
//       ↓
//   WindowsAgent
//       ↓
//   Result
//       ↓
//   Context history
//
// IMPORTANT:
//   - Does NOT execute arbitrary tools.
//   - Does NOT bypass WindowsAgent security.
//   - Does NOT expose agent tokens.
//   - Does NOT automatically approve high-impact actions.
//   - Browser/document tools can be added later.
// ============================================================

"use strict";

const {
  getAgentToolRegistry,
} = require("./AgentToolRegistry");

const {
  getAgentPermissionManager,
} = require("./AgentPermissionManager");

const {
  createAgentExecutionContext,
} = require("./AgentExecutionContext");

// ============================================================
// CONSTANTS
// ============================================================

const ORCHESTRATOR_VERSION =
  "1.0.0";

const MAX_EXECUTION_RESULT_SIZE =
  100000;

const MAX_TOOL_CALLS_PER_CONTEXT =
  500;

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

function safeObject(
  value
) {
  if (
    !value ||
    typeof value !== "object" ||
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
    typeof value === "string"
  ) {
    return value.slice(
      0,
      MAX_EXECUTION_RESULT_SIZE
    );
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 100)
      .map((item) =>
        sanitizeValue(
          item,
          depth + 1
        )
      );
  }

  if (
    typeof value === "object"
  ) {
    const output = {};

    for (
      const [key, item] of Object.entries(
        value
      )
    ) {
      if (
        /^(token|agentToken|accessToken|apiKey|api_key|secret|password|authorization|credential)$/i.test(
          key
        )
      ) {
        output[key] =
          "[REDACTED]";
        continue;
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
    MAX_EXECUTION_RESULT_SIZE
  );
}

// ============================================================
// ORCHESTRATOR
// ============================================================

class AgentOrchestrator {
  constructor(options = {}) {
    this.version =
      ORCHESTRATOR_VERSION;

    this.registry =
      options.registry ||
      getAgentToolRegistry();

    this.permissionManager =
      options.permissionManager ||
      getAgentPermissionManager();

    this.maxToolCallsPerContext =
      Number.isFinite(
        Number(
          options.maxToolCallsPerContext
        )
      )
        ? Math.max(
            1,
            Math.min(
              MAX_TOOL_CALLS_PER_CONTEXT,
              Math.floor(
                Number(
                  options.maxToolCallsPerContext
                )
              )
            )
          )
        : MAX_TOOL_CALLS_PER_CONTEXT;
  }

  // ==========================================================
  // CREATE CONTEXT
  // ==========================================================

  createContext(
    options = {}
  ) {
    return createAgentExecutionContext(
      options
    );
  }

  // ==========================================================
  // TOOL INFORMATION
  // ==========================================================

  listTools(
    options = {}
  ) {
    return this.registry.list(
      options
    );
  }

  getTool(
    tool
  ) {
    return this.registry.get(
      tool
    );
  }

  // ==========================================================
  // PLAN CHECK
  // ==========================================================

  inspectAction({
    tool,
    args = {},
    context = null,
  } = {}) {
    const name =
      safeString(
        tool
      );

    if (!name) {
      throw new Error(
        "Agent tool is required."
      );
    }

    if (
      !this.registry.has(
        name
      )
    ) {
      return {
        allowed: false,

        decision:
          "deny",

        tool: name,

        reason:
          `Tool '${name}' is not registered.`,
      };
    }

    // Validate arguments before
    // permission evaluation.
    const validatedArgs =
      this.registry.validate(
        name,
        args
      );

    const confirmed =
      Boolean(
        context &&
        typeof context.isActionConfirmed ===
          "function" &&
        context.isActionConfirmed(
          name,
          validatedArgs
        )
      );

    const permission =
      this.permissionManager.decide({
        tool:
          name,

        args:
          validatedArgs,

        confirmed,
      });

    return {
      ...permission,

      tool:
        name,

      args:
        sanitizeValue(
          validatedArgs
        ),
    };
  }

  // ==========================================================
  // EXECUTE ONE ACTION
  // ==========================================================

  async execute({
    context = null,
    tool,
    args = {},
    confirmed = false,
    confirmationReason = "",
  } = {}) {
    const executionContext =
      context ||
      this.createContext({
        goal:
          `Execute ${safeString(
            tool,
            "agent action"
          )}`,
      });

    // --------------------------------------------------------
    // Validate context
    // --------------------------------------------------------

    if (
      typeof executionContext.throwIfCancelled ===
      "function"
    ) {
      executionContext.throwIfCancelled();
    }

    // --------------------------------------------------------
    // Validate tool
    // --------------------------------------------------------

    const name =
      safeString(
        tool
      );

    if (!name) {
      throw new Error(
        "Agent tool is required."
      );
    }

    // --------------------------------------------------------
    // Tool-call limit
    // --------------------------------------------------------

    const callCount =
      this._getToolCallCount(
        executionContext
      );

    if (
      callCount >=
      this.maxToolCallsPerContext
    ) {
      const error =
        new Error(
          `Maximum agent tool call limit (${this.maxToolCallsPerContext}) reached.`
        );

      error.code =
        "ALEX_AGENT_TOOL_LIMIT";

      throw error;
    }

    // --------------------------------------------------------
    // Validate arguments
    // --------------------------------------------------------

    let validatedArgs;

    try {
      validatedArgs =
        this.registry.validate(
          name,
          args
        );
    } catch (error) {
      this._record(
        executionContext,
        "tool.validation_failed",
        {
          tool:
            name,

          error:
            error?.message ||
            String(error),
        }
      );

      throw error;
    }

    // --------------------------------------------------------
    // Check cancellation again
    // --------------------------------------------------------

    if (
      typeof executionContext.throwIfCancelled ===
      "function"
    ) {
      executionContext.throwIfCancelled();
    }

    // --------------------------------------------------------
    // Existing confirmation
    // --------------------------------------------------------

    const alreadyConfirmed =
      typeof executionContext.isActionConfirmed ===
        "function" &&
      executionContext.isActionConfirmed(
        name,
        validatedArgs
      );

    const finalConfirmed =
      confirmed ||
      alreadyConfirmed;

    // --------------------------------------------------------
    // Permission decision
    // --------------------------------------------------------

    const permission =
      this.permissionManager.decide({
        tool:
          name,

        args:
          validatedArgs,

        confirmed:
          finalConfirmed,

        executionContext:
          executionContext.snapshot
            ? executionContext.snapshot()
            : {},
      });

    // --------------------------------------------------------
    // Confirmation required
    // --------------------------------------------------------

    if (
      !permission.allowed
    ) {
      if (
        permission.decision ===
        "confirm"
      ) {
        if (
          typeof executionContext.markActionPending ===
          "function"
        ) {
          executionContext.markActionPending(
            name,
            validatedArgs
          );
        }

        const confirmation =
          this.permissionManager.buildConfirmationRequest({
            tool:
              name,

            args:
              validatedArgs,

            reason:
              confirmationReason ||
              permission.reason,
          });

        this._record(
          executionContext,
          "tool.confirmation_required",
          {
            tool:
              name,

            risk:
              permission.risk,
          }
        );

        return {
          success:
            false,

          completed:
            false,

          requiresConfirmation:
            true,

          decision:
            "confirm",

          tool:
            name,

          risk:
            permission.risk,

          reason:
            permission.reason,

          confirmation,
        };
      }

      // ------------------------------------------------------
      // Hard denial
      // ------------------------------------------------------

      if (
        typeof executionContext.markActionDenied ===
        "function"
      ) {
        executionContext.markActionDenied(
          name,
          validatedArgs,
          permission.reason
        );
      }

      this._record(
        executionContext,
        "tool.denied",
        {
          tool:
            name,

          risk:
            permission.risk,

          reason:
            permission.reason,
        }
      );

      return {
        success:
          false,

        completed:
          false,

        requiresConfirmation:
          false,

        decision:
          "deny",

        tool:
          name,

        risk:
          permission.risk,

        reason:
          permission.reason,
      };
    }

    // --------------------------------------------------------
    // Mark confirmed action
    // --------------------------------------------------------

    if (
      finalConfirmed &&
      typeof executionContext.markActionConfirmed ===
        "function"
    ) {
      executionContext.markActionConfirmed(
        name,
        validatedArgs
      );
    }

    // --------------------------------------------------------
    // Start event
    // --------------------------------------------------------

    const startedAt =
      Date.now();

    this._record(
      executionContext,
      "tool.execution_started",
      {
        tool:
          name,

        risk:
          permission.risk,
      }
    );

    // --------------------------------------------------------
    // Execute through registry
    // --------------------------------------------------------

    try {
      const result =
        await this.registry.execute({
          tool:
            name,

          args:
            validatedArgs,

          agentToken:
            typeof executionContext.getAgentToken ===
            "function"
              ? executionContext.getAgentToken()
              : "",
        });

      const durationMs =
        Date.now() -
        startedAt;

      const safeResult =
        sanitizeValue(
          result
        );

      this._record(
        executionContext,
        "tool.execution_completed",
        {
          tool:
            name,

          risk:
            permission.risk,

          durationMs,

          success:
            result?.success ===
            true,
        }
      );

      return {
        success:
          result?.success ===
          true,

        completed:
          result?.success ===
          true,

        tool:
          name,

        risk:
          permission.risk,

        durationMs,

        result:
          safeResult,
      };
    } catch (error) {
      const durationMs =
        Date.now() -
        startedAt;

      this._record(
        executionContext,
        "tool.execution_failed",
        {
          tool:
            name,

          risk:
            permission.risk,

          durationMs,

          error:
            error?.message ||
            String(error),
        }
      );

      return {
        success:
          false,

        completed:
          false,

        tool:
          name,

        risk:
          permission.risk,

        durationMs,

        error:
          error?.message ||
          String(error),

        errorCode:
          error?.code ||
          "ALEX_AGENT_TOOL_ERROR",
      };
    }
  }

  // ==========================================================
  // EXECUTE A LIST OF ACTIONS
  //
  // Useful later for:
  //   browser workflows
  //   form filling
  //   computer workflows
  //
  // Stops immediately when:
  //   - confirmation is required
  //   - permission is denied
  //   - action fails
  //   - context is cancelled
  // ==========================================================

  async executeSequence({
    context = null,
    actions = [],
    stopOnFailure = true,
  } = {}) {
    const executionContext =
      context ||
      this.createContext({
        goal:
          "Execute agent action sequence",
      });

    if (
      !Array.isArray(
        actions
      )
    ) {
      throw new Error(
        "Agent action sequence must be an array."
      );
    }

    if (
      actions.length ===
      0
    ) {
      return {
        success:
          true,

        completed:
          true,

        results: [],
      };
    }

    const results = [];

    for (
      let index = 0;
      index < actions.length;
      index++
    ) {
      if (
        typeof executionContext.throwIfCancelled ===
        "function"
      ) {
        executionContext.throwIfCancelled();
      }

      const action =
        actions[index];

      if (
        !action ||
        typeof action !==
          "object"
      ) {
        const invalidResult = {
          success:
            false,

          completed:
            false,

          error:
            `Action ${index + 1} is invalid.`,
        };

        results.push(
          invalidResult
        );

        if (
          stopOnFailure
        ) {
          break;
        }

        continue;
      }

      const result =
        await this.execute({
          context:
            executionContext,

          tool:
            action.tool,

          args:
            action.args || {},

          confirmed:
            action.confirmed ===
            true,

          confirmationReason:
            action.confirmationReason ||
            "",
        });

      results.push({
        index,
        ...result,
      });

      // ------------------------------------------------------
      // Stop on confirmation
      // ------------------------------------------------------

      if (
        result.requiresConfirmation
      ) {
        break;
      }

      // ------------------------------------------------------
      // Stop on failure
      // ------------------------------------------------------

      if (
        !result.success &&
        stopOnFailure
      ) {
        break;
      }
    }

    const completed =
      results.length ===
        actions.length &&
      results.every(
        (item) =>
          item.success ===
          true
      );

    return {
      success:
        completed,

      completed,

      results,
    };
  }

  // ==========================================================
  // EXECUTE WITH CONFIRMATION
  //
  // First call may return confirmation required.
  // Caller can then repeat with confirmed=true.
  // ==========================================================

  async executeConfirmed({
    context,
    tool,
    args = {},
    confirmationReason = "",
  } = {}) {
    return this.execute({
      context,
      tool,
      args,
      confirmed: true,
      confirmationReason,
    });
  }

  // ==========================================================
  // PRIVATE: HISTORY COUNT
  // ==========================================================

  _getToolCallCount(
    context
  ) {
    if (
      !context ||
      !Array.isArray(
        context.history
      )
    ) {
      return 0;
    }

    return context.history.filter(
      (event) =>
        event &&
        (
          event.type ===
            "tool.execution_started" ||
          event.type ===
            "tool.execution_completed" ||
          event.type ===
            "tool.execution_failed"
        )
    ).length;
  }

  // ==========================================================
  // PRIVATE: RECORD
  // ==========================================================

  _record(
    context,
    type,
    data = {}
  ) {
    if (
      context &&
      typeof context.record ===
        "function"
    ) {
      return context.record(
        type,
        data
      );
    }

    return null;
  }

  // ==========================================================
  // SAFE STATUS
  // ==========================================================

  getStatus(
    context
  ) {
    if (!context) {
      return {
        version:
          this.version,

        active:
          false,
      };
    }

    return {
      version:
        this.version,

      active:
        !(
          typeof context.isCancelled ===
            "function" &&
          context.isCancelled()
        ),

      context:
        typeof context.snapshot ===
        "function"
          ? context.snapshot()
          : null,

      availableTools:
        this.registry.listNames
          ? this.registry.listNames()
          : [],
    };
  }
}

// ============================================================
// SINGLETON
// ============================================================

let instance =
  null;

function getAgentOrchestrator(
  options = {}
) {
  if (!instance) {
    instance =
      new AgentOrchestrator(
        options
      );
  }

  return instance;
}

// ============================================================
// RESET FOR TESTS
// ============================================================

function resetAgentOrchestrator() {
  instance =
    null;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  ORCHESTRATOR_VERSION,

  AgentOrchestrator,

  getAgentOrchestrator,

  resetAgentOrchestrator,
};