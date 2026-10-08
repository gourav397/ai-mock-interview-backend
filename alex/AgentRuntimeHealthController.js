// ============================================================
// ALEX — Agent Runtime Health Controller
// Version: 1.0.0
//
// Purpose:
//   Controller layer for AgentRuntimeHealthService.
//
//   Provides health, diagnostics, statistics and reset handlers.
//   Does NOT register Express routes.
// ============================================================

"use strict";

const {
  getAgentRuntimeHealthService,
} = require("./AgentRuntimeHealthService");

const AGENT_RUNTIME_HEALTH_CONTROLLER_VERSION =
  "1.0.0";

class AgentRuntimeHealthController {
  constructor(options = {}) {
    this.version =
      AGENT_RUNTIME_HEALTH_CONTROLLER_VERSION;

    this.service =
      options.service ||
      getAgentRuntimeHealthService();
  }

  // ==========================================================
  // FULL HEALTH CHECK
  // ==========================================================

  check(options = {}) {
    try {
      return this._success(
        this.service.check(
          options
        )
      );
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  // ==========================================================
  // QUICK CHECK
  // ==========================================================

  quickCheck() {
    try {
      return this._success(
        this.service.quickCheck()
      );
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  // ==========================================================
  // LAST RESULT
  // ==========================================================

  lastResult() {
    try {
      return this._success({
        result:
          this.service.getLastResult(),

        lastCheck:
          this.service.getLastCheckTime(),
      });
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  // ==========================================================
  // STATISTICS
  // ==========================================================

  stats() {
    try {
      return this._success(
        this.service.getStats()
      );
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  // ==========================================================
  // RESET STATISTICS
  // ==========================================================

  resetStats() {
    try {
      return this._success(
        this.service.resetStats()
      );
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  // ==========================================================
  // DIAGNOSTICS
  // ==========================================================

  diagnostics() {
    try {
      const health =
        this.service.check();

      const stats =
        this.service.getStats();

      return this._success({
        health,

        stats,

        controller: {
          version:
            this.version,

          timestamp:
            new Date().toISOString(),
        },
      });
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  // ==========================================================
  // INFO
  // ==========================================================

  info() {
    return {
      success: true,

      controllerVersion:
        this.version,

      serviceVersion:
        this.service.version,

      timestamp:
        new Date().toISOString(),
    };
  }

  // ==========================================================
  // RESPONSE HELPERS
  // ==========================================================

  _success(data) {
    return {
      success: true,

      controllerVersion:
        this.version,

      data,
    };
  }

  _error(error) {
    return {
      success: false,

      controllerVersion:
        this.version,

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
    };
  }
}

// ============================================================
// SINGLETON
// ============================================================

let controllerInstance =
  null;

function getAgentRuntimeHealthController(
  options = {}
) {
  if (
    !controllerInstance
  ) {
    controllerInstance =
      new AgentRuntimeHealthController(
        options
      );
  }

  return controllerInstance;
}

function resetAgentRuntimeHealthController(
  options = {}
) {
  controllerInstance =
    new AgentRuntimeHealthController(
      options
    );

  return controllerInstance;
}

function createAgentRuntimeHealthController(
  options = {}
) {
  return new AgentRuntimeHealthController(
    options
  );
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  AgentRuntimeHealthController,

  getAgentRuntimeHealthController,
  resetAgentRuntimeHealthController,
  createAgentRuntimeHealthController,

  AGENT_RUNTIME_HEALTH_CONTROLLER_VERSION,
};