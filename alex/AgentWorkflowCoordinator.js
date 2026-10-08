// ============================================================
// ALEX AGENT WORKFLOW COORDINATOR
// Version: 1.0.0
//
// Purpose:
//   High-level coordinator for:
//
//   Context
//      ↓
//   Action Plan
//      ↓
//   Workflow Engine
//      ↓
//   Verification
//      ↓
//   Recovery
//
// This layer coordinates the workflow components.
// It does NOT directly execute Windows tools.
// ============================================================

"use strict";

const {
  getAgentWorkflowEngine,
  WORKFLOW_STATUS,
} = require("./AgentWorkflowEngine");

const {
  getAgentWorkflowStore,
} = require("./AgentWorkflowStore");

const {
  getAgentWorkflowRecovery,
} = require("./AgentWorkflowRecovery");

const {
  createAgentExecutionContext,
} = require("./AgentExecutionContext");

const {
  createAgentActionPlan,
} = require("./AgentActionPlan");

// ============================================================
// CONSTANTS
// ============================================================

const AGENT_WORKFLOW_COORDINATOR_VERSION =
  "1.0.0";

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

// ============================================================
// COORDINATOR
// ============================================================

class AgentWorkflowCoordinator {
  constructor(options = {}) {
    this.version =
      AGENT_WORKFLOW_COORDINATOR_VERSION;

    this.workflowEngine =
      options.workflowEngine ||
      getAgentWorkflowEngine();

    this.workflowStore =
      options.workflowStore ||
      getAgentWorkflowStore();

    this.workflowRecovery =
      options.workflowRecovery ||
      getAgentWorkflowRecovery();

    this.active =
      new Map();
  }

  // ==========================================================
  // CREATE WORKFLOW
  // ==========================================================

  create({
    workflowId = null,
    taskId = null,
    ownerId = null,
    sessionId = null,
    goal = "",
    originalInput = "",
    maxSteps = 30,
    metadata = {},
    contextOptions = {},
    planOptions = {},
  } = {}) {
    const id =
      safeString(
        workflowId
      ) ||
      this._createWorkflowId();

    // --------------------------------------------------------
    // Context
    // --------------------------------------------------------

    const context =
      createAgentExecutionContext({
        ...safeObject(
          contextOptions
        ),

        taskId:
          taskId ||
          contextOptions.taskId ||
          null,

        ownerId:
          ownerId ||
          contextOptions.ownerId ||
          null,

        sessionId:
          sessionId ||
          contextOptions.sessionId ||
          null,

        goal:
          safeString(
            goal,
            contextOptions.goal ||
              ""
          ),

        originalInput:
          safeString(
            originalInput,
            contextOptions.originalInput ||
              ""
          ),

        maxSteps,

        metadata:
          safeObject(
            metadata
          ),
      });

    // --------------------------------------------------------
    // Plan
    // --------------------------------------------------------

    const plan =
      createAgentActionPlan({
        ...safeObject(
          planOptions
        ),

        planId:
          planOptions.planId ||
          `${id}_plan`,

        goal:
          safeString(
            goal,
            planOptions.goal ||
              ""
          ),

        taskId:
          taskId ||
          planOptions.taskId ||
          null,

        contextId:
          context.contextId,

        metadata: {
          ...safeObject(
            planOptions.metadata
          ),

          workflowId:
            id,
        },
      });

    // --------------------------------------------------------
    // Store
    // --------------------------------------------------------

    const stored =
      this.workflowStore.create({
        workflowId:
          id,

        planId:
          plan.planId,

        contextId:
          context.contextId,

        taskId:
          taskId ||
          null,

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

        metadata:
          safeObject(
            metadata
          ),
      });

    const workflow = {
      workflowId:
        id,

      context,

      plan,

      store:
        stored,

      createdAt:
        new Date().toISOString(),
    };

    this.active.set(
      id,
      workflow
    );

    return workflow;
  }

  // ==========================================================
  // ADD ACTION
  // ==========================================================

  addAction(
    workflowId,
    action
  ) {
    const workflow =
      this._getWorkflow(
        workflowId
      );

    if (!workflow) {
      throw new Error(
        `Workflow not found: ${workflowId}`
      );
    }

    if (
      !action ||
      typeof action !==
        "object"
    ) {
      throw new Error(
        "Action object is required."
      );
    }

    const added =
      workflow.plan.addAction(
        action
      );

    this.workflowStore.recordEvent(
      workflow.workflowId,
      "action_added",
      {
        actionId:
          added?.actionId ||
          action.actionId ||
          null,

        tool:
          added?.tool ||
          action.tool ||
          null,
      }
    );

    return added;
  }

  // ==========================================================
  // ADD MULTIPLE ACTIONS
  // ==========================================================

  addActions(
    workflowId,
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
          workflowId,
          action
        )
    );
  }

  // ==========================================================
  // RUN
  // ==========================================================

  async run(
    workflowId,
    options = {}
  ) {
    const workflow =
      this._getWorkflow(
        workflowId
      );

    if (!workflow) {
      throw new Error(
        `Workflow not found: ${workflowId}`
      );
    }

    this.workflowStore.setStatus(
      workflow.workflowId,
      "running"
    );

    this.workflowStore.recordEvent(
      workflow.workflowId,
      "execution_started",
      {
        actionCount:
          workflow.plan.actions.length,
      }
    );

    try {
      const result =
        await this.workflowEngine.run({
          plan:
            workflow.plan,

          context:
            workflow.context,

          options: {
            ...safeObject(
              options
            ),

            workflowId:
              workflow.workflowId,
          },
        });

      this._syncStore(
        workflow,
        result
      );

      return this._buildResponse(
        workflow,
        result
      );
    } catch (error) {
      this.workflowStore.setError(
        workflow.workflowId,
        error
      );

      throw error;
    }
  }

  // ==========================================================
  // RESUME
  // ==========================================================

  async resume(
    workflowId,
    options = {}
  ) {
    const workflow =
      this._getWorkflow(
        workflowId
      );

    if (!workflow) {
      throw new Error(
        `Workflow not found: ${workflowId}`
      );
    }

    this.workflowStore.recordEvent(
      workflow.workflowId,
      "resume_requested",
      {
        reason:
          safeString(
            options.reason
          ) ||
          null,
      }
    );

    try {
      const result =
        await this.workflowEngine.resume({
          plan:
            workflow.plan,

          context:
            workflow.context,

          options: {
            ...safeObject(
              options
            ),

            workflowId:
              workflow.workflowId,
          },
        });

      this._syncStore(
        workflow,
        result
      );

      return this._buildResponse(
        workflow,
        result
      );
    } catch (error) {
      this.workflowStore.setError(
        workflow.workflowId,
        error
      );

      throw error;
    }
  }

  // ==========================================================
  // RECOVER
  // ==========================================================

  recover(
    workflowId,
    options = {}
  ) {
    const workflow =
      this._getWorkflow(
        workflowId
      );

    const id =
      safeString(
        workflowId
      );

    if (!workflow && !id) {
      throw new Error(
        "workflowId is required."
      );
    }

    const target =
      workflow ||
      this.workflowStore.get(
        id
      );

    if (!target) {
      return {
        success: false,

        status:
          "failed",

        workflowId:
          id,

        reason:
          "Workflow not found.",
      };
    }

    const prepared =
      this.workflowRecovery.prepareRecovery(
        target.workflowId ||
          id,
        {
          reason:
            safeString(
              options.reason
            ) ||
            "Coordinator recovery request.",
        }
      );

    if (
      !prepared.success
    ) {
      return prepared;
    }

    this.workflowStore.recordEvent(
      target.workflowId ||
        id,
      "recovery_prepared",
      {
        recoveryId:
          prepared.recoveryId,

        attempt:
          prepared.attempt,
      }
    );

    return prepared;
  }

  // ==========================================================
  // RUN WITH AUTOMATIC RECOVERY
  // ==========================================================

  async runWithRecovery(
    workflowId,
    options = {}
  ) {
    const workflow =
      this._getWorkflow(
        workflowId
      );

    if (!workflow) {
      throw new Error(
        `Workflow not found: ${workflowId}`
      );
    }

    const maxRecoveryAttempts =
      Number.isInteger(
        options.maxRecoveryAttempts
      ) &&
      options.maxRecoveryAttempts > 0
        ? options.maxRecoveryAttempts
        : 1;

    let result =
      await this.run(
        workflowId,
        options
      );

    let recoveryAttempts = 0;

    while (
      !result.success &&
      !result.completed &&
      !result.paused &&
      recoveryAttempts <
        maxRecoveryAttempts
    ) {
      const inspection =
        this.workflowRecovery.inspect(
          workflowId
        );

      if (
        !inspection.recoverable ||
        inspection.blocked
      ) {
        break;
      }

      recoveryAttempts++;

      const recovery =
        this.recover(
          workflowId,
          {
            reason:
              `Automatic recovery attempt ${recoveryAttempts}.`,
          }
        );

      if (
        !recovery.success
      ) {
        break;
      }

      result =
        await this.resume(
          workflowId,
          {
            ...safeObject(
              options
            ),

            reason:
              `Recovered after failure. Attempt ${recoveryAttempts}.`,
          }
        );
    }

    return {
      ...result,

      recoveryAttempts,
    };
  }

  // ==========================================================
  // CANCEL
  // ==========================================================

  cancel(
    workflowId,
    reason =
      "Workflow cancelled by owner."
  ) {
    const workflow =
      this._getWorkflow(
        workflowId
      );

    if (!workflow) {
      throw new Error(
        `Workflow not found: ${workflowId}`
      );
    }

    const result =
      this.workflowEngine.cancel({
        plan:
          workflow.plan,

        context:
          workflow.context,

        workflowId:
          workflow.workflowId,

        reason,
      });

    this.workflowStore.setStatus(
      workflow.workflowId,
      "cancelled",
      {
        error:
          null,
      }
    );

    this.workflowStore.recordEvent(
      workflow.workflowId,
      "cancelled",
      {
        reason,
      }
    );

    return result;
  }

  // ==========================================================
  // STATUS
  // ==========================================================

  status(
    workflowId
  ) {
    const id =
      safeString(
        workflowId
      );

    if (!id) {
      return null;
    }

    const workflow =
      this._getWorkflow(id);

    if (workflow) {
      return {
        workflowId:
          id,

        status:
          this.workflowStore.get(
            id
          )?.status ||
          WORKFLOW_STATUS.UNKNOWN,

        plan:
          typeof workflow.plan.toJSON ===
          "function"
            ? workflow.plan.toJSON()
            : workflow.plan,

        context:
          typeof workflow.context.snapshot ===
          "function"
            ? workflow.context.snapshot()
            : workflow.context,

        store:
          this.workflowStore.snapshot(
            id
          ),
      };
    }

    return {
      workflowId:
        id,

      store:
        this.workflowStore.get(
          id
        ),

      recovery:
        this.workflowRecovery.getRecord(
          id
        ),
    };
  }

  // ==========================================================
  // LIST
  // ==========================================================

  list(
    options = {}
  ) {
    return this.workflowStore.list(
      options
    );
  }

  // ==========================================================
  // SNAPSHOT
  // ==========================================================

  snapshot(
    workflowId
  ) {
    const workflow =
      this._getWorkflow(
        workflowId
      );

    if (!workflow) {
      return null;
    }

    return {
      workflowId:
        workflow.workflowId,

      store:
        this.workflowStore.snapshot(
          workflow.workflowId
        ),

      context:
        typeof workflow.context.snapshot ===
        "function"
          ? workflow.context.snapshot()
          : workflow.context,

      plan:
        typeof workflow.plan.toJSON ===
        "function"
          ? workflow.plan.toJSON()
          : workflow.plan,

      recovery:
        this.workflowRecovery.getRecord(
          workflow.workflowId
        ),
    };
  }

  // ==========================================================
  // REMOVE
  // ==========================================================

  remove(
    workflowId
  ) {
    const id =
      safeString(
        workflowId
      );

    if (!id) {
      return false;
    }

    this.active.delete(
      id
    );

    return this.workflowStore.remove(
      id
    );
  }

  // ==========================================================
  // PRIVATE: GET
  // ==========================================================

  _getWorkflow(
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
      this.active.get(
        id
      ) || null
    );
  }

  // ==========================================================
  // PRIVATE: SYNC
  // ==========================================================

  _syncStore(
    workflow,
    result
  ) {
    if (
      !workflow ||
      !result
    ) {
      return;
    }

    const status =
      safeString(
        result.status
      );

    const statusMap = {
      completed:
        "completed",

      failed:
        "failed",

      verification_failed:
        "verification_failed",

      cancelled:
        "cancelled",

      waiting_confirmation:
        "waiting_confirmation",

      verifying:
        "verifying",

      running:
        "running",

      unknown:
        "unknown",
    };

    if (
      statusMap[status]
    ) {
      this.workflowStore.setStatus(
        workflow.workflowId,
        statusMap[status]
      );
    }

    if (
      result.execution
    ) {
      this.workflowStore.setResult(
        workflow.workflowId,
        result.execution
      );
    }

    if (
      result.verification
    ) {
      this.workflowStore.setVerification(
        workflow.workflowId,
        result.verification
      );
    }

    this.workflowStore.recordEvent(
      workflow.workflowId,
      "execution_updated",
      {
        status:
          status ||
          null,

        success:
          result.success ===
          true,

        completed:
          result.completed ===
          true,

        paused:
          result.paused ===
          true,
      }
    );
  }

  // ==========================================================
  // PRIVATE: RESPONSE
  // ==========================================================

  _buildResponse(
    workflow,
    result
  ) {
    return {
      ...result,

      workflowId:
        workflow.workflowId,

      planId:
        workflow.plan.planId,

      contextId:
        workflow.context.contextId,

      snapshot:
        this.snapshot(
          workflow.workflowId
        ),
    };
  }

  // ==========================================================
  // PRIVATE: ID
  // ==========================================================

  _createWorkflowId() {
    return [
      "workflow",
      Date.now(),
      Math.random()
        .toString(36)
        .slice(2, 10),
    ].join("_");
  }
}

// ============================================================
// SINGLETON
// ============================================================

let instance =
  null;

function getAgentWorkflowCoordinator(
  options = {}
) {
  if (!instance) {
    instance =
      new AgentWorkflowCoordinator(
        options
      );
  }

  return instance;
}

// ============================================================
// RESET
// ============================================================

function resetAgentWorkflowCoordinator() {
  instance =
    null;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  AGENT_WORKFLOW_COORDINATOR_VERSION,

  AgentWorkflowCoordinator,

  getAgentWorkflowCoordinator,

  resetAgentWorkflowCoordinator,
};