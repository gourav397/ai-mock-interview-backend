// ============================================================
// ALEX — Agent Runtime Factory
// Version: 1.0.0
//
// Purpose:
//   Creates and manages fully configured ALEX Agent Runtime
//   instances.
//
//   This keeps dependency construction in one place and avoids
//   repeatedly wiring individual agent components throughout
//   the project.
//
//   This file does NOT modify existing ALEX files.
// ============================================================

"use strict";

const {
  createAgentRuntime,
} = require("./AgentRuntime");

const {
  createAgentRuntimeAPI,
} = require("./AgentRuntimeAPI");

const {
  createAgentCapabilityManager,
} = require("./AgentCapabilityManager");

const {
  createAgentSessionCoordinator,
} = require("./AgentSessionCoordinator");

const {
  createAgentSessionBridge,
} = require("./AgentSessionBridge");

const {
  createAgentTaskAdapter,
} = require("./AgentTaskAdapter");

const {
  createAgentWorkflowCoordinator,
} = require("./AgentWorkflowCoordinator");

const {
  createAgentOrchestrator,
} = require("./AgentOrchestrator");

const {
  createAgentVerificationEngine,
} = require("./AgentVerificationEngine");

const {
  createAgentExecutionVerifier,
} = require("./AgentExecutionVerifier");

const AGENT_RUNTIME_FACTORY_VERSION =
  "1.0.0";

const FACTORY_MODE = Object.freeze({
  SINGLETON: "singleton",
  ISOLATED: "isolated",
});

function clone(value) {
  if (value === undefined) {
    return undefined;
  }

  try {
    return JSON.parse(
      JSON.stringify(value)
    );
  } catch {
    return value;
  }
}

class AgentRuntimeFactory {
  constructor(options = {}) {
    this.version =
      AGENT_RUNTIME_FACTORY_VERSION;

    this.mode =
      options.mode ||
      FACTORY_MODE.SINGLETON;

    this.defaults = {
      ...(options.defaults || {}),
    };

    this.runtime =
      options.runtime ||
      null;

    this.api =
      options.api ||
      null;

    this.createdAt =
      Date.now();
  }

  // ==========================================================
  // CREATE FULL RUNTIME
  // ==========================================================

  create(options = {}) {
    const config = {
      ...this.defaults,
      ...options,
    };

    const isolated =
      config.mode ===
      FACTORY_MODE.ISOLATED;

    // --------------------------------------------------------
    // Build capability layer
    // --------------------------------------------------------

    const capabilityManager =
      config.capabilityManager ||
      createAgentCapabilityManager({
        capabilities:
          config.capabilities,
      });

    // --------------------------------------------------------
    // Build session layer
    // --------------------------------------------------------

    const sessionCoordinator =
      config.sessionCoordinator ||
      createAgentSessionCoordinator({
        sessionManager:
          config.sessionManager,

        sessionStore:
          config.sessionStore,

        capabilityManager,
      });

    // --------------------------------------------------------
    // Build task layer
    // --------------------------------------------------------

    const taskAdapter =
      config.taskAdapter ||
      createAgentTaskAdapter({
        workflowCoordinator:
          config.workflowCoordinator,

        workflowStore:
          config.workflowStore,

        workflowRecovery:
          config.workflowRecovery,
      });

    // --------------------------------------------------------
    // Build workflow layer
    // --------------------------------------------------------

    const workflowCoordinator =
      config.workflowCoordinator ||
      this._createWorkflowCoordinator(
        config,
        sessionCoordinator
      );

    // --------------------------------------------------------
    // Build session bridge
    // --------------------------------------------------------

    const sessionBridge =
      config.sessionBridge ||
      createAgentSessionBridge({
        sessionCoordinator,

        taskAdapter,
      });

    // --------------------------------------------------------
    // Build orchestration layer
    // --------------------------------------------------------

    const orchestrator =
      config.orchestrator ||
      createAgentOrchestrator({
        registry:
          config.registry,

        permissionManager:
          config.permissionManager,
      });

    // --------------------------------------------------------
    // Build verification layer
    // --------------------------------------------------------

    const verificationEngine =
      config.verificationEngine ||
      createAgentVerificationEngine({
        ...(config.verificationOptions ||
          {}),
      });

    const executionVerifier =
      config.executionVerifier ||
      createAgentExecutionVerifier({
        verificationEngine,
      });

    // --------------------------------------------------------
    // Build runtime
    // --------------------------------------------------------

    const runtime =
      config.runtime ||
      createAgentRuntime({
        capabilityManager,

        sessionCoordinator,

        sessionBridge,

        taskAdapter,

        workflowCoordinator,

        orchestrator,

        verificationEngine,

        executionVerifier,

        maxRuntimeEvents:
          config.maxRuntimeEvents,
      });

    // --------------------------------------------------------
    // Build public programmatic API
    // --------------------------------------------------------

    const api =
      config.api ||
      createAgentRuntimeAPI({
        runtime,
      });

    const bundle = {
      success: true,

      mode:
        isolated
          ? FACTORY_MODE.ISOLATED
          : FACTORY_MODE.SINGLETON,

      version:
        this.version,

      createdAt:
        Date.now(),

      capabilityManager,

      sessionCoordinator,

      sessionBridge,

      taskAdapter,

      workflowCoordinator,

      orchestrator,

      verificationEngine,

      executionVerifier,

      runtime,

      api,
    };

    if (
      !isolated
    ) {
      this.runtime =
        runtime;

      this.api =
        api;
    }

    return bundle;
  }

  // ==========================================================
  // CREATE RUNTIME ONLY
  // ==========================================================

  createRuntime(options = {}) {
    const bundle =
      this.create(
        options
      );

    return bundle.runtime;
  }

  // ==========================================================
  // CREATE API ONLY
  // ==========================================================

  createAPI(options = {}) {
    const bundle =
      this.create(
        options
      );

    return bundle.api;
  }

  // ==========================================================
  // CREATE WORKFLOW COORDINATOR
  // ==========================================================

  _createWorkflowCoordinator(
    config,
    sessionCoordinator
  ) {
    if (
      config.workflowCoordinator
    ) {
      return config.workflowCoordinator;
    }

    const workflowOptions = {
      workflowEngine:
        config.workflowEngine,

      workflowStore:
        config.workflowStore,

      workflowRecovery:
        config.workflowRecovery,

      planExecutor:
        config.planExecutor,

      executionVerifier:
        config.executionVerifier,

      sessionCoordinator,
    };

    return createAgentWorkflowCoordinator(
      workflowOptions
    );
  }

  // ==========================================================
  // GET CURRENT RUNTIME
  // ==========================================================

  getRuntime() {
    return this.runtime;
  }

  // ==========================================================
  // GET CURRENT API
  // ==========================================================

  getAPI() {
    return this.api;
  }

  // ==========================================================
  // HAS RUNTIME
  // ==========================================================

  hasRuntime() {
    return Boolean(
      this.runtime
    );
  }

  // ==========================================================
  // HAS API
  // ==========================================================

  hasAPI() {
    return Boolean(
      this.api
    );
  }

  // ==========================================================
  // RUNTIME SNAPSHOT
  // ==========================================================

  snapshot() {
    return {
      version:
        this.version,

      mode:
        this.mode,

      createdAt:
        this.createdAt,

      hasRuntime:
        this.hasRuntime(),

      hasAPI:
        this.hasAPI(),

      runtime:
        this.runtime &&
        typeof this.runtime.snapshot ===
          "function"
          ? this.runtime.snapshot()
          : null,
    };
  }

  // ==========================================================
  // RESET CURRENT REFERENCES
  // ==========================================================

  reset() {
    this.runtime =
      null;

    this.api =
      null;

    return {
      success: true,

      resetAt:
        Date.now(),
    };
  }

  // ==========================================================
  // CREATE SAFE DESCRIPTION
  // ==========================================================

  describe() {
    return clone({
      factoryVersion:
        this.version,

      mode:
        this.mode,

      hasRuntime:
        this.hasRuntime(),

      hasAPI:
        this.hasAPI(),

      createdAt:
        this.createdAt,
    });
  }
}

// ============================================================
// DEFAULT FACTORY
// ============================================================

let factoryInstance = null;

function getAgentRuntimeFactory(
  options = {}
) {
  if (!factoryInstance) {
    factoryInstance =
      new AgentRuntimeFactory(
        options
      );
  }

  return factoryInstance;
}

function resetAgentRuntimeFactory(
  options = {}
) {
  factoryInstance =
    new AgentRuntimeFactory(
      options
    );

  return factoryInstance;
}

function createAgentRuntimeFactory(
  options = {}
) {
  return new AgentRuntimeFactory(
    options
  );
}

// ============================================================
// READY-TO-USE RUNTIME
// ============================================================

function createDefaultAgentRuntime(
  options = {}
) {
  const factory =
    getAgentRuntimeFactory();

  const bundle =
    factory.create({
      ...options,

      mode:
        FACTORY_MODE.SINGLETON,
    });

  return bundle;
}

// ============================================================
// READY-TO-USE API
// ============================================================

function createDefaultAgentRuntimeAPI(
  options = {}
) {
  const bundle =
    createDefaultAgentRuntime(
      options
    );

  return bundle.api;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  AgentRuntimeFactory,

  getAgentRuntimeFactory,
  resetAgentRuntimeFactory,
  createAgentRuntimeFactory,

  createDefaultAgentRuntime,
  createDefaultAgentRuntimeAPI,

  AGENT_RUNTIME_FACTORY_VERSION,
  FACTORY_MODE,
};