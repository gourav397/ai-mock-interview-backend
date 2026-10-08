// ============================================================
// ALEX AGENT PLAN EXECUTOR
// Version: 1.0.0
//
// Purpose:
//   Execute an AgentActionPlan through AgentOrchestrator.
//
// Flow:
//
//   AgentActionPlan
//        ↓
//   AgentPlanExecutor
//        ↓
//   AgentOrchestrator
//        ↓
//   AgentToolRegistry
//        ↓
//   WindowsAgent
//
// This file:
//   - executes one action at a time
//   - updates action status
//   - supports confirmation pauses
//   - supports cancellation
//   - records execution results
//   - does NOT bypass permission/security layers
//
// ============================================================

"use strict";

const {
  ACTION_STATUS,
  AgentActionPlan,
} = require("./AgentActionPlan");

const {
  getAgentOrchestrator,
} = require("./AgentOrchestrator");

// ============================================================
// CONSTANTS
// ============================================================

const PLAN_EXECUTOR_VERSION =
  "1.0.0";

const DEFAULT_STOP_ON_FAILURE =
  true;

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

// ============================================================
// AGENT PLAN EXECUTOR
// ============================================================

class AgentPlanExecutor {
  constructor(options = {}) {
    this.version =
      PLAN_EXECUTOR_VERSION;

    this.orchestrator =
      options.orchestrator ||
      getAgentOrchestrator();

    this.stopOnFailure =
      options.stopOnFailure !==
      undefined
        ? Boolean(
            options.stopOnFailure
          )
        : DEFAULT_STOP_ON_FAILURE;
  }

  // ==========================================================
  // EXECUTE PLAN
  // ==========================================================

  async execute(
    plan,
    context = null,
    options = {}
  ) {
    if (
      !plan ||
      !Array.isArray(
        plan.actions
      )
    ) {
      throw new Error(
        "A valid AgentActionPlan is required."
      );
    }

    const executionContext =
      context ||
      this.orchestrator.createContext({
        goal:
          plan.goal ||
          "Execute ALEX action plan",

        taskId:
          plan.taskId,

        contextId:
          plan.contextId,
      });

    const stopOnFailure =
      options.stopOnFailure !==
      undefined
        ? Boolean(
            options.stopOnFailure
          )
        : this.stopOnFailure;

    // --------------------------------------------------------
    // Validate plan
    // --------------------------------------------------------

    if (
      typeof plan.validate ===
      "function"
    ) {
      const validation =
        plan.validate();

      if (
        !validation.valid
      ) {
        throw new Error(
          `Invalid action plan: ${validation.errors.join(
            " "
          )}`
        );
      }
    }

    // --------------------------------------------------------
    // Start plan
    // --------------------------------------------------------

    plan.status =
      "running";

    if (
      typeof plan.touch ===
      "function"
    ) {
      plan.touch();
    }

    this._record(
      executionContext,
      "plan.execution_started",
      {
        planId:
          plan.planId,

        actionCount:
          plan.actions.length,
      }
    );

    const results = [];

    // --------------------------------------------------------
    // Execute sequentially
    // --------------------------------------------------------

    for (
      let index = 0;
      index < plan.actions.length;
      index++
    ) {
      this._throwIfCancelled(
        executionContext
      );

      const action =
        plan.actions[index];

      // ------------------------------------------------------
      // Skip already completed actions
      // ------------------------------------------------------

      if (
        action.status ===
        ACTION_STATUS.COMPLETED
      ) {
        results.push({
          actionId:
            action.actionId,

          index,

          success:
            true,

          skipped:
            true,

          reason:
            "Already completed.",
        });

        continue;
      }

      // ------------------------------------------------------
      // Skip cancelled/skipped actions
      // ------------------------------------------------------

      if (
        [
          ACTION_STATUS.CANCELLED,
          ACTION_STATUS.SKIPPED,
        ].includes(
          action.status
        )
      ) {
        results.push({
          actionId:
            action.actionId,

          index,

          success:
            false,

          skipped:
            true,

          reason:
            `Action status is ${action.status}.`,
        });

        if (
          stopOnFailure
        ) {
          break;
        }

        continue;
      }

      // ------------------------------------------------------
      // Mark running
      // ------------------------------------------------------

      plan.setActionStatus(
        action.actionId,
        ACTION_STATUS.RUNNING
      );

      this._record(
        executionContext,
        "plan.action_started",
        {
          planId:
            plan.planId,

          actionId:
            action.actionId,

          index,

          tool:
            action.tool,
        }
      );

      // ------------------------------------------------------
      // Execute
      // ------------------------------------------------------

      let result;

      try {
        result =
          await this.orchestrator.execute({
            context:
              executionContext,

            tool:
              action.tool,

            args:
              safeObject(
                action.args
              ),

            confirmed:
              action.confirmed ===
              true,

            confirmationReason:
              action.reason ||
              "",
          });
      } catch (error) {
        result = {
          success:
            false,

          completed:
            false,

          error:
            error?.message ||
            String(error),

          errorCode:
            error?.code ||
            "ALEX_PLAN_EXECUTION_ERROR",
        };
      }

      // ------------------------------------------------------
      // Confirmation required
      // ------------------------------------------------------

      if (
        result &&
        result.requiresConfirmation
      ) {
        plan.markWaitingConfirmation(
          action.actionId
        );

        this._record(
          executionContext,
          "plan.action_waiting_confirmation",
          {
            planId:
              plan.planId,

            actionId:
              action.actionId,

            tool:
              action.tool,
          }
        );

        results.push({
          actionId:
            action.actionId,

          index,

          ...result,
        });

        plan.status =
          "waiting_confirmation";

        if (
          typeof plan.touch ===
          "function"
        ) {
          plan.touch();
        }

        return this._buildResult({
          plan,
          results,
          completed:
            false,

          paused:
            true,

          reason:
            "confirmation_required",
        });
      }

      // ------------------------------------------------------
      // Successful action
      // ------------------------------------------------------

      if (
        result &&
        result.success
      ) {
        plan.markCompleted(
          action.actionId,
          result.result
        );

        this._record(
          executionContext,
          "plan.action_completed",
          {
            planId:
              plan.planId,

            actionId:
              action.actionId,

            tool:
              action.tool,
          }
        );

        results.push({
          actionId:
            action.actionId,

          index,

          ...result,
        });

        continue;
      }

      // ------------------------------------------------------
      // Failed action
      // ------------------------------------------------------

      plan.markFailed(
        action.actionId,
        result?.error ||
          "Agent action failed."
      );

      this._record(
        executionContext,
        "plan.action_failed",
        {
          planId:
            plan.planId,

          actionId:
            action.actionId,

          tool:
            action.tool,

          error:
            result?.error ||
            "Agent action failed.",
        }
      );

      results.push({
        actionId:
          action.actionId,

        index,

        ...(result || {
          success:
            false,

          completed:
            false,
        }),
      });

      if (
        stopOnFailure
      ) {
        break;
      }
    }

    // --------------------------------------------------------
    // Refresh plan status
    // --------------------------------------------------------

    if (
      typeof plan.refreshStatus ===
      "function"
    ) {
      plan.refreshStatus();
    }

    const completed =
      typeof plan.isCompleted ===
      "function"
        ? plan.isCompleted()
        : plan.actions.every(
            (action) =>
              action.status ===
              ACTION_STATUS.COMPLETED
          );

    const failed =
      typeof plan.hasFailed ===
      "function"
        ? plan.hasFailed()
        : plan.actions.some(
            (action) =>
              action.status ===
              ACTION_STATUS.FAILED
          );

    // --------------------------------------------------------
    // Final event
    // --------------------------------------------------------

    this._record(
      executionContext,
      "plan.execution_completed",
      {
        planId:
          plan.planId,

        completed,

        failed,

        actionCount:
          plan.actions.length,

        executedCount:
          results.length,
      }
    );

    return this._buildResult({
      plan,
      results,
      completed,
      paused:
        false,

      failed,
    });
  }

  // ==========================================================
  // RESUME AFTER CONFIRMATION
  // ==========================================================

  async resume(
    plan,
    context = null,
    options = {}
  ) {
    if (
      !plan ||
      !Array.isArray(
        plan.actions
      )
    ) {
      throw new Error(
        "A valid AgentActionPlan is required."
      );
    }

    const waitingAction =
      plan.actions.find(
        (action) =>
          action.status ===
          ACTION_STATUS.WAITING_CONFIRMATION
      );

    if (
      !waitingAction
    ) {
      return this.execute(
        plan,
        context,
        options
      );
    }

    // --------------------------------------------------------
    // Confirm the waiting action
    // --------------------------------------------------------

    waitingAction.confirmed =
      true;

    waitingAction.status =
      ACTION_STATUS.PENDING;

    waitingAction.error =
      null;

    waitingAction.completedAt =
      null;

    if (
      typeof plan.touch ===
      "function"
    ) {
      plan.touch();
    }

    this._record(
      context,
      "plan.confirmation_received",
      {
        planId:
          plan.planId,

        actionId:
          waitingAction.actionId,

        tool:
          waitingAction.tool,
      }
    );

    return this.execute(
      plan,
      context,
      {
        ...options,

        stopOnFailure:
          options.stopOnFailure !==
          undefined
            ? options.stopOnFailure
            : this.stopOnFailure,
      }
    );
  }

  // ==========================================================
  // CANCEL PLAN
  // ==========================================================

  cancel(
    plan,
    context = null,
    reason = "Plan cancelled."
  ) {
    if (
      !plan ||
      !Array.isArray(
        plan.actions
      )
    ) {
      throw new Error(
        "A valid AgentActionPlan is required."
      );
    }

    for (
      const action of plan.actions
    ) {
      if (
        [
          ACTION_STATUS.PENDING,
          ACTION_STATUS.WAITING_CONFIRMATION,
          ACTION_STATUS.RUNNING,
        ].includes(
          action.status
        )
      ) {
        plan.markCancelled(
          action.actionId
        );
      }
    }

    plan.status =
      "cancelled";

    if (
      typeof plan.touch ===
      "function"
    ) {
      plan.touch();
    }

    if (
      context &&
      typeof context.cancel ===
        "function"
    ) {
      context.cancel(
        reason
      );
    }

    this._record(
      context,
      "plan.cancelled",
      {
        planId:
          plan.planId,

        reason,
      }
    );

    return {
      success:
        true,

      cancelled:
        true,

      planId:
        plan.planId,

      reason,
    };
  }

  // ==========================================================
  // PREVIEW
  // ==========================================================

  preview(
    plan
  ) {
    if (
      !plan ||
      !Array.isArray(
        plan.actions
      )
    ) {
      throw new Error(
        "A valid AgentActionPlan is required."
      );
    }

    return {
      version:
        this.version,

      planId:
        plan.planId,

      goal:
        plan.goal,

      status:
        plan.status,

      actions:
        plan.actions.map(
          (action, index) => ({
            index,

            actionId:
              action.actionId,

            tool:
              action.tool,

            args:
              safeObject(
                action.args
              ),

            reason:
              action.reason,

            status:
              action.status,

            confirmed:
              action.confirmed ===
              true,
          })
        ),
    };
  }

  // ==========================================================
  // PRIVATE: CANCELLATION
  // ==========================================================

  _throwIfCancelled(
    context
  ) {
    if (
      context &&
      typeof context.throwIfCancelled ===
        "function"
    ) {
      context.throwIfCancelled();
    }

    if (
      context &&
      typeof context.isCancelled ===
        "function" &&
      context.isCancelled()
    ) {
      const error =
        new Error(
          "ALEX agent execution was cancelled."
        );

      error.code =
        "ALEX_AGENT_CANCELLED";

      throw error;
    }
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
  // PRIVATE: RESULT
  // ==========================================================

  _buildResult({
    plan,
    results,
    completed,
    paused,
    failed = false,
    reason = null,
  }) {
    return {
      success:
        completed ===
        true,

      completed:
        completed ===
        true,

      paused:
        paused ===
        true,

      failed:
        failed ===
        true,

      reason,

      executorVersion:
        this.version,

      planId:
        plan.planId,

      status:
        plan.status,

      actionCount:
        plan.actions.length,

      executedCount:
        results.length,

      results,

      plan:
        typeof plan.toJSON ===
        "function"
          ? plan.toJSON()
          : plan,
    };
  }
}

// ============================================================
// SINGLETON
// ============================================================

let instance =
  null;

function getAgentPlanExecutor(
  options = {}
) {
  if (!instance) {
    instance =
      new AgentPlanExecutor(
        options
      );
  }

  return instance;
}

// ============================================================
// RESET
// ============================================================

function resetAgentPlanExecutor() {
  instance =
    null;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  PLAN_EXECUTOR_VERSION,

  AgentPlanExecutor,

  getAgentPlanExecutor,

  resetAgentPlanExecutor,
};