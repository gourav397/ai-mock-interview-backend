// ============================================================
// ALEX — Agent Runtime Diagnostics
// Version: 1.0.0
//
// Purpose:
//   Central diagnostic snapshot for the unified Agent Runtime.
//
//   This module is read-only. It does not execute tools,
//   actions, browser commands, computer actions, workflows,
//   or user tasks.
// ============================================================

"use strict";

const {
  getAgentRuntimeManager,
} = require("./AgentRuntimeManager");

const {
  getAgentRuntimeHealthService,
} = require("./AgentRuntimeHealthService");

const AGENT_RUNTIME_DIAGNOSTICS_VERSION =
  "1.0.0";

class AgentRuntimeDiagnostics {
  constructor(options = {}) {
    this.version =
      AGENT_RUNTIME_DIAGNOSTICS_VERSION;

    this.manager =
      options.manager ||
      getAgentRuntimeManager();

    this.healthService =
      options.healthService ||
      getAgentRuntimeHealthService({
        manager: this.manager,
      });

    this.createdAt =
      new Date();
  }

  // ==========================================================
  // FULL DIAGNOSTIC SNAPSHOT
  // ==========================================================

  snapshot(options = {}) {
    const started =
      Date.now();

    const health =
      this._safeHealthCheck();

    const runtime =
      this._runtimeSnapshot();

    const capabilities =
      this._capabilitySnapshot();

    const sessions =
      this._sessionSnapshot();

    const workflows =
      this._workflowSnapshot();

    const tools =
      this._toolSnapshot();

    const verification =
      this._verificationSnapshot();

    return {
      success: true,

      version:
        this.version,

      timestamp:
        new Date().toISOString(),

      durationMs:
        Date.now() - started,

      diagnostics: {
        runtime,
        health,
        capabilities,
        sessions,
        workflows,
        tools,
        verification,
      },

      options,
    };
  }

  // ==========================================================
  // RUNTIME
  // ==========================================================

  _runtimeSnapshot() {
    try {
      const status =
        this.manager.getStatus();

      let health =
        null;

      try {
        health =
          this.manager.checkHealth();
      } catch {
        health =
          null;
      }

      return {
        available: true,

        managerStatus:
          status,

        health,

        managerReady:
          [
            "ready",
            "degraded",
          ].includes(status),
      };
    } catch (error) {
      return {
        available: false,

        managerStatus:
          null,

        health:
          null,

        error:
          this._errorInfo(
            error
          ),
      };
    }
  }

  // ==========================================================
  // CAPABILITIES
  // ==========================================================

  _capabilitySnapshot() {
    try {
      const runtime =
        this.manager.getRuntime();

      if (
        !runtime ||
        typeof runtime.getCapabilities !==
          "function"
      ) {
        return {
          available: false,

          count: 0,

          capabilities: [],
        };
      }

      const raw =
        runtime.getCapabilities();

      const capabilities =
        Array.isArray(raw)
          ? raw
          : Array.isArray(
              raw?.capabilities
            )
            ? raw.capabilities
            : [];

      return {
        available: true,

        count:
          capabilities.length,

        capabilities:
          this._sanitize(
            capabilities
          ),
      };
    } catch (error) {
      return {
        available: false,

        count: 0,

        capabilities: [],

        error:
          this._errorInfo(
            error
          ),
      };
    }
  }

  // ==========================================================
  // SESSIONS
  // ==========================================================

  _sessionSnapshot() {
    try {
      const runtime =
        this.manager.getRuntime();

      if (!runtime) {
        return {
          available: false,
        };
      }

      const methods = [
        "createSession",
        "getSession",
        "getSessionStatus",
        "addAction",
        "addActions",
        "runSession",
        "runSessionWithRecovery",
        "resumeSession",
        "cancelSession",
        "createSnapshot",
      ];

      const available =
        methods.filter(
          (method) =>
            typeof runtime[method] ===
            "function"
        );

      const missing =
        methods.filter(
          (method) =>
            typeof runtime[method] !==
            "function"
        );

      return {
        available:
          available.length > 0,

        ready:
          missing.length === 0,

        availableOperations:
          available,

        missingOperations:
          missing,
      };
    } catch (error) {
      return {
        available: false,

        ready: false,

        error:
          this._errorInfo(
            error
          ),
      };
    }
  }

  // ==========================================================
  // WORKFLOWS
  // ==========================================================

  _workflowSnapshot() {
    try {
      const runtime =
        this.manager.getRuntime();

      if (!runtime) {
        return {
          available: false,
        };
      }

      const methods = [
        "createWorkflow",
        "getWorkflow",
        "getWorkflowStatus",
      ];

      const available =
        methods.filter(
          (method) =>
            typeof runtime[method] ===
            "function"
        );

      const missing =
        methods.filter(
          (method) =>
            typeof runtime[method] !==
            "function"
        );

      return {
        available:
          available.length > 0,

        ready:
          missing.length === 0,

        availableOperations:
          available,

        missingOperations:
          missing,
      };
    } catch (error) {
      return {
        available: false,

        ready: false,

        error:
          this._errorInfo(
            error
          ),
      };
    }
  }

  // ==========================================================
  // TOOLS
  // ==========================================================

  _toolSnapshot() {
    try {
      const runtime =
        this.manager.getRuntime();

      if (!runtime) {
        return {
          available: false,
        };
      }

      const inspect =
        typeof runtime.inspectTool ===
        "function";

      const execute =
        typeof runtime.executeTool ===
        "function";

      return {
        available:
          inspect || execute,

        inspect,

        execute,

        ready:
          inspect && execute,
      };
    } catch (error) {
      return {
        available: false,

        inspect: false,

        execute: false,

        ready: false,

        error:
          this._errorInfo(
            error
          ),
      };
    }
  }

  // ==========================================================
  // VERIFICATION
  // ==========================================================

  _verificationSnapshot() {
    try {
      const runtime =
        this.manager.getRuntime();

      if (!runtime) {
        return {
          available: false,
        };
      }

      const verifyResult =
        typeof runtime.verifyResult ===
        "function";

      const verifyAction =
        typeof runtime.verifyAction ===
        "function";

      return {
        available:
          verifyResult ||
          verifyAction,

        verifyResult,

        verifyAction,

        ready:
          verifyResult &&
          verifyAction,
      };
    } catch (error) {
      return {
        available: false,

        verifyResult: false,

        verifyAction: false,

        ready: false,

        error:
          this._errorInfo(
            error
          ),
      };
    }
  }

  // ==========================================================
  // HEALTH
  // ==========================================================

  _safeHealthCheck() {
    try {
      return this.healthService.check();
    } catch (error) {
      return {
        success: false,

        status:
          "unhealthy",

        error:
          this._errorInfo(
            error
          ),
      };
    }
  }

  // ==========================================================
  // READ-ONLY SYSTEM SUMMARY
  // ==========================================================

  summary() {
    const snapshot =
      this.snapshot();

    const diagnostics =
      snapshot.diagnostics;

    return {
      success:
        snapshot.success,

      version:
        this.version,

      status:
        diagnostics.health?.status ||
        "unknown",

      runtime:
        diagnostics.runtime?.managerStatus ||
        "unknown",

      capabilities:
        diagnostics.capabilities?.count ||
        0,

      sessionsReady:
        Boolean(
          diagnostics.sessions?.ready
        ),

      workflowsReady:
        Boolean(
          diagnostics.workflows?.ready
        ),

      toolsReady:
        Boolean(
          diagnostics.tools?.ready
        ),

      verificationReady:
        Boolean(
          diagnostics.verification?.ready
        ),

      timestamp:
        snapshot.timestamp,
    };
  }

  // ==========================================================
  // HEALTH SERVICE INFO
  // ==========================================================

  healthStats() {
    try {
      return {
        success: true,

        stats:
          this.healthService.getStats(),
      };
    } catch (error) {
      return {
        success: false,

        error:
          this._errorInfo(
            error
          ),
      };
    }
  }

  // ==========================================================
  // VERSION / INFO
  // ==========================================================

  info() {
    return {
      success: true,

      diagnosticsVersion:
        this.version,

      createdAt:
        this.createdAt.toISOString(),

      healthServiceVersion:
        this.healthService.version,

      timestamp:
        new Date().toISOString(),
    };
  }

  // ==========================================================
  // SAFE SERIALIZATION
  // ==========================================================

  _sanitize(value) {
    if (
      value === null ||
      value === undefined
    ) {
      return value;
    }

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }

    if (
      typeof value === "function"
    ) {
      return undefined;
    }

    if (
      Array.isArray(value)
    ) {
      return value
        .map(
          (item) =>
            this._sanitize(
              item
            )
        )
        .filter(
          (item) =>
            item !== undefined
        );
    }

    if (
      typeof value === "object"
    ) {
      const output = {};

      for (
        const [key, item]
        of Object.entries(value)
      ) {
        const sanitized =
          this._sanitize(
            item
          );

        if (
          sanitized !==
          undefined
        ) {
          output[key] =
            sanitized;
        }
      }

      return output;
    }

    return String(value);
  }

  // ==========================================================
  // ERROR NORMALIZATION
  // ==========================================================

  _errorInfo(error) {
    return {
      name:
        error?.name ||
        "Error",

      message:
        error?.message ||
        String(error),

      code:
        error?.code ||
        null,
    };
  }
}

// ============================================================
// SINGLETON
// ============================================================

let diagnosticsInstance =
  null;

function getAgentRuntimeDiagnostics(
  options = {}
) {
  if (
    !diagnosticsInstance
  ) {
    diagnosticsInstance =
      new AgentRuntimeDiagnostics(
        options
      );
  }

  return diagnosticsInstance;
}

function resetAgentRuntimeDiagnostics(
  options = {}
) {
  diagnosticsInstance =
    new AgentRuntimeDiagnostics(
      options
    );

  return diagnosticsInstance;
}

function createAgentRuntimeDiagnostics(
  options = {}
) {
  return new AgentRuntimeDiagnostics(
    options
  );
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  AgentRuntimeDiagnostics,

  getAgentRuntimeDiagnostics,
  resetAgentRuntimeDiagnostics,
  createAgentRuntimeDiagnostics,

  AGENT_RUNTIME_DIAGNOSTICS_VERSION,
};