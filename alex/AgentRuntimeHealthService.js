// ============================================================
// ALEX — Agent Runtime Health Service
// Version: 1.0.0
//
// Purpose:
//   Central health/diagnostic layer for the Agent Runtime.
//
//   Checks runtime state, capabilities, sessions, workflows,
//   tools and verification infrastructure without executing
//   user actions.
// ============================================================

"use strict";

const {
  getAgentRuntimeManager,
} = require("./AgentRuntimeManager");

const AGENT_RUNTIME_HEALTH_SERVICE_VERSION =
  "1.0.0";

const HEALTH_STATUS = Object.freeze({
  HEALTHY: "healthy",
  DEGRADED: "degraded",
  UNHEALTHY: "unhealthy",
});

class AgentRuntimeHealthService {
  constructor(options = {}) {
    this.version =
      AGENT_RUNTIME_HEALTH_SERVICE_VERSION;

    this.manager =
      options.manager ||
      getAgentRuntimeManager();

    this.startedAt =
      new Date();

    this.lastCheck = null;

    this.lastResult = null;

    this.checkCount = 0;
  }

  // ==========================================================
  // FULL HEALTH CHECK
  // ==========================================================

  check(options = {}) {
    const started =
      Date.now();

    this.checkCount += 1;

    const checks = {
      runtime:
        this._checkRuntime(),

      capabilities:
        this._checkCapabilities(),

      sessions:
        this._checkSessions(),

      workflows:
        this._checkWorkflows(),

      tools:
        this._checkTools(),

      verification:
        this._checkVerification(),
    };

    const summary =
      this._buildSummary(
        checks
      );

    const result = {
      success:
        summary.status !==
        HEALTH_STATUS.UNHEALTHY,

      status:
        summary.status,

      version:
        this.version,

      durationMs:
        Date.now() - started,

      checkCount:
        this.checkCount,

      timestamp:
        new Date().toISOString(),

      checks,

      summary,
    };

    this.lastCheck =
      new Date();

    this.lastResult =
      result;

    return result;
  }

  // ==========================================================
  // QUICK HEALTH CHECK
  // ==========================================================

  quickCheck() {
    const runtime =
      this._checkRuntime();

    const healthy =
      runtime.status ===
      HEALTH_STATUS.HEALTHY;

    return {
      success: healthy,

      healthy,

      status:
        runtime.status,

      runtime:
        runtime.details,

      timestamp:
        new Date().toISOString(),
    };
  }

  // ==========================================================
  // RUNTIME CHECK
  // ==========================================================

  _checkRuntime() {
    try {
      const status =
        this.manager.getStatus();

      const health =
        this.manager.checkHealth();

      const runtimeReady =
        Boolean(
          health?.healthy ||
          health?.success ||
          health?.status === "healthy" ||
          health?.status === "ready"
        );

      const managerReady =
        [
          "ready",
          "degraded",
        ].includes(status);

      if (
        status === "failed" ||
        status === "stopped"
      ) {
        return {
          status:
            HEALTH_STATUS.UNHEALTHY,

          details: {
            managerStatus:
              status,

            health:
              health || null,
          },

          message:
            "Agent runtime is not running.",
        };
      }

      if (
        managerReady &&
        runtimeReady
      ) {
        return {
          status:
            HEALTH_STATUS.HEALTHY,

          details: {
            managerStatus:
              status,

            health:
              health || null,
          },

          message:
            "Agent runtime is operational.",
        };
      }

      return {
        status:
          HEALTH_STATUS.DEGRADED,

        details: {
          managerStatus:
            status,

          health:
            health || null,
        },

        message:
          "Agent runtime is available but requires attention.",
      };
    } catch (error) {
      return this._failedCheck(
        error
      );
    }
  }

  // ==========================================================
  // CAPABILITY CHECK
  // ==========================================================

  _checkCapabilities() {
    try {
      const runtime =
        this.manager.getRuntime();

      if (
        !runtime ||
        typeof runtime.getCapabilities !==
          "function"
      ) {
        return {
          status:
            HEALTH_STATUS.UNHEALTHY,

          details: {},

          message:
            "Capability interface is unavailable.",
        };
      }

      const capabilities =
        runtime.getCapabilities();

      const list =
        Array.isArray(
          capabilities
        )
          ? capabilities
          : Array.isArray(
              capabilities?.capabilities
            )
            ? capabilities.capabilities
            : [];

      return {
        status:
          list.length > 0
            ? HEALTH_STATUS.HEALTHY
            : HEALTH_STATUS.DEGRADED,

        details: {
          count:
            list.length,

          capabilities:
            list,
        },

        message:
          list.length > 0
            ? "Agent capabilities are available."
            : "No agent capabilities are currently registered.",
      };
    } catch (error) {
      return this._failedCheck(
        error
      );
    }
  }

  // ==========================================================
  // SESSION CHECK
  // ==========================================================

  _checkSessions() {
    try {
      const runtime =
        this.manager.getRuntime();

      if (!runtime) {
        return {
          status:
            HEALTH_STATUS.UNHEALTHY,

          details: {},

          message:
            "Runtime unavailable for session diagnostics.",
        };
      }

      const methods = [
        "createSession",
        "getSession",
        "getSessionStatus",
        "addAction",
        "runSession",
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

      if (
        missing.length > 0
      ) {
        return {
          status:
            HEALTH_STATUS.DEGRADED,

          details: {
            available,
            missing,
          },

          message:
            "Some session operations are unavailable.",
        };
      }

      return {
        status:
          HEALTH_STATUS.HEALTHY,

        details: {
          available,
          missing: [],
        },

        message:
          "Session subsystem is available.",
      };
    } catch (error) {
      return this._failedCheck(
        error
      );
    }
  }

  // ==========================================================
  // WORKFLOW CHECK
  // ==========================================================

  _checkWorkflows() {
    try {
      const runtime =
        this.manager.getRuntime();

      if (!runtime) {
        return {
          status:
            HEALTH_STATUS.UNHEALTHY,

          details: {},

          message:
            "Runtime unavailable for workflow diagnostics.",
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

      if (
        missing.length > 0
      ) {
        return {
          status:
            HEALTH_STATUS.DEGRADED,

          details: {
            available,
            missing,
          },

          message:
            "Some workflow operations are unavailable.",
        };
      }

      return {
        status:
          HEALTH_STATUS.HEALTHY,

        details: {
          available,
          missing: [],
        },

        message:
          "Workflow subsystem is available.",
      };
    } catch (error) {
      return this._failedCheck(
        error
      );
    }
  }

  // ==========================================================
  // TOOL CHECK
  // ==========================================================

  _checkTools() {
    try {
      const runtime =
        this.manager.getRuntime();

      if (!runtime) {
        return {
          status:
            HEALTH_STATUS.UNHEALTHY,

          details: {},

          message:
            "Runtime unavailable for tool diagnostics.",
        };
      }

      const inspectAvailable =
        typeof runtime.inspectTool ===
        "function";

      const executeAvailable =
        typeof runtime.executeTool ===
        "function";

      if (
        !inspectAvailable
      ) {
        return {
          status:
            HEALTH_STATUS.UNHEALTHY,

          details: {
            inspectAvailable,
            executeAvailable,
          },

          message:
            "Tool inspection interface is unavailable.",
        };
      }

      if (
        !executeAvailable
      ) {
        return {
          status:
            HEALTH_STATUS.DEGRADED,

          details: {
            inspectAvailable,
            executeAvailable,
          },

          message:
            "Tool execution interface is unavailable.",
        };
      }

      return {
        status:
          HEALTH_STATUS.HEALTHY,

        details: {
          inspectAvailable,
          executeAvailable,
        },

        message:
          "Tool subsystem is available.",
      };
    } catch (error) {
      return this._failedCheck(
        error
      );
    }
  }

  // ==========================================================
  // VERIFICATION CHECK
  // ==========================================================

  _checkVerification() {
    try {
      const runtime =
        this.manager.getRuntime();

      if (!runtime) {
        return {
          status:
            HEALTH_STATUS.UNHEALTHY,

          details: {},

          message:
            "Runtime unavailable for verification diagnostics.",
        };
      }

      const resultAvailable =
        typeof runtime.verifyResult ===
        "function";

      const actionAvailable =
        typeof runtime.verifyAction ===
        "function";

      if (
        !resultAvailable &&
        !actionAvailable
      ) {
        return {
          status:
            HEALTH_STATUS.UNHEALTHY,

          details: {
            resultAvailable,
            actionAvailable,
          },

          message:
            "Verification subsystem is unavailable.",
        };
      }

      if (
        !resultAvailable ||
        !actionAvailable
      ) {
        return {
          status:
            HEALTH_STATUS.DEGRADED,

          details: {
            resultAvailable,
            actionAvailable,
          },

          message:
            "Verification subsystem is partially available.",
        };
      }

      return {
        status:
          HEALTH_STATUS.HEALTHY,

        details: {
          resultAvailable,
          actionAvailable,
        },

        message:
          "Verification subsystem is available.",
      };
    } catch (error) {
      return this._failedCheck(
        error
      );
    }
  }

  // ==========================================================
  // SUMMARY
  // ==========================================================

  _buildSummary(
    checks
  ) {
    const values =
      Object.values(
        checks
      );

    const unhealthy =
      values.filter(
        (item) =>
          item.status ===
          HEALTH_STATUS.UNHEALTHY
      ).length;

    const degraded =
      values.filter(
        (item) =>
          item.status ===
          HEALTH_STATUS.DEGRADED
      ).length;

    const healthy =
      values.filter(
        (item) =>
          item.status ===
          HEALTH_STATUS.HEALTHY
      ).length;

    let status =
      HEALTH_STATUS.HEALTHY;

    if (
      unhealthy > 0
    ) {
      status =
        HEALTH_STATUS.UNHEALTHY;
    } else if (
      degraded > 0
    ) {
      status =
        HEALTH_STATUS.DEGRADED;
    }

    return {
      status,

      total:
        values.length,

      healthy,

      degraded,

      unhealthy,
    };
  }

  // ==========================================================
  // FAILED CHECK
  // ==========================================================

  _failedCheck(error) {
    return {
      status:
        HEALTH_STATUS.UNHEALTHY,

      details: {
        error: {
          name:
            error?.name ||
            "Error",

          message:
            error?.message ||
            String(error),

          code:
            error?.code ||
            null,
        },
      },

      message:
        "Health check failed.",
    };
  }

  // ==========================================================
  // LAST RESULT
  // ==========================================================

  getLastResult() {
    return this.lastResult;
  }

  getLastCheckTime() {
    return this.lastCheck
      ? this.lastCheck.toISOString()
      : null;
  }

  getStats() {
    return {
      version:
        this.version,

      startedAt:
        this.startedAt.toISOString(),

      lastCheck:
        this.getLastCheckTime(),

      checkCount:
        this.checkCount,

      lastStatus:
        this.lastResult?.status ||
        null,
    };
  }

  resetStats() {
    this.startedAt =
      new Date();

    this.lastCheck =
      null;

    this.lastResult =
      null;

    this.checkCount =
      0;

    return this.getStats();
  }
}

// ============================================================
// SINGLETON
// ============================================================

let serviceInstance =
  null;

function getAgentRuntimeHealthService(
  options = {}
) {
  if (
    !serviceInstance
  ) {
    serviceInstance =
      new AgentRuntimeHealthService(
        options
      );
  }

  return serviceInstance;
}

function resetAgentRuntimeHealthService(
  options = {}
) {
  serviceInstance =
    new AgentRuntimeHealthService(
      options
    );

  return serviceInstance;
}

function createAgentRuntimeHealthService(
  options = {}
) {
  return new AgentRuntimeHealthService(
    options
  );
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  AgentRuntimeHealthService,

  getAgentRuntimeHealthService,
  resetAgentRuntimeHealthService,
  createAgentRuntimeHealthService,

  HEALTH_STATUS,

  AGENT_RUNTIME_HEALTH_SERVICE_VERSION,
};