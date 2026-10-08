// ============================================================
// ALEX — Agent Runtime Manager
// Version: 1.0.0
//
// Purpose:
//   Manages the lifecycle of the unified Agent Runtime.
//
//   Responsibilities:
//   - Start runtime
//   - Stop runtime
//   - Restart runtime
//   - Health monitoring
//   - Runtime status
//   - Runtime events
//   - Safe access to Runtime + API
//
//   This file does NOT modify server.js or existing ALEX files.
// ============================================================

"use strict";

const {
  getAgentRuntimeBootstrap,
} = require("./AgentRuntimeBootstrap");

const AGENT_RUNTIME_MANAGER_VERSION =
  "1.0.0";

const MANAGER_STATUS = Object.freeze({
  CREATED: "created",
  STARTING: "starting",
  READY: "ready",
  DEGRADED: "degraded",
  FAILED: "failed",
  STOPPING: "stopping",
  STOPPED: "stopped",
});

class AgentRuntimeManager {
  constructor(options = {}) {
    this.version =
      AGENT_RUNTIME_MANAGER_VERSION;

    this.options = {
      ...options,
    };

    this.bootstrap =
      options.bootstrap ||
      getAgentRuntimeBootstrap({
        ...options,
      });

    this.status =
      MANAGER_STATUS.CREATED;

    this.createdAt =
      Date.now();

    this.startedAt =
      null;

    this.stoppedAt =
      null;

    this.lastHealthCheckAt =
      null;

    this.lastHealth =
      null;

    this.events =
      [];

    this.maxEvents =
      Number.isFinite(
        options.maxEvents
      )
        ? Math.max(
            100,
            Math.min(
              5000,
              options.maxEvents
            )
          )
        : 1000;

    this.healthIntervalMs =
      Number.isFinite(
        options.healthIntervalMs
      )
        ? Math.max(
            5000,
            options.healthIntervalMs
          )
        : 30000;

    this.healthTimer =
      null;

    this.autoHealthCheck =
      options.autoHealthCheck !== false;

    this._record(
      "manager_created"
    );
  }

  // ==========================================================
  // START
  // ==========================================================

  start() {
    if (
      this.status ===
        MANAGER_STATUS.READY ||
      this.status ===
        MANAGER_STATUS.DEGRADED
    ) {
      return this.getResult();
    }

    if (
      this.status ===
      MANAGER_STATUS.STARTING
    ) {
      return this.getResult();
    }

    this.status =
      MANAGER_STATUS.STARTING;

    this._record(
      "manager_starting"
    );

    try {
      const result =
        this.bootstrap.initialize();

      this.startedAt =
        Date.now();

      if (
        result.status ===
        "ready"
      ) {
        this.status =
          MANAGER_STATUS.READY;
      } else if (
        result.status ===
        "degraded"
      ) {
        this.status =
          MANAGER_STATUS.DEGRADED;
      } else {
        this.status =
          MANAGER_STATUS.FAILED;
      }

      this.lastHealth =
        result.health ||
        null;

      this.lastHealthCheckAt =
        Date.now();

      this._record(
        "manager_started",
        {
          status:
            this.status,

          success:
            result.success,
        }
      );

      if (
        this.autoHealthCheck &&
        this.status !==
          MANAGER_STATUS.FAILED
      ) {
        this._startHealthMonitor();
      }

      return this.getResult();
    } catch (error) {
      this.status =
        MANAGER_STATUS.FAILED;

      this._record(
        "manager_start_failed",
        {
          error:
            this._serializeError(
              error
            ),
        }
      );

      return this.getResult();
    }
  }

  // ==========================================================
  // ENSURE STARTED
  // ==========================================================

  ensureStarted() {
    if (
      this.status ===
        MANAGER_STATUS.READY ||
      this.status ===
        MANAGER_STATUS.DEGRADED
    ) {
      return this;
    }

    const result =
      this.start();

    if (
      !result.success
    ) {
      throw new Error(
        result.error?.message ||
          "ALEX Agent Runtime failed to start"
      );
    }

    return this;
  }

  // ==========================================================
  // GET RUNTIME
  // ==========================================================

  getRuntime() {
    this.ensureStarted();

    return this.bootstrap.getRuntime();
  }

  // ==========================================================
  // GET API
  // ==========================================================

  getAPI() {
    this.ensureStarted();

    return this.bootstrap.getAPI();
  }

  // ==========================================================
  // HEALTH
  // ==========================================================

  checkHealth() {
    try {
      const health =
        this.bootstrap.health();

      this.lastHealth =
        health;

      this.lastHealthCheckAt =
        Date.now();

      if (
        health.healthy
      ) {
        if (
          this.status !==
          MANAGER_STATUS.STOPPED
        ) {
          this.status =
            MANAGER_STATUS.READY;
        }
      } else if (
        this.status !==
        MANAGER_STATUS.STOPPED
      ) {
        this.status =
          MANAGER_STATUS.DEGRADED;
      }

      this._record(
        "health_checked",
        {
          healthy:
            health.healthy,

          status:
            health.status,
        }
      );

      return health;
    } catch (error) {
      const health = {
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

      this.lastHealth =
        health;

      this.lastHealthCheckAt =
        Date.now();

      this.status =
        MANAGER_STATUS.DEGRADED;

      this._record(
        "health_check_failed",
        {
          error:
            health.error,
        }
      );

      return health;
    }
  }

  // ==========================================================
  // STOP
  // ==========================================================

  stop() {
    if (
      this.status ===
      MANAGER_STATUS.STOPPED
    ) {
      return {
        success: true,

        status:
          this.status,

        alreadyStopped: true,
      };
    }

    this.status =
      MANAGER_STATUS.STOPPING;

    this._record(
      "manager_stopping"
    );

    this._stopHealthMonitor();

    try {
      const result =
        this.bootstrap.stop();

      this.stoppedAt =
        Date.now();

      this.status =
        MANAGER_STATUS.STOPPED;

      this._record(
        "manager_stopped"
      );

      return {
        success:
          result?.success !== false,

        status:
          this.status,

        stoppedAt:
          this.stoppedAt,
      };
    } catch (error) {
      this.status =
        MANAGER_STATUS.FAILED;

      this._record(
        "manager_stop_failed",
        {
          error:
            this._serializeError(
              error
            ),
        }
      );

      return {
        success: false,

        status:
          this.status,

        error:
          this._serializeError(
            error
          ),
      };
    }
  }

  // ==========================================================
  // RESTART
  // ==========================================================

  restart() {
    this._record(
      "manager_restart_requested"
    );

    this.stop();

    this.bootstrap.reset();

    this.status =
      MANAGER_STATUS.CREATED;

    this.startedAt =
      null;

    this.stoppedAt =
      null;

    this.lastHealth =
      null;

    this.lastHealthCheckAt =
      null;

    return this.start();
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

      createdAt:
        this.createdAt,

      startedAt:
        this.startedAt,

      stoppedAt:
        this.stoppedAt,

      lastHealthCheckAt:
        this.lastHealthCheckAt,

      lastHealth:
        this.lastHealth,

      uptime:
        this.startedAt &&
        !this.stoppedAt
          ? Date.now() -
            this.startedAt
          : null,

      healthMonitor:
        {
          enabled:
            this.autoHealthCheck,

          running:
            Boolean(
              this.healthTimer
            ),

          intervalMs:
            this.healthIntervalMs,
        },
    };
  }

  // ==========================================================
  // RESULT
  // ==========================================================

  getResult() {
    const failed =
      this.status ===
      MANAGER_STATUS.FAILED;

    return {
      success:
        !failed,

      version:
        this.version,

      status:
        this.status,

      runtime:
        !failed &&
        this.bootstrap
          ? this.bootstrap.getRuntime()
          : null,

      api:
        !failed &&
        this.bootstrap
          ? this.bootstrap.getAPI()
          : null,

      health:
        this.lastHealth,

      error:
        failed
          ? this.bootstrap?.getStatus()
              ?.error ||
            null
          : null,
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

      createdAt:
        this.createdAt,

      startedAt:
        this.startedAt,

      stoppedAt:
        this.stoppedAt,

      lastHealthCheckAt:
        this.lastHealthCheckAt,

      health:
        this.lastHealth,

      healthMonitor:
        {
          enabled:
            this.autoHealthCheck,

          running:
            Boolean(
              this.healthTimer
            ),

          intervalMs:
            this.healthIntervalMs,
        },

      bootstrap:
        this.bootstrap &&
        typeof this.bootstrap.snapshot ===
          "function"
          ? this.bootstrap.snapshot()
          : null,

      events:
        this.events.length,
    };
  }

  // ==========================================================
  // EVENTS
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
            ...this.events,
          ].reverse()
        : [
            ...this.events,
          ];

    return events.slice(
      0,
      limit
    );
  }

  clearEvents() {
    const count =
      this.events.length;

    this.events =
      [];

    return {
      success: true,

      cleared:
        count,
    };
  }

  // ==========================================================
  // HEALTH MONITOR
  // ==========================================================

  _startHealthMonitor() {
    this._stopHealthMonitor();

    this.healthTimer =
      setInterval(
        () => {
          try {
            this.checkHealth();
          } catch {
            // Health monitor must never
            // crash the Node process.
          }
        },
        this.healthIntervalMs
      );

    if (
      this.healthTimer &&
      typeof this.healthTimer.unref ===
        "function"
    ) {
      this.healthTimer.unref();
    }

    this._record(
      "health_monitor_started",
      {
        intervalMs:
          this.healthIntervalMs,
      }
    );
  }

  _stopHealthMonitor() {
    if (
      this.healthTimer
    ) {
      clearInterval(
        this.healthTimer
      );

      this.healthTimer =
        null;

      this._record(
        "health_monitor_stopped"
      );
    }
  }

  // ==========================================================
  // INTERNAL EVENT LOGGER
  // ==========================================================

  _record(
    type,
    data = {}
  ) {
    this.events.push({
      id:
        `runtime_manager_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}`,

      type,

      timestamp:
        Date.now(),

      data,
    });

    if (
      this.events.length >
      this.maxEvents
    ) {
      this.events.splice(
        0,
        this.events.length -
          this.maxEvents
      );
    }
  }

  // ==========================================================
  // ERROR SERIALIZER
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

let managerInstance =
  null;

function getAgentRuntimeManager(
  options = {}
) {
  if (
    !managerInstance
  ) {
    managerInstance =
      new AgentRuntimeManager(
        options
      );
  }

  return managerInstance;
}

function resetAgentRuntimeManager(
  options = {}
) {
  if (
    managerInstance
  ) {
    try {
      managerInstance.stop();
    } catch {
      // Ignore cleanup errors.
    }
  }

  managerInstance =
    new AgentRuntimeManager(
      options
    );

  return managerInstance;
}

function createAgentRuntimeManager(
  options = {}
) {
  return new AgentRuntimeManager(
    options
  );
}

// ============================================================
// CONVENIENCE START
// ============================================================

function startAgentRuntime(
  options = {}
) {
  const manager =
    getAgentRuntimeManager(
      options
    );

  return manager.start();
}

// ============================================================
// CONVENIENCE STOP
// ============================================================

function stopAgentRuntime() {
  if (
    !managerInstance
  ) {
    return {
      success: true,

      status:
        MANAGER_STATUS.STOPPED,

      alreadyStopped: true,
    };
  }

  return managerInstance.stop();
}

// ============================================================
// CONVENIENCE ACCESS
// ============================================================

function getAgentRuntime() {
  return getAgentRuntimeManager()
    .getRuntime();
}

function getAgentRuntimeAPI() {
  return getAgentRuntimeManager()
    .getAPI();
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  AgentRuntimeManager,

  getAgentRuntimeManager,
  resetAgentRuntimeManager,
  createAgentRuntimeManager,

  startAgentRuntime,
  stopAgentRuntime,

  getAgentRuntime,
  getAgentRuntimeAPI,

  AGENT_RUNTIME_MANAGER_VERSION,
  MANAGER_STATUS,
};