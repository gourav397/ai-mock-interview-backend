// ============================================================
// ALEX AGENT WORKFLOW STORE
// Version: 1.0.0
//
// Purpose:
//   Central state store for long-running Agent workflows.
//
//   AgentWorkflowEngine
//          ↓
//   AgentWorkflowStore
//          ↓
//   workflow state / snapshots / history
//
// Notes:
//   - In-memory by default.
//   - Does NOT execute tools.
//   - Does NOT bypass permissions.
//   - Does NOT replace the existing PersistentTaskManager.
//   - Designed so persistent storage can be added later.
// ============================================================

"use strict";

// ============================================================
// CONSTANTS
// ============================================================

const AGENT_WORKFLOW_STORE_VERSION = "1.0.0";

const MAX_WORKFLOWS = 500;

const MAX_HISTORY_PER_WORKFLOW = 100;

const WORKFLOW_STATE = Object.freeze({
  CREATED: "created",
  RUNNING: "running",
  WAITING_CONFIRMATION: "waiting_confirmation",
  VERIFYING: "verifying",
  COMPLETED: "completed",
  FAILED: "failed",
  VERIFICATION_FAILED: "verification_failed",
  CANCELLED: "cancelled",
  UNKNOWN: "unknown",
});

// ============================================================
// HELPERS
// ============================================================

function safeString(value, fallback = "") {
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

function now() {
  return new Date().toISOString();
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
// WORKFLOW STORE
// ============================================================

class AgentWorkflowStore {
  constructor(options = {}) {
    this.version =
      AGENT_WORKFLOW_STORE_VERSION;

    this.maxWorkflows =
      Number.isInteger(
        options.maxWorkflows
      ) &&
      options.maxWorkflows > 0
        ? options.maxWorkflows
        : MAX_WORKFLOWS;

    this.maxHistoryPerWorkflow =
      Number.isInteger(
        options.maxHistoryPerWorkflow
      ) &&
      options.maxHistoryPerWorkflow > 0
        ? options.maxHistoryPerWorkflow
        : MAX_HISTORY_PER_WORKFLOW;

    this.workflows = new Map();

    this.createdAt = now();
  }

  // ==========================================================
  // CREATE
  // ==========================================================

  create({
    workflowId,
    planId = null,
    contextId = null,
    taskId = null,
    ownerId = null,
    sessionId = null,
    goal = "",
    metadata = {},
  } = {}) {
    const id =
      safeString(
        workflowId
      );

    if (!id) {
      throw new Error(
        "workflowId is required."
      );
    }

    if (
      this.workflows.has(id)
    ) {
      return this.get(id);
    }

    this._enforceCapacity();

    const timestamp = now();

    const workflow = {
      workflowId: id,

      planId:
        planId ||
        null,

      contextId:
        contextId ||
        null,

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
        safeString(goal),

      status:
        WORKFLOW_STATE.CREATED,

      createdAt:
        timestamp,

      updatedAt:
        timestamp,

      startedAt:
        null,

      completedAt:
        null,

      cancelledAt:
        null,

      error:
        null,

      result:
        null,

      verification:
        null,

      metadata:
        clone(
          safeObject(metadata)
        ),

      history: [],
    };

    this.workflows.set(
      id,
      workflow
    );

    this._addHistory(
      workflow,
      "created",
      {
        status:
          WORKFLOW_STATE.CREATED,
      }
    );

    return this.get(id);
  }

  // ==========================================================
  // GET
  // ==========================================================

  get(workflowId) {
    const id =
      safeString(
        workflowId
      );

    if (!id) {
      return null;
    }

    const workflow =
      this.workflows.get(id);

    if (!workflow) {
      return null;
    }

    return clone(workflow);
  }

  // ==========================================================
  // EXISTS
  // ==========================================================

  has(workflowId) {
    const id =
      safeString(
        workflowId
      );

    return (
      !!id &&
      this.workflows.has(id)
    );
  }

  // ==========================================================
  // UPDATE
  // ==========================================================

  update(
    workflowId,
    updates = {},
    options = {}
  ) {
    const id =
      safeString(
        workflowId
      );

    if (!id) {
      throw new Error(
        "workflowId is required."
      );
    }

    const workflow =
      this.workflows.get(id);

    if (!workflow) {
      throw new Error(
        `Workflow not found: ${id}`
      );
    }

    const safeUpdates =
      safeObject(updates);

    const previousStatus =
      workflow.status;

    // --------------------------------------------------------
    // Protected fields
    // --------------------------------------------------------

    const protectedFields = new Set([
      "workflowId",
      "createdAt",
      "history",
    ]);

    for (
      const [
        key,
        value,
      ] of Object.entries(
        safeUpdates
      )
    ) {
      if (
        protectedFields.has(key)
      ) {
        continue;
      }

      workflow[key] =
        clone(value);
    }

    workflow.updatedAt =
      now();

    // --------------------------------------------------------
    // Automatic timestamps
    // --------------------------------------------------------

    if (
      workflow.status ===
        WORKFLOW_STATE.RUNNING &&
      !workflow.startedAt
    ) {
      workflow.startedAt =
        now();
    }

    if (
      (
        workflow.status ===
          WORKFLOW_STATE.COMPLETED ||
        workflow.status ===
          WORKFLOW_STATE.FAILED ||
        workflow.status ===
          WORKFLOW_STATE.VERIFICATION_FAILED
      ) &&
      !workflow.completedAt
    ) {
      workflow.completedAt =
        now();
    }

    if (
      workflow.status ===
        WORKFLOW_STATE.CANCELLED &&
      !workflow.cancelledAt
    ) {
      workflow.cancelledAt =
        now();
    }

    // --------------------------------------------------------
    // History
    // --------------------------------------------------------

    if (
      options.recordHistory !==
      false
    ) {
      if (
        previousStatus !==
        workflow.status
      ) {
        this._addHistory(
          workflow,
          "status_changed",
          {
            from:
              previousStatus,

            to:
              workflow.status,
          }
        );
      }
    }

    return this.get(id);
  }

  // ==========================================================
  // SET STATUS
  // ==========================================================

  setStatus(
    workflowId,
    status,
    details = {}
  ) {
    const normalizedStatus =
      safeString(status);

    if (
      !Object.values(
        WORKFLOW_STATE
      ).includes(
        normalizedStatus
      )
    ) {
      throw new Error(
        `Invalid workflow status: ${normalizedStatus}`
      );
    }

    return this.update(
      workflowId,
      {
        status:
          normalizedStatus,

        ...safeObject(details),
      }
    );
  }

  // ==========================================================
  // SET RESULT
  // ==========================================================

  setResult(
    workflowId,
    result
  ) {
    return this.update(
      workflowId,
      {
        result:
          clone(result),
      }
    );
  }

  // ==========================================================
  // SET VERIFICATION
  // ==========================================================

  setVerification(
    workflowId,
    verification
  ) {
    return this.update(
      workflowId,
      {
        verification:
          clone(verification),
      }
    );
  }

  // ==========================================================
  // SET ERROR
  // ==========================================================

  setError(
    workflowId,
    error
  ) {
    const normalizedError =
      this._normalizeError(
        error
      );

    return this.update(
      workflowId,
      {
        error:
          normalizedError,

        status:
          WORKFLOW_STATE.FAILED,
      }
    );
  }

  // ==========================================================
  // RECORD EVENT
  // ==========================================================

  recordEvent(
    workflowId,
    type,
    data = {}
  ) {
    const id =
      safeString(
        workflowId
      );

    if (!id) {
      throw new Error(
        "workflowId is required."
      );
    }

    const workflow =
      this.workflows.get(id);

    if (!workflow) {
      throw new Error(
        `Workflow not found: ${id}`
      );
    }

    this._addHistory(
      workflow,
      safeString(
        type,
        "event"
      ),
      safeObject(data)
    );

    workflow.updatedAt =
      now();

    return this.get(id);
  }

  // ==========================================================
  // HISTORY
  // ==========================================================

  getHistory(
    workflowId,
    options = {}
  ) {
    const workflow =
      this.workflows.get(
        safeString(
          workflowId
        )
      );

    if (!workflow) {
      return [];
    }

    const limit =
      Number.isInteger(
        options.limit
      ) &&
      options.limit > 0
        ? options.limit
        : this.maxHistoryPerWorkflow;

    const history =
      workflow.history || [];

    return clone(
      history.slice(
        Math.max(
          0,
          history.length - limit
        )
      )
    );
  }

  // ==========================================================
  // SNAPSHOT
  // ==========================================================

  snapshot(
    workflowId
  ) {
    const workflow =
      this.workflows.get(
        safeString(
          workflowId
        )
      );

    if (!workflow) {
      return null;
    }

    return clone({
      workflowId:
        workflow.workflowId,

      planId:
        workflow.planId,

      contextId:
        workflow.contextId,

      taskId:
        workflow.taskId,

      ownerId:
        workflow.ownerId,

      sessionId:
        workflow.sessionId,

      goal:
        workflow.goal,

      status:
        workflow.status,

      createdAt:
        workflow.createdAt,

      updatedAt:
        workflow.updatedAt,

      startedAt:
        workflow.startedAt,

      completedAt:
        workflow.completedAt,

      cancelledAt:
        workflow.cancelledAt,

      error:
        workflow.error,

      result:
        workflow.result,

      verification:
        workflow.verification,

      metadata:
        workflow.metadata,
    });
  }

  // ==========================================================
  // LIST
  // ==========================================================

  list(
    options = {}
  ) {
    let workflows =
      Array.from(
        this.workflows.values()
      );

    if (
      options.status
    ) {
      const status =
        safeString(
          options.status
        );

      workflows =
        workflows.filter(
          (workflow) =>
            workflow.status ===
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

      workflows =
        workflows.filter(
          (workflow) =>
            workflow.ownerId ===
            ownerId
        );
    }

    if (
      options.taskId
    ) {
      const taskId =
        safeString(
          options.taskId
        );

      workflows =
        workflows.filter(
          (workflow) =>
            workflow.taskId ===
            taskId
        );
    }

    if (
      options.sessionId
    ) {
      const sessionId =
        safeString(
          options.sessionId
        );

      workflows =
        workflows.filter(
          (workflow) =>
            workflow.sessionId ===
            sessionId
        );
    }

    workflows.sort(
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
        : workflows.length;

    return clone(
      workflows.slice(
        0,
        limit
      )
    );
  }

  // ==========================================================
  // ACTIVE WORKFLOWS
  // ==========================================================

  listActive(
    options = {}
  ) {
    const activeStatuses =
      new Set([
        WORKFLOW_STATE.CREATED,
        WORKFLOW_STATE.RUNNING,
        WORKFLOW_STATE.WAITING_CONFIRMATION,
        WORKFLOW_STATE.VERIFYING,
      ]);

    return this.list({
      ...options,

      limit:
        options.limit,

    }).filter(
      (workflow) =>
        activeStatuses.has(
          workflow.status
        )
    );
  }

  // ==========================================================
  // COMPLETED WORKFLOWS
  // ==========================================================

  listCompleted(
    options = {}
  ) {
    return this.list({
      ...options,

      status:
        WORKFLOW_STATE.COMPLETED,
    });
  }

  // ==========================================================
  // FAILED WORKFLOWS
  // ==========================================================

  listFailed(
    options = {}
  ) {
    const failedStatuses =
      new Set([
        WORKFLOW_STATE.FAILED,
        WORKFLOW_STATE.VERIFICATION_FAILED,
      ]);

    return this.list({
      ...options,
    }).filter(
      (workflow) =>
        failedStatuses.has(
          workflow.status
        )
    );
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

    return this.workflows.delete(
      id
    );
  }

  // ==========================================================
  // CLEAR
  // ==========================================================

  clear(
    options = {}
  ) {
    if (
      options.force ===
      true
    ) {
      const count =
        this.workflows.size;

      this.workflows.clear();

      return count;
    }

    const removableStatuses =
      new Set([
        WORKFLOW_STATE.COMPLETED,
        WORKFLOW_STATE.FAILED,
        WORKFLOW_STATE.VERIFICATION_FAILED,
        WORKFLOW_STATE.CANCELLED,
        WORKFLOW_STATE.UNKNOWN,
      ]);

    let removed =
      0;

    for (
      const [
        id,
        workflow,
      ] of this.workflows
    ) {
      if (
        removableStatuses.has(
          workflow.status
        )
      ) {
        this.workflows.delete(
          id
        );

        removed++;
      }
    }

    return removed;
  }

  // ==========================================================
  // EXPORT ALL
  // ==========================================================

  export() {
    return {
      version:
        this.version,

      exportedAt:
        now(),

      workflows:
        clone(
          Array.from(
            this.workflows.values()
          )
        ),
    };
  }

  // ==========================================================
  // IMPORT
  // ==========================================================

  import(
    payload,
    options = {}
  ) {
    if (
      !payload ||
      typeof payload !==
        "object"
    ) {
      throw new Error(
        "Invalid workflow store payload."
      );
    }

    if (
      !Array.isArray(
        payload.workflows
      )
    ) {
      throw new Error(
        "Workflow payload must contain workflows array."
      );
    }

    if (
      options.replace ===
      true
    ) {
      this.workflows.clear();
    }

    let imported =
      0;

    for (
      const workflow
      of payload.workflows
    ) {
      if (
        !workflow ||
        typeof workflow !==
          "object"
      ) {
        continue;
      }

      const id =
        safeString(
          workflow.workflowId
        );

      if (!id) {
        continue;
      }

      this._enforceCapacity();

      const normalized = {
        ...clone(
          workflow
        ),

        workflowId:
          id,

        status:
          Object.values(
            WORKFLOW_STATE
          ).includes(
            workflow.status
          )
            ? workflow.status
            : WORKFLOW_STATE.UNKNOWN,

        history:
          Array.isArray(
            workflow.history
          )
            ? workflow.history.slice(
                -this.maxHistoryPerWorkflow
              )
            : [],
      };

      this.workflows.set(
        id,
        normalized
      );

      imported++;
    }

    return {
      success:
        true,

      imported,

      total:
        this.workflows.size,
    };
  }

  // ==========================================================
  // STATS
  // ==========================================================

  getStats() {
    const counts = {};

    for (
      const status of
      Object.values(
        WORKFLOW_STATE
      )
    ) {
      counts[status] =
        0;
    }

    for (
      const workflow
      of this.workflows.values()
    ) {
      if (
        counts[
          workflow.status
        ] === undefined
      ) {
        counts[
          workflow.status
        ] = 0;
      }

      counts[
        workflow.status
      ]++;
    }

    return {
      version:
        this.version,

      total:
        this.workflows.size,

      maxWorkflows:
        this.maxWorkflows,

      counts,
    };
  }

  // ==========================================================
  // PRIVATE: ADD HISTORY
  // ==========================================================

  _addHistory(
    workflow,
    type,
    data = {}
  ) {
    if (
      !workflow.history
    ) {
      workflow.history = [];
    }

    workflow.history.push({
      id:
        `${workflow.workflowId}_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}`,

      timestamp:
        now(),

      type:
        safeString(
          type,
          "event"
        ),

      data:
        clone(
          safeObject(data)
        ),
    });

    if (
      workflow.history.length >
      this.maxHistoryPerWorkflow
    ) {
      workflow.history =
        workflow.history.slice(
          -this.maxHistoryPerWorkflow
        );
    }
  }

  // ==========================================================
  // PRIVATE: CAPACITY
  // ==========================================================

  _enforceCapacity() {
    if (
      this.workflows.size <
      this.maxWorkflows
    ) {
      return;
    }

    const entries =
      Array.from(
        this.workflows.entries()
      );

    entries.sort(
      (
        a,
        b
      ) =>
        String(
          a[1].updatedAt
        ).localeCompare(
          String(
            b[1].updatedAt
          )
        )
    );

    const removable =
      entries.find(
        ([
          ,
          workflow,
        ]) =>
          [
            WORKFLOW_STATE.COMPLETED,
            WORKFLOW_STATE.FAILED,
            WORKFLOW_STATE.VERIFICATION_FAILED,
            WORKFLOW_STATE.CANCELLED,
            WORKFLOW_STATE.UNKNOWN,
          ].includes(
            workflow.status
          )
      );

    if (removable) {
      this.workflows.delete(
        removable[0]
      );

      return;
    }

    // If everything is active, remove
    // the oldest entry rather than allowing
    // unbounded memory growth.
    if (entries.length > 0) {
      this.workflows.delete(
        entries[0][0]
      );
    }
  }

  // ==========================================================
  // PRIVATE: ERROR NORMALIZER
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

        stack:
          error.stack ||
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

function getAgentWorkflowStore(
  options = {}
) {
  if (!instance) {
    instance =
      new AgentWorkflowStore(
        options
      );
  }

  return instance;
}

// ============================================================
// RESET
// ============================================================

function resetAgentWorkflowStore() {
  instance =
    null;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  AGENT_WORKFLOW_STORE_VERSION,

  MAX_WORKFLOWS,

  MAX_HISTORY_PER_WORKFLOW,

  WORKFLOW_STATE,

  AgentWorkflowStore,

  getAgentWorkflowStore,

  resetAgentWorkflowStore,
};