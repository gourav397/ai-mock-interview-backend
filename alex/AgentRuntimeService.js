"use strict";

// ============================================================
// ALEX Agent Runtime Service
// File: backend/alex/AgentRuntimeService.js
//
// Purpose:
// High-level service layer for the ALEX Agent Runtime.
//
// This service keeps application/business logic separate from
// Express routes and controllers.
//
// It does NOT modify server.js.
// ============================================================

const {
  createAgentRuntimeManager,
} = require("./AgentRuntimeManager");

const {
  createAgentRuntimeDiagnostics,
} = require("./AgentRuntimeDiagnostics");


// ============================================================
// SERVICE STATUS
// ============================================================

const SERVICE_STATUS = Object.freeze({
  CREATED: "created",
  STARTING: "starting",
  READY: "ready",
  DEGRADED: "degraded",
  FAILED: "failed",
  STOPPING: "stopping",
  STOPPED: "stopped",
});


// ============================================================
// SAFE ERROR
// ============================================================

function safeError(error) {
  if (!error) {
    return {
      name: "Error",
      message: "Unknown error",
    };
  }

  return {
    name: error.name || "Error",
    message: error.message || String(error),
    code: error.code || undefined,
  };
}


// ============================================================
// SERVICE
// ============================================================

class AgentRuntimeService {
  constructor(options = {}) {
    this.options = {
      ...options,
    };

    this.manager =
      options.manager ||
      createAgentRuntimeManager(options);

    this.diagnostics =
      options.diagnostics ||
      createAgentRuntimeDiagnostics({
        ...options,
        manager: this.manager,
      });

    this.status = SERVICE_STATUS.CREATED;

    this.createdAt = new Date().toISOString();

    this.startedAt = null;

    this.stoppedAt = null;

    this.lastError = null;

    this.operationCount = 0;

    this.successCount = 0;

    this.failureCount = 0;
  }


  // ==========================================================
  // INTERNAL OPERATION WRAPPER
  // ==========================================================

  async _operation(name, handler) {
    this.operationCount += 1;

    try {
      const result = await handler();

      this.successCount += 1;

      this.lastError = null;

      return result;
    } catch (error) {
      this.failureCount += 1;

      this.lastError = {
        operation: name,
        ...safeError(error),
        timestamp: new Date().toISOString(),
      };

      throw error;
    }
  }


  // ==========================================================
  // START
  // ==========================================================

  async start() {
    return this._operation(
      "start",
      async () => {
        this.status = SERVICE_STATUS.STARTING;

        const result =
          await this.manager.start();

        this.status = SERVICE_STATUS.READY;

        this.startedAt =
          new Date().toISOString();

        this.stoppedAt = null;

        return {
          success: true,
          status: this.status,
          result,
          timestamp: new Date().toISOString(),
        };
      }
    ).catch((error) => {
      this.status = SERVICE_STATUS.FAILED;

      throw error;
    });
  }


  // ==========================================================
  // ENSURE STARTED
  // ==========================================================

  async ensureStarted() {
    return this._operation(
      "ensureStarted",
      async () => {
        const result =
          await this.manager.ensureStarted();

        this.status = SERVICE_STATUS.READY;

        if (!this.startedAt) {
          this.startedAt =
            new Date().toISOString();
        }

        return {
          success: true,
          status: this.status,
          result,
          timestamp: new Date().toISOString(),
        };
      }
    );
  }


  // ==========================================================
  // STOP
  // ==========================================================

  async stop() {
    return this._operation(
      "stop",
      async () => {
        this.status =
          SERVICE_STATUS.STOPPING;

        const result =
          await this.manager.stop();

        this.status =
          SERVICE_STATUS.STOPPED;

        this.stoppedAt =
          new Date().toISOString();

        return {
          success: true,
          status: this.status,
          result,
          timestamp: new Date().toISOString(),
        };
      }
    ).catch((error) => {
      this.status = SERVICE_STATUS.FAILED;

      throw error;
    });
  }


  // ==========================================================
  // RESTART
  // ==========================================================

  async restart() {
    return this._operation(
      "restart",
      async () => {
        this.status =
          SERVICE_STATUS.STARTING;

        const result =
          await this.manager.restart();

        this.status =
          SERVICE_STATUS.READY;

        this.startedAt =
          new Date().toISOString();

        this.stoppedAt = null;

        return {
          success: true,
          status: this.status,
          result,
          timestamp: new Date().toISOString(),
        };
      }
    ).catch((error) => {
      this.status = SERVICE_STATUS.FAILED;

      throw error;
    });
  }


  // ==========================================================
  // STATUS
  // ==========================================================

  getStatus() {
    let managerStatus = null;

    try {
      managerStatus =
        this.manager.getStatus();
    } catch (error) {
      managerStatus = null;
    }

    return {
      success: true,

      service: "ALEX Agent Runtime Service",

      status: this.status,

      managerStatus,

      createdAt: this.createdAt,

      startedAt: this.startedAt,

      stoppedAt: this.stoppedAt,

      lastError: this.lastError,

      statistics: {
        operations: this.operationCount,
        successful: this.successCount,
        failed: this.failureCount,
      },

      timestamp: new Date().toISOString(),
    };
  }


  // ==========================================================
  // HEALTH
  // ==========================================================

  async health() {
    return this._operation(
      "health",
      async () => {
        const result =
          await this.manager.checkHealth();

        const healthy =
          result?.healthy === true ||
          result?.success === true ||
          result?.status === "healthy" ||
          result?.status === "ready";

        if (!healthy) {
          this.status =
            SERVICE_STATUS.DEGRADED;
        } else if (
          this.status !== SERVICE_STATUS.STOPPED
        ) {
          this.status =
            SERVICE_STATUS.READY;
        }

        return {
          success: true,
          healthy,
          status: this.status,
          result,
          timestamp: new Date().toISOString(),
        };
      }
    );
  }


  // ==========================================================
  // SNAPSHOT
  // ==========================================================

  async snapshot() {
    return this._operation(
      "snapshot",
      async () => {
        const result =
          await this.manager.snapshot();

        return {
          success: true,
          result,
          timestamp: new Date().toISOString(),
        };
      }
    );
  }


  // ==========================================================
  // DIAGNOSTICS
  // ==========================================================

  async diagnostics() {
    return this._operation(
      "diagnostics",
      async () => {
        const result =
          await this.diagnostics.snapshot();

        return {
          success: true,
          result,
          timestamp: new Date().toISOString(),
        };
      }
    );
  }


  // ==========================================================
  // DIAGNOSTIC SUMMARY
  // ==========================================================

  async diagnosticSummary() {
    return this._operation(
      "diagnosticSummary",
      async () => {
        const result =
          await this.diagnostics.summary();

        return {
          success: true,
          result,
          timestamp: new Date().toISOString(),
        };
      }
    );
  }


  // ==========================================================
  // CAPABILITIES
  // ==========================================================

  async capabilities() {
    return this._operation(
      "capabilities",
      async () => {
        const runtime =
          await this.manager.getRuntime();

        if (
          !runtime ||
          typeof runtime.getCapabilities !==
            "function"
        ) {
          throw new Error(
            "Agent Runtime capability API is unavailable"
          );
        }

        const result =
          await runtime.getCapabilities();

        return {
          success: true,
          result,
          timestamp: new Date().toISOString(),
        };
      }
    );
  }


  // ==========================================================
  // EVENTS
  // ==========================================================

  async events(options = {}) {
    return this._operation(
      "events",
      async () => {
        const runtime =
          await this.manager.getRuntime();

        if (
          !runtime ||
          typeof runtime.getEvents !==
            "function"
        ) {
          throw new Error(
            "Agent Runtime event API is unavailable"
          );
        }

        const result =
          await runtime.getEvents(options);

        return {
          success: true,
          result,
          timestamp: new Date().toISOString(),
        };
      }
    );
  }


  // ==========================================================
  // CLEAR EVENTS
  // ==========================================================

  async clearEvents() {
    return this._operation(
      "clearEvents",
      async () => {
        const runtime =
          await this.manager.getRuntime();

        if (
          !runtime ||
          typeof runtime.clearEvents !==
            "function"
        ) {
          throw new Error(
            "Agent Runtime event API is unavailable"
          );
        }

        const result =
          await runtime.clearEvents();

        return {
          success: true,
          result,
          timestamp: new Date().toISOString(),
        };
      }
    );
  }


  // ==========================================================
  // SERVICE INFO
  // ==========================================================

  getInfo() {
    return {
      success: true,

      service: "ALEX Agent Runtime Service",

      version: "1.0.0",

      status: this.status,

      capabilities: {
        lifecycle: true,
        health: true,
        diagnostics: true,
        capabilities: true,
        events: true,
      },

      createdAt: this.createdAt,

      startedAt: this.startedAt,

      stoppedAt: this.stoppedAt,

      statistics: {
        operations: this.operationCount,
        successful: this.successCount,
        failed: this.failureCount,
      },

      timestamp: new Date().toISOString(),
    };
  }


  // ==========================================================
  // RESET STATISTICS
  // ==========================================================

  resetStatistics() {
    this.operationCount = 0;
    this.successCount = 0;
    this.failureCount = 0;
    this.lastError = null;

    return {
      success: true,
      reset: true,
      timestamp: new Date().toISOString(),
    };
  }
}


// ============================================================
// FACTORY
// ============================================================

function createAgentRuntimeService(options = {}) {
  return new AgentRuntimeService(options);
}


// ============================================================
// SINGLETON
// ============================================================

let singletonService = null;


function getAgentRuntimeService(options = {}) {
  if (!singletonService) {
    singletonService =
      createAgentRuntimeService(options);
  }

  return singletonService;
}


// ============================================================
// RESET SINGLETON
// ============================================================

function resetAgentRuntimeService() {
  if (
    singletonService &&
    typeof singletonService.stop === "function"
  ) {
    try {
      singletonService.stop().catch(() => {});
    } catch (error) {
      // Intentionally ignored during singleton reset.
    }
  }

  singletonService = null;
}


// ============================================================
// CONVENIENCE FUNCTIONS
// ============================================================

async function startAgentRuntimeService(options = {}) {
  const service =
    getAgentRuntimeService(options);

  return service.start();
}


async function stopAgentRuntimeService() {
  const service =
    getAgentRuntimeService();

  return service.stop();
}


async function restartAgentRuntimeService() {
  const service =
    getAgentRuntimeService();

  return service.restart();
}


function getAgentRuntimeServiceStatus() {
  return getAgentRuntimeService().getStatus();
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  SERVICE_STATUS,

  AgentRuntimeService,

  createAgentRuntimeService,
  getAgentRuntimeService,

  resetAgentRuntimeService,

  startAgentRuntimeService,
  stopAgentRuntimeService,
  restartAgentRuntimeService,

  getAgentRuntimeServiceStatus,
};