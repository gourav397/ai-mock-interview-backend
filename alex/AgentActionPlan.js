// ============================================================
// ALEX AGENT ACTION PLAN
// Version: 1.0.0
//
// Purpose:
//   Normalize and validate actions before they reach
//   AgentOrchestrator.
//
// Flow:
//
//   User Goal
//      ↓
//   Planner
//      ↓
//   AgentActionPlan
//      ↓
//   AgentOrchestrator
//      ↓
//   AgentToolRegistry
//
// This file does NOT execute tools.
// ============================================================

"use strict";

// ============================================================
// CONSTANTS
// ============================================================

const ACTION_PLAN_VERSION =
  "1.0.0";

const DEFAULT_MAX_ACTIONS =
  30;

const MAX_ACTIONS_LIMIT =
  100;

const MAX_TOOL_NAME_LENGTH =
  150;

const MAX_REASON_LENGTH =
  1000;

const MAX_ACTION_ID_LENGTH =
  100;

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

function cloneObject(
  value
) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return {};
  }

  return {
    ...value,
  };
}

function createId() {
  return (
    "action_" +
    Date.now().toString(36) +
    "_" +
    Math.random()
      .toString(36)
      .slice(2, 10)
  );
}

// ============================================================
// ACTION STATES
// ============================================================

const ACTION_STATUS = Object.freeze({
  PENDING:
    "pending",

  RUNNING:
    "running",

  COMPLETED:
    "completed",

  FAILED:
    "failed",

  SKIPPED:
    "skipped",

  CANCELLED:
    "cancelled",

  WAITING_CONFIRMATION:
    "waiting_confirmation",
});

// ============================================================
// ACTION PLAN
// ============================================================

class AgentActionPlan {
  constructor(options = {}) {
    this.version =
      ACTION_PLAN_VERSION;

    this.planId =
      safeString(
        options.planId
      ) ||
      createId();

    this.goal =
      safeString(
        options.goal
      );

    this.description =
      safeString(
        options.description
      );

    this.source =
      safeString(
        options.source,
        "alex"
      );

    this.taskId =
      safeString(
        options.taskId
      ) || null;

    this.contextId =
      safeString(
        options.contextId
      ) || null;

    this.maxActions =
      this._normalizeMaxActions(
        options.maxActions
      );

    this.status =
      "pending";

    this.createdAt =
      new Date().toISOString();

    this.updatedAt =
      this.createdAt;

    this.actions = [];

    this.metadata =
      cloneObject(
        options.metadata
      );

    if (
      Array.isArray(
        options.actions
      )
    ) {
      for (
        const action of options.actions
      ) {
        this.addAction(
          action
        );
      }
    }
  }

  // ==========================================================
  // ADD ACTION
  // ==========================================================

  addAction(
    action = {}
  ) {
    if (
      this.actions.length >=
      this.maxActions
    ) {
      const error =
        new Error(
          `Maximum action limit (${this.maxActions}) reached.`
        );

      error.code =
        "ALEX_ACTION_PLAN_LIMIT";

      throw error;
    }

    const normalized =
      this.normalizeAction(
        action,
        this.actions.length
      );

    this.actions.push(
      normalized
    );

    this.touch();

    return normalized;
  }

  // ==========================================================
  // INSERT ACTION
  // ==========================================================

  insertAction(
    index,
    action = {}
  ) {
    if (
      this.actions.length >=
      this.maxActions
    ) {
      throw new Error(
        `Maximum action limit (${this.maxActions}) reached.`
      );
    }

    const normalized =
      this.normalizeAction(
        action,
        index
      );

    const safeIndex =
      Math.max(
        0,
        Math.min(
          Number(index) || 0,
          this.actions.length
        )
      );

    this.actions.splice(
      safeIndex,
      0,
      normalized
    );

    this._reindex();

    this.touch();

    return normalized;
  }

  // ==========================================================
  // NORMALIZE ACTION
  // ==========================================================

  normalizeAction(
    action = {},
    index = 0
  ) {
    if (
      !action ||
      typeof action !==
        "object" ||
      Array.isArray(action)
    ) {
      throw new Error(
        "Agent action must be an object."
      );
    }

    const tool =
      safeString(
        action.tool
      );

    if (!tool) {
      throw new Error(
        "Agent action tool is required."
      );
    }

    if (
      tool.length >
      MAX_TOOL_NAME_LENGTH
    ) {
      throw new Error(
        "Agent action tool name is too long."
      );
    }

    const actionId =
      safeString(
        action.actionId
      ) ||
      safeString(
        action.id
      ) ||
      createId();

    if (
      actionId.length >
      MAX_ACTION_ID_LENGTH
    ) {
      throw new Error(
        "Agent action ID is too long."
      );
    }

    const reason =
      safeString(
        action.reason
      );

    if (
      reason.length >
      MAX_REASON_LENGTH
    ) {
      throw new Error(
        "Agent action reason is too long."
      );
    }

    const normalizedArgs =
      cloneObject(
        action.args
      );

    return {
      actionId,

      index:
        Number.isInteger(
          index
        )
          ? index
          : 0,

      tool,

      args:
        normalizedArgs,

      reason,

      confirmed:
        action.confirmed ===
        true,

      status:
        Object.values(
          ACTION_STATUS
        ).includes(
          action.status
        )
          ? action.status
          : ACTION_STATUS.PENDING,

      result:
        null,

      error:
        null,

      createdAt:
        action.createdAt ||
        new Date().toISOString(),

      startedAt:
        action.startedAt ||
        null,

      completedAt:
        action.completedAt ||
        null,

      metadata:
        cloneObject(
          action.metadata
        ),
    };
  }

  // ==========================================================
  // GET ACTION
  // ==========================================================

  getAction(
    index
  ) {
    const numericIndex =
      Number(index);

    if (
      !Number.isInteger(
        numericIndex
      )
    ) {
      return null;
    }

    return (
      this.actions[
        numericIndex
      ] || null
    );
  }

  // ==========================================================
  // GET BY ID
  // ==========================================================

  getActionById(
    actionId
  ) {
    const id =
      safeString(
        actionId
      );

    if (!id) {
      return null;
    }

    return (
      this.actions.find(
        (action) =>
          action.actionId ===
          id
      ) || null
    );
  }

  // ==========================================================
  // UPDATE ACTION
  // ==========================================================

  updateAction(
    actionId,
    updates = {}
  ) {
    const action =
      this.getActionById(
        actionId
      );

    if (!action) {
      return null;
    }

    if (
      updates.tool !==
      undefined
    ) {
      const tool =
        safeString(
          updates.tool
        );

      if (!tool) {
        throw new Error(
          "Updated action tool cannot be empty."
        );
      }

      action.tool =
        tool;
    }

    if (
      updates.args !==
      undefined
    ) {
      action.args =
        cloneObject(
          updates.args
        );
    }

    if (
      updates.reason !==
      undefined
    ) {
      action.reason =
        safeString(
          updates.reason
        ).slice(
          0,
          MAX_REASON_LENGTH
        );
    }

    if (
      updates.confirmed !==
      undefined
    ) {
      action.confirmed =
        updates.confirmed ===
        true;
    }

    if (
      updates.metadata !==
      undefined
    ) {
      action.metadata =
        cloneObject(
          updates.metadata
        );
    }

    if (
      updates.status !==
      undefined
    ) {
      this.setActionStatus(
        actionId,
        updates.status
      );
    }

    if (
      updates.result !==
      undefined
    ) {
      action.result =
        updates.result;
    }

    if (
      updates.error !==
      undefined
    ) {
      action.error =
        updates.error;
    }

    this.touch();

    return action;
  }

  // ==========================================================
  // SET ACTION STATUS
  // ==========================================================

  setActionStatus(
    actionId,
    status
  ) {
    const action =
      this.getActionById(
        actionId
      );

    if (!action) {
      return null;
    }

    if (
      !Object.values(
        ACTION_STATUS
      ).includes(status)
    ) {
      throw new Error(
        `Invalid action status: ${status}`
      );
    }

    action.status =
      status;

    if (
      status ===
      ACTION_STATUS.RUNNING
    ) {
      action.startedAt =
        new Date().toISOString();
    }

    if (
      [
        ACTION_STATUS.COMPLETED,
        ACTION_STATUS.FAILED,
        ACTION_STATUS.SKIPPED,
        ACTION_STATUS.CANCELLED,
      ].includes(
        status
      )
    ) {
      action.completedAt =
        new Date().toISOString();
    }

    this.touch();

    return action;
  }

  // ==========================================================
  // MARK COMPLETED
  // ==========================================================

  markCompleted(
    actionId,
    result = null
  ) {
    const action =
      this.getActionById(
        actionId
      );

    if (!action) {
      return null;
    }

    action.result =
      result;

    action.error =
      null;

    return this.setActionStatus(
      actionId,
      ACTION_STATUS.COMPLETED
    );
  }

  // ==========================================================
  // MARK FAILED
  // ==========================================================

  markFailed(
    actionId,
    error
  ) {
    const action =
      this.getActionById(
        actionId
      );

    if (!action) {
      return null;
    }

    action.error =
      safeString(
        error?.message ||
        error
      ).slice(
        0,
        5000
      );

    return this.setActionStatus(
      actionId,
      ACTION_STATUS.FAILED
    );
  }

  // ==========================================================
  // MARK WAITING CONFIRMATION
  // ==========================================================

  markWaitingConfirmation(
    actionId
  ) {
    return this.setActionStatus(
      actionId,
      ACTION_STATUS.WAITING_CONFIRMATION
    );
  }

  // ==========================================================
  // MARK CANCELLED
  // ==========================================================

  markCancelled(
    actionId
  ) {
    return this.setActionStatus(
      actionId,
      ACTION_STATUS.CANCELLED
    );
  }

  // ==========================================================
  // REMOVE ACTION
  // ==========================================================

  removeAction(
    actionId
  ) {
    const index =
      this.actions.findIndex(
        (action) =>
          action.actionId ===
          actionId
      );

    if (
      index === -1
    ) {
      return false;
    }

    this.actions.splice(
      index,
      1
    );

    this._reindex();

    this.touch();

    return true;
  }

  // ==========================================================
  // CLEAR ACTIONS
  // ==========================================================

  clearActions() {
    this.actions = [];

    this.status =
      "pending";

    this.touch();

    return true;
  }

  // ==========================================================
  // PLAN STATUS
  // ==========================================================

  refreshStatus() {
    if (
      this.actions.length ===
      0
    ) {
      this.status =
        "pending";

      return this.status;
    }

    const statuses =
      this.actions.map(
        (action) =>
          action.status
      );

    if (
      statuses.includes(
        ACTION_STATUS.RUNNING
      )
    ) {
      this.status =
        "running";

      return this.status;
    }

    if (
      statuses.includes(
        ACTION_STATUS.WAITING_CONFIRMATION
      )
    ) {
      this.status =
        "waiting_confirmation";

      return this.status;
    }

    if (
      statuses.every(
        (status) =>
          status ===
          ACTION_STATUS.COMPLETED
      )
    ) {
      this.status =
        "completed";

      return this.status;
    }

    if (
      statuses.every(
        (status) =>
          [
            ACTION_STATUS.FAILED,
            ACTION_STATUS.CANCELLED,
            ACTION_STATUS.SKIPPED,
          ].includes(
            status
          )
      )
    ) {
      this.status =
        "failed";

      return this.status;
    }

    if (
      statuses.includes(
        ACTION_STATUS.FAILED
      )
    ) {
      this.status =
        "failed";

      return this.status;
    }

    this.status =
      "running";

    return this.status;
  }

  // ==========================================================
  // PENDING ACTIONS
  // ==========================================================

  getPendingActions() {
    return this.actions.filter(
      (action) =>
        action.status ===
        ACTION_STATUS.PENDING
    );
  }

  // ==========================================================
  // NEXT ACTION
  // ==========================================================

  getNextAction() {
    return (
      this.actions.find(
        (action) =>
          action.status ===
          ACTION_STATUS.PENDING
      ) || null
    );
  }

  // ==========================================================
  // COMPLETION CHECK
  // ==========================================================

  isCompleted() {
    return (
      this.actions.length >
        0 &&
      this.actions.every(
        (action) =>
          action.status ===
          ACTION_STATUS.COMPLETED
      )
    );
  }

  // ==========================================================
  // FAILURE CHECK
  // ==========================================================

  hasFailed() {
    return this.actions.some(
      (action) =>
        action.status ===
        ACTION_STATUS.FAILED
    );
  }

  // ==========================================================
  // CONFIRMATION CHECK
  // ==========================================================

  needsConfirmation() {
    return this.actions.some(
      (action) =>
        action.status ===
        ACTION_STATUS.WAITING_CONFIRMATION
    );
  }

  // ==========================================================
  // VALIDATE PLAN
  // ==========================================================

  validate() {
    const errors = [];

    if (!this.goal) {
      errors.push(
        "Plan goal is required."
      );
    }

    if (
      this.actions.length ===
      0
    ) {
      errors.push(
        "Plan contains no actions."
      );
    }

    if (
      this.actions.length >
      this.maxActions
    ) {
      errors.push(
        `Plan contains more than ${this.maxActions} actions.`
      );
    }

    const ids =
      new Set();

    for (
      const action of this.actions
    ) {
      if (
        ids.has(
          action.actionId
        )
      ) {
        errors.push(
          `Duplicate action ID: ${action.actionId}`
        );
      }

      ids.add(
        action.actionId
      );

      if (!action.tool) {
        errors.push(
          `Action ${action.index} has no tool.`
        );
      }

      if (
        !action.args ||
        typeof action.args !==
          "object" ||
        Array.isArray(
          action.args
        )
      ) {
        errors.push(
          `Action ${action.index} has invalid args.`
        );
      }
    }

    return {
      valid:
        errors.length ===
        0,

      errors,
    };
  }

  // ==========================================================
  // CLONE
  // ==========================================================

  clone() {
    return new AgentActionPlan({
      planId:
        this.planId,

      goal:
        this.goal,

      description:
        this.description,

      source:
        this.source,

      taskId:
        this.taskId,

      contextId:
        this.contextId,

      maxActions:
        this.maxActions,

      metadata:
        cloneObject(
          this.metadata
        ),

      actions:
        this.actions.map(
          (action) => ({
            ...action,

            args:
              cloneObject(
                action.args
              ),

            metadata:
              cloneObject(
                action.metadata
              ),
          })
        ),
    });
  }

  // ==========================================================
  // SERIALIZE
  // ==========================================================

  toJSON() {
    this.refreshStatus();

    return {
      version:
        this.version,

      planId:
        this.planId,

      goal:
        this.goal,

      description:
        this.description,

      source:
        this.source,

      taskId:
        this.taskId,

      contextId:
        this.contextId,

      maxActions:
        this.maxActions,

      status:
        this.status,

      createdAt:
        this.createdAt,

      updatedAt:
        this.updatedAt,

      actionCount:
        this.actions.length,

      completedCount:
        this.actions.filter(
          (action) =>
            action.status ===
            ACTION_STATUS.COMPLETED
        ).length,

      failedCount:
        this.actions.filter(
          (action) =>
            action.status ===
            ACTION_STATUS.FAILED
        ).length,

      actions:
        this.actions.map(
          (action) => ({
            ...action,

            args:
              cloneObject(
                action.args
              ),

            metadata:
              cloneObject(
                action.metadata
              ),
          })
        ),

      metadata:
        cloneObject(
          this.metadata
        ),
    };
  }

  // ==========================================================
  // UPDATE TIMESTAMP
  // ==========================================================

  touch() {
    this.updatedAt =
      new Date().toISOString();

    return this.updatedAt;
  }

  // ==========================================================
  // NORMALIZE MAX ACTIONS
  // ==========================================================

  _normalizeMaxActions(
    value
  ) {
    const number =
      Number(value);

    if (
      !Number.isFinite(
        number
      )
    ) {
      return DEFAULT_MAX_ACTIONS;
    }

    return Math.max(
      1,
      Math.min(
        MAX_ACTIONS_LIMIT,
        Math.floor(number)
      )
    );
  }

  // ==========================================================
  // REINDEX
  // ==========================================================

  _reindex() {
    this.actions.forEach(
      (action, index) => {
        action.index =
          index;
      }
    );
  }
}

// ============================================================
// FACTORY
// ============================================================

function createAgentActionPlan(
  options = {}
) {
  return new AgentActionPlan(
    options
  );
}

// ============================================================
// PLAN FROM SIMPLE TOOL LIST
// ============================================================

function createPlanFromActions(
  goal,
  actions = [],
  options = {}
) {
  const plan =
    new AgentActionPlan({
      ...options,

      goal,

      actions: [],
    });

  if (
    !Array.isArray(
      actions
    )
  ) {
    throw new Error(
      "Actions must be an array."
    );
  }

  for (
    const action of actions
  ) {
    plan.addAction(
      action
    );
  }

  return plan;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  ACTION_PLAN_VERSION,

  ACTION_STATUS,

  AgentActionPlan,

  createAgentActionPlan,

  createPlanFromActions,
};