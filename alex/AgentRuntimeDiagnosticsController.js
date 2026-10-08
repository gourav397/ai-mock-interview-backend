// ============================================================
// ALEX — Agent Runtime Diagnostics Controller
// Version: 1.0.0
//
// Purpose:
//   Controller layer for AgentRuntimeDiagnostics.
//
//   Read-only diagnostics interface.
//   Does not execute agent actions.
// ============================================================

"use strict";

const {
  getAgentRuntimeDiagnostics,
} = require("./AgentRuntimeDiagnostics");

const AGENT_RUNTIME_DIAGNOSTICS_CONTROLLER_VERSION =
  "1.0.0";

class AgentRuntimeDiagnosticsController {
  constructor(options = {}) {
    this.version =
      AGENT_RUNTIME_DIAGNOSTICS_CONTROLLER_VERSION;

    this.diagnostics =
      options.diagnostics ||
      getAgentRuntimeDiagnostics();
  }

  // ==========================================================
  // FULL SNAPSHOT
  // ==========================================================

  snapshot(options = {}) {
    try {
      return this._success(
        this.diagnostics.snapshot(
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
  // SUMMARY
  // ==========================================================

  summary() {
    try {
      return this._success(
        this.diagnostics.summary()
      );
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  // ==========================================================
  // HEALTH
  // ==========================================================

  health() {
    try {
      return this._success(
        this.diagnostics
          ._safeHealthCheck()
      );
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  // ==========================================================
  // HEALTH STATS
  // ==========================================================

  healthStats() {
    try {
      return this._success(
        this.diagnostics.healthStats()
      );
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
    try {
      return this._success(
        this.diagnostics.info()
      );
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  // ==========================================================
  // CAPABILITY DIAGNOSTICS
  // ==========================================================

  capabilities() {
    try {
      const data =
        this.diagnostics.snapshot();

      return this._success({
        capabilities:
          data?.diagnostics
            ?.capabilities ||
          null,
      });
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  // ==========================================================
  // SESSION DIAGNOSTICS
  // ==========================================================

  sessions() {
    try {
      const data =
        this.diagnostics.snapshot();

      return this._success({
        sessions:
          data?.diagnostics
            ?.sessions ||
          null,
      });
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  // ==========================================================
  // WORKFLOW DIAGNOSTICS
  // ==========================================================

  workflows() {
    try {
      const data =
        this.diagnostics.snapshot();

      return this._success({
        workflows:
          data?.diagnostics
            ?.workflows ||
          null,
      });
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  // ==========================================================
  // TOOL DIAGNOSTICS
  // ==========================================================

  tools() {
    try {
      const data =
        this.diagnostics.snapshot();

      return this._success({
        tools:
          data?.diagnostics
            ?.tools ||
          null,
      });
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  // ==========================================================
  // VERIFICATION DIAGNOSTICS
  // ==========================================================

  verification() {
    try {
      const data =
        this.diagnostics.snapshot();

      return this._success({
        verification:
          data?.diagnostics
            ?.verification ||
          null,
      });
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  // ==========================================================
  // ALL HANDLERS
  // ==========================================================

  handlers() {
    return {
      snapshot:
        this.snapshot.bind(
          this
        ),

      summary:
        this.summary.bind(
          this
        ),

      health:
        this.health.bind(
          this
        ),

      healthStats:
        this.healthStats.bind(
          this
        ),

      info:
        this.info.bind(
          this
        ),

      capabilities:
        this.capabilities.bind(
          this
        ),

      sessions:
        this.sessions.bind(
          this
        ),

      workflows:
        this.workflows.bind(
          this
        ),

      tools:
        this.tools.bind(
          this
        ),

      verification:
        this.verification.bind(
          this
        ),
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

function getAgentRuntimeDiagnosticsController(
  options = {}
) {
  if (
    !controllerInstance
  ) {
    controllerInstance =
      new AgentRuntimeDiagnosticsController(
        options
      );
  }

  return controllerInstance;
}

function resetAgentRuntimeDiagnosticsController(
  options = {}
) {
  controllerInstance =
    new AgentRuntimeDiagnosticsController(
      options
    );

  return controllerInstance;
}

function createAgentRuntimeDiagnosticsController(
  options = {}
) {
  return new AgentRuntimeDiagnosticsController(
    options
  );
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  AgentRuntimeDiagnosticsController,

  getAgentRuntimeDiagnosticsController,
  resetAgentRuntimeDiagnosticsController,
  createAgentRuntimeDiagnosticsController,

  AGENT_RUNTIME_DIAGNOSTICS_CONTROLLER_VERSION,
};