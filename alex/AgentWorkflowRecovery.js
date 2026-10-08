"use strict";

// ============================================================
// ALEX AGENT WORKFLOW RECOVERY
// Version: 1.0.0
//
// Purpose:
//   Recover interrupted / failed workflows without directly
//   executing tools.
//
// Responsibilities:
//   - inspect workflow state
//   - determine whether recovery is possible
//   - create a recovery snapshot
//   - prepare workflow for resume
//   - track recovery attempts
//   - prevent unlimited recovery loops
//
// This module does NOT:
//   - execute WindowsAgent tools
//   - bypass permissions
//   - automatically approve confirmations
//   - replace AutonomousTaskRecovery.js
// ============================================================

const {
  getAgentWorkflowStore,
  WORKFLOW_STATE,
} = require("./AgentWorkflowStore");

// ============================================================
// CONSTANTS
// ============================================================

const AGENT_WORKFLOW_RECOVERY_VERSION =
  "1.0.0";

const MAX_RECOVERY_ATTEMPTS = 3;

const RECOVERY_STATUS = Object.freeze({
  AVAILABLE: "available",
  NOT_NEEDED: "not_needed",
  RECOVERING: "recovering",
  RECOVERED: "recovered",
  BLOCKED: "blocked",
  FAILED: "failed",
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
// RECOVERY ENGINE
// ============================================================

class AgentWorkflowRecovery {
  constructor(options = {}) {
    this.version =
      AGENT_WORKFLOW_RECOVERY_VERSION;

    this.store =
      options.store ||
      getAgentWorkflowStore();

    this.maxRecoveryAttempts =
      Number.isInteger(
        options.maxRecoveryAttempts
      ) &&
      options.maxRecoveryAttempts > 0
        ? options.maxRecoveryAttempts
        : MAX_RECOVERY_ATTEMPTS;

    this.recoveryRecords =
      new Map();
  }

  // ==========================================================
  // INSPECT
  // ==========================================================

  inspect(
    workflowId
  ) {
    const id =
      safeString(
        workflowId
      );

    if (!id) {
      return {
        success: false,
        status:
          RECOVERY_STATUS.FAILED,
        reason:
          "workflowId is required.",
      };
    }

    const workflow =
      this.store.get(id);

    if (!workflow) {
      return {
        success: false,
        status:
          RECOVERY_STATUS.FAILED,
        workflowId: id,
        reason:
          "Workflow not found.",
      };
    }

    const attempts =
      this._getAttemptCount(id);

    const recoverable =
      this._isRecoverable(
        workflow
      );

    const blocked =
      attempts >=
      this.maxRecoveryAttempts;

    let status =
      RECOVERY_STATUS.NOT_NEEDED;

    if (blocked) {
      status =
        RECOVERY_STATUS.BLOCKED;
    } else if (recoverable) {
      status =
        RECOVERY_STATUS.AVAILABLE;
    }

    return {
      success: true,

      workflowId:
        id,

      status,

      recoverable,

      blocked,

      attempts,

      maxAttempts:
        this.maxRecoveryAttempts,

      workflowStatus:
        workflow.status,

      reason:
        this._getRecoveryReason(
          workflow
        ),
    };
  }

  // ==========================================================
  // CAN RECOVER
  // ==========================================================

  canRecover(
    workflowId
  ) {
    const inspection =
      this.inspect(
        workflowId
      );

    return (
      inspection.success ===
        true &&
      inspection.recoverable ===
        true &&
      inspection.blocked !==
        true
    );
  }

  // ==========================================================
  // CREATE RECOVERY SNAPSHOT
  // ==========================================================

  createSnapshot(
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
      this.store.get(id);

    if (!workflow) {
      return null;
    }

    const snapshot = {
      recoveryId:
        this._createRecoveryId(
          id
        ),

      workflowId:
        id,

      createdAt:
        new Date().toISOString(),

      workflow:
        clone(workflow),

      attempt:
        this._getAttemptCount(id),

      version:
        this.version,
    };

    const record =
      this._getOrCreateRecord(
        id
      );

    record.snapshots.push(
      snapshot
    );

    record.updatedAt =
      new Date().toISOString();

    return clone(
      snapshot
    );
  }

  // ==========================================================
  // PREPARE RECOVERY
  // ==========================================================

  prepareRecovery(
    workflowId,
    options = {}
  ) {
    const id =
      safeString(
        workflowId
      );

    if (!id) {
      return {
        success: false,
        status:
          RECOVERY_STATUS.FAILED,
        reason:
          "workflowId is required.",
      };
    }

    const inspection =
      this.inspect(id);

    if (
      !inspection.success
    ) {
      return inspection;
    }

    if (
      !inspection.recoverable
    ) {
      return {
        success: false,

        status:
          inspection.blocked
            ? RECOVERY_STATUS.BLOCKED
            : RECOVERY_STATUS.NOT_NEEDED,

        workflowId:
          id,

        reason:
          inspection.reason,
      };
    }

    // --------------------------------------------------------
    // Create recovery snapshot first
    // --------------------------------------------------------

    const snapshot =
      this.createSnapshot(id);

    if (!snapshot) {
      return {
        success: false,

        status:
          RECOVERY_STATUS.FAILED,

        workflowId:
          id,

        reason:
          "Unable to create recovery snapshot.",
      };
    }

    const record =
      this._getOrCreateRecord(id);

    const attempt =
      record.attempts + 1;

    record.attempts =
      attempt;

    record.status =
      RECOVERY_STATUS.RECOVERING;

    record.updatedAt =
      new Date().toISOString();

    record.lastReason =
      safeString(
        options.reason,
        inspection.reason
      );

    // --------------------------------------------------------
    // Move workflow into running state
    // --------------------------------------------------------

    try {
      const updated =
        this.store.update(
          id,
          {
            status:
              WORKFLOW_STATE.RUNNING,

            error:
              null,

            metadata: {
              ...(workflowMetadata(
                this.store.get(id)
              )),

              recovery: {
                recoveryId:
                  snapshot.recoveryId,

                attempt,

                preparedAt:
                  new Date().toISOString(),

                reason:
                  record.lastReason,
              },
            },
          }
        );

      record.status =
        RECOVERY_STATUS.RECOVERED;

      record.updatedAt =
        new Date().toISOString();

      return {
        success: true,

        status:
          RECOVERY_STATUS.RECOVERED,

        workflowId:
          id,

        recoveryId:
          snapshot.recoveryId,

        attempt,

        workflow:
          updated,
      };
    } catch (error) {
      record.status =
        RECOVERY_STATUS.FAILED;

      record.updatedAt =
        new Date().toISOString();

      record.lastError =
        this._normalizeError(
          error
        );

      return {
        success: false,

        status:
          RECOVERY_STATUS.FAILED,

        workflowId:
          id,

        recoveryId:
          snapshot.recoveryId,

        attempt,

        error:
          record.lastError,
      };
    }
  }

  // ==========================================================
  // MARK RECOVERY SUCCESS
  // ==========================================================

  markRecovered(
    workflowId,
    details = {}
  ) {
    const id =
      safeString(
        workflowId
      );

    if (!id) {
      return false;
    }

    const record =
      this._getOrCreateRecord(id);

    record.status =
      RECOVERY_STATUS.RECOVERED;

    record.updatedAt =
      new Date().toISOString();

    record.lastSuccess =
      clone(
        safeObject(details)
      );

    return true;
  }

  // ==========================================================
  // MARK RECOVERY FAILURE
  // ==========================================================

  markFailed(
    workflowId,
    error = null
  ) {
    const id =
      safeString(
        workflowId
      );

    if (!id) {
      return false;
    }

    const record =
      this._getOrCreateRecord(id);

    record.status =
      RECOVERY_STATUS.FAILED;

    record.updatedAt =
      new Date().toISOString();

    record.lastError =
      this._normalizeError(
        error
      );

    return true;
  }

  // ==========================================================
  // ROLLBACK TO SNAPSHOT
  // ==========================================================

  rollback(
    workflowId,
    recoveryId
  ) {
    const id =
      safeString(
        workflowId
      );

    const rid =
      safeString(
        recoveryId
      );

    if (
      !id ||
      !rid
    ) {
      return {
        success: false,

        status:
          RECOVERY_STATUS.FAILED,

        reason:
          "workflowId and recoveryId are required.",
      };
    }

    const record =
      this.recoveryRecords.get(
        id
      );

    if (!record) {
      return {
        success: false,

        status:
          RECOVERY_STATUS.FAILED,

        workflowId:
          id,

        recoveryId:
          rid,

        reason:
          "Recovery record not found.",
      };
    }

    const snapshot =
      record.snapshots.find(
        (item) =>
          item.recoveryId ===
          rid
      );

    if (!snapshot) {
      return {
        success: false,

        status:
          RECOVERY_STATUS.FAILED,

        workflowId:
          id,

        recoveryId:
          rid,

        reason:
          "Recovery snapshot not found.",
      };
    }

    try {
      const original =
        snapshot.workflow;

      const restored =
        this.store.update(
          id,
          {
            planId:
              original.planId,

            contextId:
              original.contextId,

            taskId:
              original.taskId,

            ownerId:
              original.ownerId,

            sessionId:
              original.sessionId,

            goal:
              original.goal,

            status:
              original.status,

            startedAt:
              original.startedAt,

            completedAt:
              original.completedAt,

            cancelledAt:
              original.cancelledAt,

            error:
              original.error,

            result:
              clone(
                original.result
              ),

            verification:
              clone(
                original.verification
              ),

            metadata:
              clone(
                original.metadata
              ),
          }
        );

      record.updatedAt =
        new Date().toISOString();

      record.lastRollback =
        rid;

      return {
        success: true,

        status:
          RECOVERY_STATUS.RECOVERED,

        workflowId:
          id,

        recoveryId:
          rid,

        workflow:
          restored,
      };
    } catch (error) {
      record.status =
        RECOVERY_STATUS.FAILED;

      record.lastError =
        this._normalizeError(
          error
        );

      record.updatedAt =
        new Date().toISOString();

      return {
        success: false,

        status:
          RECOVERY_STATUS.FAILED,

        workflowId:
          id,

        recoveryId:
          rid,

        error:
          record.lastError,
      };
    }
  }

  // ==========================================================
  // GET RECOVERY RECORD
  // ==========================================================

  getRecord(
    workflowId
  ) {
    const id =
      safeString(
        workflowId
      );

    if (!id) {
      return null;
    }

    const record =
      this.recoveryRecords.get(
        id
      );

    return record
      ? clone(record)
      : null;
  }

  // ==========================================================
  // GET ATTEMPT COUNT
  // ==========================================================

  getAttemptCount(
    workflowId
  ) {
    return this._getAttemptCount(
      workflowId
    );
  }

  // ==========================================================
  // RESET RECOVERY
  // ==========================================================

  reset(
    workflowId
  ) {
    const id =
      safeString(
        workflowId
      );

    if (!id) {
      return false;
    }

    return this.recoveryRecords.delete(
      id
    );
  }

  // ==========================================================
  // LIST RECOVERABLE WORKFLOWS
  // ==========================================================

  listRecoverable(
    options = {}
  ) {
    const workflows =
      this.store.list(
        {
          ownerId:
            options.ownerId,

          taskId:
            options.taskId,

          sessionId:
            options.sessionId,

          limit:
            options.limit ||
            500,
        }
      );

    return workflows.filter(
      (workflow) =>
        this._isRecoverable(
          workflow
        ) &&
        this._getAttemptCount(
          workflow.workflowId
        ) <
          this.maxRecoveryAttempts
    );
  }

  // ==========================================================
  // STATS
  // ==========================================================

  getStats() {
    let available = 0;
    let blocked = 0;
    let recovering = 0;
    let recovered = 0;
    let failed = 0;

    for (
      const record
      of this.recoveryRecords.values()
    ) {
      switch (
        record.status
      ) {
        case RECOVERY_STATUS.RECOVERING:
          recovering++;
          break;

        case RECOVERY_STATUS.RECOVERED:
          recovered++;
          break;

        case RECOVERY_STATUS.FAILED:
          failed++;
          break;

        default:
          break;
      }

      if (
        record.attempts >=
        this.maxRecoveryAttempts
      ) {
        blocked++;
      }
    }

    available =
      this.listRecoverable()
        .length;

    return {
      version:
        this.version,

      maxRecoveryAttempts:
        this.maxRecoveryAttempts,

      trackedWorkflows:
        this.recoveryRecords.size,

      available,

      blocked,

      recovering,

      recovered,

      failed,
    };
  }

  // ==========================================================
  // PRIVATE: RECOVERABILITY
  // ==========================================================

  _isRecoverable(
    workflow
  ) {
    if (!workflow) {
      return false;
    }

    switch (
      workflow.status
    ) {
      case WORKFLOW_STATE.FAILED:
      case WORKFLOW_STATE.VERIFICATION_FAILED:
        return true;

      case WORKFLOW_STATE.RUNNING:
        // A running workflow can be recovered
        // only when it has an execution error.
        return !!workflow.error;

      case WORKFLOW_STATE.WAITING_CONFIRMATION:
        // Waiting confirmation is not a failure.
        return false;

      case WORKFLOW_STATE.COMPLETED:
      case WORKFLOW_STATE.CANCELLED:
        return false;

      default:
        return false;
    }
  }

  // ==========================================================
  // PRIVATE: REASON
  // ==========================================================

  _getRecoveryReason(
    workflow
  ) {
    if (!workflow) {
      return "Workflow does not exist.";
    }

    switch (
      workflow.status
    ) {
      case WORKFLOW_STATE.FAILED:
        return (
          workflow.error?.message ||
          "Workflow execution failed."
        );

      case WORKFLOW_STATE.VERIFICATION_FAILED:
        return (
          workflow.verification?.reason ||
          "Workflow verification failed."
        );

      case WORKFLOW_STATE.RUNNING:
        return workflow.error
          ? workflow.error.message ||
            "Running workflow has an error."
          : "Workflow is currently running.";

      case WORKFLOW_STATE.WAITING_CONFIRMATION:
        return "Workflow is waiting for confirmation.";

      case WORKFLOW_STATE.COMPLETED:
        return "Workflow already completed.";

      case WORKFLOW_STATE.CANCELLED:
        return "Workflow was cancelled.";

      default:
        return "Workflow does not require recovery.";
    }
  }

  // ==========================================================
  // PRIVATE: RECORD
  // ==========================================================

  _getOrCreateRecord(
    workflowId
  ) {
    const id =
      safeString(
        workflowId
      );

    let record =
      this.recoveryRecords.get(
        id
      );

    if (!record) {
      record = {
        workflowId:
          id,

        status:
          RECOVERY_STATUS.AVAILABLE,

        attempts:
          0,

        snapshots: [],

        createdAt:
          new Date().toISOString(),

        updatedAt:
          new Date().toISOString(),

        lastReason:
          null,

        lastError:
          null,

        lastSuccess:
          null,

        lastRollback:
          null,
      };

      this.recoveryRecords.set(
        id,
        record
      );
    }

    return record;
  }

  // ==========================================================
  // PRIVATE: ATTEMPTS
  // ==========================================================

  _getAttemptCount(
    workflowId
  ) {
    const id =
      safeString(
        workflowId
      );

    const record =
      this.recoveryRecords.get(
        id
      );

    return record?.attempts ||
      0;
  }

  // ==========================================================
  // PRIVATE: RECOVERY ID
  // ==========================================================

  _createRecoveryId(
    workflowId
  ) {
    return [
      "recovery",
      safeString(
        workflowId,
        "workflow"
      ),
      Date.now(),
      Math.random()
        .toString(36)
        .slice(2, 8),
    ].join("_");
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
// HELPER
// ============================================================

function workflowMetadata(
  workflow
) {
  if (
    !workflow ||
    typeof workflow !==
      "object"
  ) {
    return {};
  }

  return safeObject(
    workflow.metadata
  );
}

// ============================================================
// SINGLETON
// ============================================================

let instance =
  null;

function getAgentWorkflowRecovery(
  options = {}
) {
  if (!instance) {
    instance =
      new AgentWorkflowRecovery(
        options
      );
  }

  return instance;
}

// ============================================================
// RESET
// ============================================================

function resetAgentWorkflowRecovery() {
  instance =
    null;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  AGENT_WORKFLOW_RECOVERY_VERSION,

  MAX_RECOVERY_ATTEMPTS,

  RECOVERY_STATUS,

  AgentWorkflowRecovery,

  getAgentWorkflowRecovery,

  resetAgentWorkflowRecovery,
};