// ============================================================
// ALEX — Agent Runtime Bootstrap
// Version: 1.0.0
//
// Purpose:
//   Initializes the unified Agent Runtime safely.
//
//   Responsibilities:
//   - Create the runtime
//   - Expose runtime/API references
//   - Perform startup health checks
//   - Prevent duplicate initialization
//   - Provide shutdown/reset support
//
//   This file does NOT modify server.js or existing ALEX files.
// ============================================================

"use strict";

const {
  createAgentRuntimeFactory,
} = require("./AgentRuntimeFactory");

const AGENT_RUNTIME_BOOTSTRAP_VERSION =
  "1.0.0";

const BOOTSTRAP_STATUS = Object.freeze({
  CREATED: "created",
  INITIALIZING: "initializing",
  READY: "ready",
  DEGRADED: "degraded",
  FAILED: "failed",
  STOPPED: "stopped",
});

class AgentRuntimeBootstrap {
  constructor(options = {}) {
    this.version =
      AGENT_RUNTIME_BOOTSTRAP_VERSION;

    this.options = {
      ...options,
    };

    this.factory =
      options.factory ||
      createAgentRuntimeFactory({
        mode:
          options.mode,
      });

    this.bundle =
      null;

    this.status =
      BOOTSTRAP_STATUS.CREATED;

    this.initializedAt =
      null;

    this.stoppedAt =
      null;

    this.error =
      null;

    this.healthResult =
      null;

    this.startupEvents = [];

    this._record(
      "bootstrap_created"
    );
  }

  // ==========================================================
  // INITIALIZE
  // ==========================================================

  initialize() {
    if (
      this.status ===
      BOOTSTRAP_STATUS.READY
    ) {
      return this.getResult();
    }

    if (
      this.status ===
      BOOTSTRAP_STATUS.INITIALIZING
    ) {
      return this.getResult();
    }

    this.status =
      BOOTSTRAP_STATUS.INITIALIZING;

    this._record(
      "bootstrap_initializing"
    );

    try {
      this.bundle =
        this.factory.create({
          ...this.options,

          factory:
            undefined,
        });

      this.initializedAt =
        Date.now();

      this._record(
        "runtime_created"
      );

      const health =
        this.health();

      this.healthResult =
        health;

      if (
        health.healthy
      ) {
        this.status =
          BOOTSTRAP_STATUS.READY;

        this._record(
          "bootstrap_ready"
        );
      } else {
        this.status =
          BOOTSTRAP_STATUS.DEGRADED;

        this._record(
          "bootstrap_degraded",
          {
            health,
          }
        );
      }

      return this.getResult();
    } catch (error) {
      this.error =
        this._serializeError(
          error
        );

      this.status =
        BOOTSTRAP_STATUS.FAILED;

      this._record(
        "bootstrap_failed",
        {
          error:
            this.error,
        }
      );

      return this.getResult();
    }
  }

  // ==========================================================
  // ENSURE INITIALIZED
  // ==========================================================

  ensureInitialized() {
    if (
      this.status ===
        BOOTSTRAP_STATUS.READY ||
      this.status ===
        BOOTSTRAP_STATUS.DEGRADED
    ) {
      return this.bundle;
    }

    const result =
      this.initialize();

    if (
      !result.success
    ) {
      throw new Error(
        result.error?.message ||
          "Agent Runtime initialization failed"
      );
    }

    return this.bundle;
  }

  // ==========================================================
  // RUNTIME
  // ==========================================================

  getRuntime() {
    this.ensureInitialized();

    return (
      this.bundle?.runtime ||
      null
    );
  }

  // ==========================================================
  // API
  // ==========================================================

  getAPI() {
    this.ensureInitialized();

    return (
      this.bundle?.api ||
      null
    );
  }

  // ==========================================================
  // COMPONENTS
  // ==========================================================

  getComponents() {
    this.ensureInitialized();

    if (!this.bundle) {
      return {};
    }

    return {
      capabilityManager:
        this.bundle
          .capabilityManager ||
        null,

      sessionCoordinator:
        this.bundle
          .sessionCoordinator ||
        null,

      sessionBridge:
        this.bundle
          .sessionBridge ||
        null,

      taskAdapter:
        this.bundle
          .taskAdapter ||
        null,

      workflowCoordinator:
        this.bundle
          .workflowCoordinator ||
        null,

      orchestrator:
        this.bundle
          .orchestrator ||
        null,

      verificationEngine:
        this.bundle
          .verificationEngine ||
        null,

      executionVerifier:
        this.bundle
          .executionVerifier ||
        null,
    };
  }

  // ==========================================================
  // HEALTH
  // ==========================================================

  health() {
    try {
      if (
        !this.bundle?.runtime
      ) {
        return {
          healthy: false,

          status:
            "not_initialized",

          version:
            this.version,

          timestamp:
            new Date().toISOString(),
        };
      }

      const runtime =
        this.bundle.runtime;

      if (
        typeof runtime.health !==
        "function"
      ) {
        return {
          healthy: false,

          status:
            "runtime_health_unavailable",

          version:
            this.version,

          timestamp:
            new Date().toISOString(),
        };
      }

      return runtime.health();
    } catch (error) {
      return {
        healthy: false,

        status:
          "health_check_failed",

        error:
          this._serializeError(
            error
          ),

        timestamp:
          new Date().toISOString(),
      };
    }
  }

  // ==========================================================
  // STATUS
  // ==========================================================

  getStatus() {
    return {
      version:
        this.version,

      status:
        this.status,

      initialized:
        Boolean(
          this.bundle
        ),

      initializedAt:
        this.initializedAt,

      stoppedAt:
        this.stoppedAt,

      error:
        this.error,

      health:
        this.healthResult ||
        (
          this.bundle
            ? this.health()
            : null
        ),

      runtime:
        this.bundle?.runtime &&
        typeof this.bundle.runtime.getStatus ===
          "function"
          ? this.bundle.runtime.getStatus()
          : null,
    };
  }

  // ==========================================================
  // RESULT
  // ==========================================================

  getResult() {
    return {
      success:
        this.status !==
          BOOTSTRAP_STATUS.FAILED,

      version:
        this.version,

      status:
        this.status,

      initialized:
        Boolean(
          this.bundle
        ),

      runtime:
        this.bundle?.runtime ||
        null,

      api:
        this.bundle?.api ||
        null,

      health:
        this.healthResult,

      error:
        this.error,

      initializedAt:
        this.initializedAt,
    };
  }

  // ==========================================================
  // SNAPSHOT
  // ==========================================================

  snapshot() {
    return {
      version:
        this.version,

      status:
        this.status,

      initialized:
        Boolean(
          this.bundle
        ),

      initializedAt:
        this.initializedAt,

      stoppedAt:
        this.stoppedAt,

      health:
        this.healthResult,

      factory:
        this.factory &&
        typeof this.factory.describe ===
          "function"
          ? this.factory.describe()
          : null,

      runtime:
        this.bundle?.runtime &&
        typeof this.bundle.runtime.snapshot ===
          "function"
          ? this.bundle.runtime.snapshot()
          : null,

      events:
        this.startupEvents.length,
    };
  }

  // ==========================================================
  // STOP
  // ==========================================================

  stop() {
    if (
      this.status ===
      BOOTSTRAP_STATUS.STOPPED
    ) {
      return {
        success: true,

        status:
          this.status,

        alreadyStopped: true,
      };
    }

    this._record(
      "bootstrap_stopping"
    );

    this.stoppedAt =
      Date.now();

    this.status =
      BOOTSTRAP_STATUS.STOPPED;

    this._record(
      "bootstrap_stopped"
    );

    return {
      success: true,

      status:
        this.status,

      stoppedAt:
        this.stoppedAt,
    };
  }

  // ==========================================================
  // RESET
  // ==========================================================

  reset() {
    this._record(
      "bootstrap_resetting"
    );

    this.bundle =
      null;

    this.initializedAt =
      null;

    this.stoppedAt =
      null;

    this.error =
      null;

    this.healthResult =
      null;

    this.status =
      BOOTSTRAP_STATUS.CREATED;

    this._record(
      "bootstrap_reset"
    );

    return {
      success: true,

      status:
        this.status,
    };
  }

  // ==========================================================
  // STARTUP EVENTS
  // ==========================================================

  getEvents(options = {}) {
    const limit =
      Number.isFinite(
        options.limit
      )
        ? Math.max(
            1,
            Math.min(
              1000,
              options.limit
            )
          )
        : 100;

    const reverse =
      options.reverse === true;

    const events =
      reverse
        ? [
            ...this.startupEvents,
          ].reverse()
        : [
            ...this.startupEvents,
          ];

    return events.slice(
      0,
      limit
    );
  }

  clearEvents() {
    const count =
      this.startupEvents.length;

    this.startupEvents =
      [];

    return {
      success: true,

      cleared:
        count,
    };
  }

  // ==========================================================
  // INTERNAL EVENT
  // ==========================================================

  _record(
    type,
    data = {}
  ) {
    this.startupEvents.push({
      id:
        `bootstrap_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}`,

      type,

      timestamp:
        Date.now(),

      data,
    });

    if (
      this.startupEvents.length >
      500
    ) {
      this.startupEvents.splice(
        0,
        this.startupEvents.length -
          500
      );
    }
  }

  // ==========================================================
  // INTERNAL ERROR SERIALIZER
  // ==========================================================

  _serializeError(
    error
  ) {
    if (!error) {
      return null;
    }

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
}

// ============================================================
// SINGLETON
// ============================================================

let bootstrapInstance =
  null;

function getAgentRuntimeBootstrap(
  options = {}
) {
  if (
    !bootstrapInstance
  ) {
    bootstrapInstance =
      new AgentRuntimeBootstrap(
        options
      );
  }

  return bootstrapInstance;
}

function resetAgentRuntimeBootstrap(
  options = {}
) {
  bootstrapInstance =
    new AgentRuntimeBootstrap(
      options
    );

  return bootstrapInstance;
}

function createAgentRuntimeBootstrap(
  options = {}
) {
  return new AgentRuntimeBootstrap(
    options
  );
}

// ============================================================
// CONVENIENCE START
// ============================================================

function initializeAgentRuntime(
  options = {}
) {
  const bootstrap =
    getAgentRuntimeBootstrap(
      options
    );

  return bootstrap.initialize();
}

// ============================================================
// CONVENIENCE ACCESSORS
// ============================================================

function getAgentRuntime() {
  const bootstrap =
    getAgentRuntimeBootstrap();

  return bootstrap.getRuntime();
}

function getAgentRuntimeAPI() {
  const bootstrap =
    getAgentRuntimeBootstrap();

  return bootstrap.getAPI();
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  AgentRuntimeBootstrap,

  getAgentRuntimeBootstrap,
  resetAgentRuntimeBootstrap,
  createAgentRuntimeBootstrap,

  initializeAgentRuntime,

  getAgentRuntime,
  getAgentRuntimeAPI,

  AGENT_RUNTIME_BOOTSTRAP_VERSION,
  BOOTSTRAP_STATUS,
};