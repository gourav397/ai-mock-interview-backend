// ============================================================
// ALEX AGENT WORKFLOW ENGINE
// Version: 1.0.0
//
// Purpose:
//   Coordinate:
//
//   AgentActionPlan
//        ↓
//   AgentPlanExecutor
//        ↓
//   AgentExecutionVerifier
//        ↓
//   final workflow result
//
// This file does NOT directly execute Windows tools.
// ============================================================

"use strict";

const {
  ACTION_STATUS,
} = require("./AgentActionPlan");

const {
  getAgentPlanExecutor,
} = require("./AgentPlanExecutor");

const {
  getAgentExecutionVerifier,
} = require("./AgentExecutionVerifier");

// ============================================================
// CONSTANTS
// ============================================================

const AGENT_WORKFLOW_VERSION =
  "1.0.0";

const WORKFLOW_STATUS =
  Object.freeze({
    IDLE:
      "idle",

    RUNNING:
      "running",

    WAITING_CONFIRMATION:
      "waiting_confirmation",

    VERIFYING:
      "verifying",

    COMPLETED:
      "completed",

    FAILED:
      "failed",

    VERIFICATION_FAILED:
      "verification_failed",

    UNKNOWN:
      "unknown",

    CANCELLED:
      "cancelled",
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
// WORKFLOW ENGINE
// ============================================================

class AgentWorkflowEngine {
  constructor(options = {}) {
    this.version =
      AGENT_WORKFLOW_VERSION;

    this.planExecutor =
      options.planExecutor ||
      getAgentPlanExecutor();

    this.executionVerifier =
      options.executionVerifier ||
      getAgentExecutionVerifier();

    this.activeWorkflows =
      new Map();
  }

  // ==========================================================
  // START WORKFLOW
  // ==========================================================

  async run({
    plan = null,
    context = null,
    options = {},
  } = {}) {
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

    const workflowId =
      safeString(
        options.workflowId
      ) ||
      plan.planId;

    this._setWorkflowState(
      workflowId,
      {
        status:
          WORKFLOW_STATUS.RUNNING,

        planId:
          plan.planId,

        startedAt:
          new Date().toISOString(),
      }
    );

    try {
      // ------------------------------------------------------
      // Execute plan
      // ------------------------------------------------------

      const execution =
        await this.planExecutor.execute(
          plan,
          context,
          {
            stopOnFailure:
              options.stopOnFailure !==
              undefined
                ? options.stopOnFailure
                : true,
          }
        );

      // ------------------------------------------------------
      // Confirmation required
      // ------------------------------------------------------

      if (
        execution?.paused &&
        execution?.reason ===
          "confirmation_required"
      ) {
        this._setWorkflowState(
          workflowId,
          {
            status:
              WORKFLOW_STATUS.WAITING_CONFIRMATION,

            planId:
              plan.planId,
          }
        );

        return {
          success:
            false,

          completed:
            false,

          paused:
            true,

          status:
            WORKFLOW_STATUS.WAITING_CONFIRMATION,

          workflowId,

          planId:
            plan.planId,

          execution,
        };
      }

      // ------------------------------------------------------
      // Execution failed
      // ------------------------------------------------------

      if (
        execution?.failed &&
        !execution?.completed
      ) {
        this._setWorkflowState(
          workflowId,
          {
            status:
              WORKFLOW_STATUS.FAILED,

            planId:
              plan.planId,
          }
        );

        return {
          success:
            false,

          completed:
            false,

          paused:
            false,

          status:
            WORKFLOW_STATUS.FAILED,

          workflowId,

          planId:
            plan.planId,

          execution,
        };
      }

      // ------------------------------------------------------
      // Verify
      // ------------------------------------------------------

      this._setWorkflowState(
        workflowId,
        {
          status:
            WORKFLOW_STATUS.VERIFYING,

          planId:
            plan.planId,
        }
      );

      const verification =
        this.executionVerifier.verifyAndUpdatePlan({
          plan,

          results:
            execution?.results ||
            [],

          context,
        });

      // ------------------------------------------------------
      // Verified
      // ------------------------------------------------------

      if (
        verification.verified
      ) {
        plan.status =
          "completed";

        if (
          typeof plan.touch ===
          "function"
        ) {
          plan.touch();
        }

        this._setWorkflowState(
          workflowId,
          {
            status:
              WORKFLOW_STATUS.COMPLETED,

            planId:
              plan.planId,

            completedAt:
              new Date().toISOString(),
          }
        );

        return {
          success:
            true,

          completed:
            true,

          paused:
            false,

          status:
            WORKFLOW_STATUS.COMPLETED,

          workflowId,

          planId:
            plan.planId,

          execution,

          verification,
        };
      }

      // ------------------------------------------------------
      // Verification failed
      // ------------------------------------------------------

      if (
        verification.status ===
        "failed"
      ) {
        plan.status =
          "verification_failed";

        if (
          typeof plan.touch ===
          "function"
        ) {
          plan.touch();
        }

        this._setWorkflowState(
          workflowId,
          {
            status:
              WORKFLOW_STATUS.VERIFICATION_FAILED,

            planId:
              plan.planId,
          }
        );

        return {
          success:
            false,

          completed:
            false,

          paused:
            false,

          status:
            WORKFLOW_STATUS.VERIFICATION_FAILED,

          workflowId,

          planId:
            plan.planId,

          execution,

          verification,
        };
      }

      // ------------------------------------------------------
      // Verification unknown
      // ------------------------------------------------------

      plan.status =
        "verification_unknown";

      if (
        typeof plan.touch ===
        "function"
      ) {
        plan.touch();
      }

      this._setWorkflowState(
        workflowId,
        {
          status:
            WORKFLOW_STATUS.UNKNOWN,

          planId:
            plan.planId,
        }
      );

      return {
        success:
          false,

        completed:
          false,

        paused:
          false,

        status:
          WORKFLOW_STATUS.UNKNOWN,

        workflowId,

        planId:
          plan.planId,

        execution,

        verification,
      };
    } catch (error) {
      this._setWorkflowState(
        workflowId,
        {
          status:
            error?.code ===
            "ALEX_AGENT_CANCELLED"
              ? WORKFLOW_STATUS.CANCELLED
              : WORKFLOW_STATUS.FAILED,

          planId:
            plan.planId,

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

        paused:
          false,

        status:
          error?.code ===
          "ALEX_AGENT_CANCELLED"
            ? WORKFLOW_STATUS.CANCELLED
            : WORKFLOW_STATUS.FAILED,

        workflowId,

        planId:
          plan.planId,

        error:
          error?.message ||
          String(error),

        errorCode:
          error?.code ||
          "ALEX_WORKFLOW_ERROR",
      };
    }
  }

  // ==========================================================
  // RESUME WORKFLOW
  // ==========================================================

  async resume({
    plan = null,
    context = null,
    options = {},
  } = {}) {
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

    const workflowId =
      safeString(
        options.workflowId
      ) ||
      plan.planId;

    this._setWorkflowState(
      workflowId,
      {
        status:
          WORKFLOW_STATUS.RUNNING,

        planId:
          plan.planId,
      }
    );

    try {
      const execution =
        await this.planExecutor.resume(
          plan,
          context,
          {
            stopOnFailure:
              options.stopOnFailure !==
              undefined
                ? options.stopOnFailure
                : true,
          }
        );

      // ------------------------------------------------------
      // Still waiting for confirmation
      // ------------------------------------------------------

      if (
        execution?.paused
      ) {
        this._setWorkflowState(
          workflowId,
          {
            status:
              WORKFLOW_STATUS.WAITING_CONFIRMATION,

            planId:
              plan.planId,
          }
        );

        return {
          success:
            false,

          completed:
            false,

          paused:
            true,

          status:
            WORKFLOW_STATUS.WAITING_CONFIRMATION,

          workflowId,

          planId:
            plan.planId,

          execution,
        };
      }

      // ------------------------------------------------------
      // Execution failed
      // ------------------------------------------------------

      if (
        execution?.failed &&
        !execution?.completed
      ) {
        this._setWorkflowState(
          workflowId,
          {
            status:
              WORKFLOW_STATUS.FAILED,

            planId:
              plan.planId,
          }
        );

        return {
          success:
            false,

          completed:
            false,

          paused:
            false,

          status:
            WORKFLOW_STATUS.FAILED,

          workflowId,

          planId:
            plan.planId,

          execution,
        };
      }

      // ------------------------------------------------------
      // Verify resumed execution
      // ------------------------------------------------------

      this._setWorkflowState(
        workflowId,
        {
          status:
            WORKFLOW_STATUS.VERIFYING,

          planId:
            plan.planId,
        }
      );

      const verification =
        this.executionVerifier.verifyAndUpdatePlan({
          plan,

          results:
            execution?.results ||
            [],

          context,
        });

      if (
        verification.verified
      ) {
        plan.status =
          "completed";

        if (
          typeof plan.touch ===
          "function"
        ) {
          plan.touch();
        }

        this._setWorkflowState(
          workflowId,
          {
            status:
              WORKFLOW_STATUS.COMPLETED,

            planId:
              plan.planId,

            completedAt:
              new Date().toISOString(),
          }
        );

        return {
          success:
            true,

          completed:
            true,

          paused:
            false,

          status:
            WORKFLOW_STATUS.COMPLETED,

          workflowId,

          planId:
            plan.planId,

          execution,

          verification,
        };
      }

      if (
        verification.status ===
        "failed"
      ) {
        this._setWorkflowState(
          workflowId,
          {
            status:
              WORKFLOW_STATUS.VERIFICATION_FAILED,

            planId:
              plan.planId,
          }
        );

        return {
          success:
            false,

          completed:
            false,

          paused:
            false,

          status:
            WORKFLOW_STATUS.VERIFICATION_FAILED,

          workflowId,

          planId:
            plan.planId,

          execution,

          verification,
        };
      }

      this._setWorkflowState(
        workflowId,
        {
          status:
            WORKFLOW_STATUS.UNKNOWN,

          planId:
            plan.planId,
        }
      );

      return {
        success:
          false,

        completed:
          false,

        paused:
          false,

        status:
          WORKFLOW_STATUS.UNKNOWN,

        workflowId,

        planId:
          plan.planId,

        execution,

        verification,
      };
    } catch (error) {
      this._setWorkflowState(
        workflowId,
        {
          status:
            error?.code ===
            "ALEX_AGENT_CANCELLED"
              ? WORKFLOW_STATUS.CANCELLED
              : WORKFLOW_STATUS.FAILED,

          planId:
            plan.planId,

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

        paused:
          false,

        status:
          error?.code ===
          "ALEX_AGENT_CANCELLED"
            ? WORKFLOW_STATUS.CANCELLED
            : WORKFLOW_STATUS.FAILED,

        workflowId,

        planId:
          plan.planId,

        error:
          error?.message ||
          String(error),

        errorCode:
          error?.code ||
          "ALEX_WORKFLOW_ERROR",
      };
    }
  }

  // ==========================================================
  // CANCEL WORKFLOW
  // ==========================================================

  cancel({
    plan = null,
    context = null,
    workflowId = null,
    reason =
      "Workflow cancelled.",
  } = {}) {
    const id =
      safeString(
        workflowId
      ) ||
      plan?.planId;

    if (!id) {
      throw new Error(
        "Workflow ID or plan is required."
      );
    }

    let result =
      null;

    if (
      plan
    ) {
      result =
        this.planExecutor.cancel(
          plan,
          context,
          reason
        );
    } else if (
      context &&
      typeof context.cancel ===
        "function"
    ) {
      context.cancel(
        reason
      );

      result = {
        success:
          true,

        cancelled:
          true,

        workflowId:
          id,

        reason,
      };
    } else {
      result = {
        success:
          false,

        cancelled:
          false,

        workflowId:
          id,

        reason:
          "No plan or execution context was supplied.",
      };
    }

    this._setWorkflowState(
      id,
      {
        status:
          WORKFLOW_STATUS.CANCELLED,

        reason,
      }
    );

    return result;
  }

  // ==========================================================
  // GET WORKFLOW STATUS
  // ==========================================================

  getStatus(
    workflowId
  ) {
    const id =
      safeString(
        workflowId
      );

    if (!id) {
      return null;
    }

    return (
      this.activeWorkflows.get(
        id
      ) || null
    );
  }

  // ==========================================================
  // LIST ACTIVE WORKFLOWS
  // ==========================================================

  listWorkflows() {
    return Array.from(
      this.activeWorkflows.entries()
    ).map(
      ([workflowId, state]) => ({
        workflowId,

        ...state,
      })
    );
  }

  // ==========================================================
  // REMOVE WORKFLOW STATE
  // ==========================================================

  removeWorkflow(
    workflowId
  ) {
    const id =
      safeString(
        workflowId
      );

    if (!id) {
      return false;
    }

    return this.activeWorkflows.delete(
      id
    );
  }

  // ==========================================================
  // PRIVATE STATE UPDATE
  // ==========================================================

  _setWorkflowState(
    workflowId,
    updates = {}
  ) {
    const id =
      safeString(
        workflowId
      );

    if (!id) {
      return null;
    }

    const previous =
      this.activeWorkflows.get(
        id
      ) || {
        workflowId:
          id,

        createdAt:
          new Date().toISOString(),
      };

    const next = {
      ...previous,

      ...safeObject(
        updates
      ),

      workflowId:
        id,

      updatedAt:
        new Date().toISOString(),
    };

    this.activeWorkflows.set(
      id,
      next
    );

    return next;
  }
}

// ============================================================
// SINGLETON
// ============================================================

let instance =
  null;

function getAgentWorkflowEngine(
  options = {}
) {
  if (!instance) {
    instance =
      new AgentWorkflowEngine(
        options
      );
  }

  return instance;
}

// ============================================================
// RESET
// ============================================================

function resetAgentWorkflowEngine() {
  instance =
    null;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  AGENT_WORKFLOW_VERSION,

  WORKFLOW_STATUS,

  AgentWorkflowEngine,

  getAgentWorkflowEngine,

  resetAgentWorkflowEngine,
};