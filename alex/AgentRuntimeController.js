// ============================================================
// ALEX — Agent Runtime Controller
// Version: 1.0.0
//
// Purpose:
//   Controller layer for the unified Agent Runtime.
//
//   Keeps HTTP/controller-style logic separate from the runtime
//   itself. This file does NOT register Express routes.
//
//   Existing ALEX routes can call this controller later.
// ============================================================

"use strict";

const {
  getAgentRuntimeManager,
} = require("./AgentRuntimeManager");

const AGENT_RUNTIME_CONTROLLER_VERSION =
  "1.0.0";

class AgentRuntimeController {
  constructor(options = {}) {
    this.version =
      AGENT_RUNTIME_CONTROLLER_VERSION;

    this.manager =
      options.manager ||
      getAgentRuntimeManager();
  }

  // ==========================================================
  // RUNTIME
  // ==========================================================

  start() {
    try {
      const result =
        this.manager.start();

      return this._success(
        result
      );
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  stop() {
    try {
      const result =
        this.manager.stop();

      return this._success(
        result
      );
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  restart() {
    try {
      const result =
        this.manager.restart();

      return this._success(
        result
      );
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  status() {
    try {
      return this._success({
        status:
          this.manager.getStatus(),

        snapshot:
          this.manager.snapshot(),
      });
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  health() {
    try {
      return this._success(
        this.manager.checkHealth()
      );
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  snapshot() {
    try {
      return this._success(
        this.manager.snapshot()
      );
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  // ==========================================================
  // CAPABILITIES
  // ==========================================================

  capabilities(options = {}) {
    try {
      const runtime =
        this.manager.getRuntime();

      return this._success(
        runtime.getCapabilities(
          options
        )
      );
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  capabilitySummary() {
    try {
      const runtime =
        this.manager.getRuntime();

      return this._success(
        runtime.getCapabilitySummary()
      );
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  hasCapability(
    capability,
    options = {}
  ) {
    try {
      const runtime =
        this.manager.getRuntime();

      return this._success({
        capability,

        available:
          runtime.hasCapability(
            capability,
            options
          ),
      });
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  // ==========================================================
  // SESSION
  // ==========================================================

  createSession(options = {}) {
    try {
      const runtime =
        this.manager.getRuntime();

      return this._success(
        runtime.createSession(
          options
        )
      );
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  getSession(sessionId) {
    try {
      const runtime =
        this.manager.getRuntime();

      return this._success(
        runtime.getSession(
          sessionId
        )
      );
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  getSessionStatus(
    sessionId
  ) {
    try {
      const runtime =
        this.manager.getRuntime();

      return this._success(
        runtime.getSessionStatus(
          sessionId
        )
      );
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  addAction(
    sessionId,
    action
  ) {
    try {
      const runtime =
        this.manager.getRuntime();

      return this._success(
        runtime.addAction(
          sessionId,
          action
        )
      );
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  addActions(
    sessionId,
    actions
  ) {
    try {
      const runtime =
        this.manager.getRuntime();

      return this._success(
        runtime.addActions(
          sessionId,
          actions
        )
      );
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  async runSession(
    sessionId,
    options = {}
  ) {
    try {
      const runtime =
        this.manager.getRuntime();

      return this._success(
        await runtime.runSession(
          sessionId,
          options
        )
      );
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  async runSessionWithRecovery(
    sessionId,
    options = {}
  ) {
    try {
      const runtime =
        this.manager.getRuntime();

      return this._success(
        await runtime.runSessionWithRecovery(
          sessionId,
          options
        )
      );
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  async resumeSession(
    sessionId,
    options = {}
  ) {
    try {
      const runtime =
        this.manager.getRuntime();

      return this._success(
        await runtime.resumeSession(
          sessionId,
          options
        )
      );
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  async cancelSession(
    sessionId,
    reason = ""
  ) {
    try {
      const runtime =
        this.manager.getRuntime();

      return this._success(
        await runtime.cancelSession(
          sessionId,
          reason
        )
      );
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  createSessionSnapshot(
    sessionId,
    metadata = {}
  ) {
    try {
      const runtime =
        this.manager.getRuntime();

      return this._success(
        runtime.createSnapshot(
          sessionId,
          metadata
        )
      );
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  // ==========================================================
  // TASK
  // ==========================================================

  getTask(sessionId) {
    try {
      const runtime =
        this.manager.getRuntime();

      return this._success(
        runtime.getTask(
          sessionId
        )
      );
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  getTaskStatus(
    sessionId
  ) {
    try {
      const runtime =
        this.manager.getRuntime();

      return this._success(
        runtime.getTaskStatus(
          sessionId
        )
      );
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  // ==========================================================
  // WORKFLOW
  // ==========================================================

  createWorkflow(
    options = {}
  ) {
    try {
      const runtime =
        this.manager.getRuntime();

      return this._success(
        runtime.createWorkflow(
          options
        )
      );
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  getWorkflow(
    workflowId
  ) {
    try {
      const runtime =
        this.manager.getRuntime();

      return this._success(
        runtime.getWorkflow(
          workflowId
        )
      );
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  getWorkflowStatus(
    workflowId
  ) {
    try {
      const runtime =
        this.manager.getRuntime();

      return this._success(
        runtime.getWorkflowStatus(
          workflowId
        )
      );
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  // ==========================================================
  // TOOL INSPECTION
  // ==========================================================

  inspectTool(
    tool,
    args = {},
    context = null
  ) {
    try {
      const runtime =
        this.manager.getRuntime();

      return this._success(
        runtime.inspectTool(
          tool,
          args,
          context
        )
      );
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  // ==========================================================
  // TOOL EXECUTION
  // ==========================================================

  async executeTool(
    context,
    tool,
    args = {},
    options = {}
  ) {
    try {
      const runtime =
        this.manager.getRuntime();

      return this._success(
        await runtime.executeTool(
          context,
          tool,
          args,
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
  // VERIFICATION
  // ==========================================================

  async verifyResult(
    result,
    expectation,
    options = {}
  ) {
    try {
      const runtime =
        this.manager.getRuntime();

      return this._success(
        await runtime.verifyResult(
          result,
          expectation,
          options
        )
      );
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  async verifyAction(
    action,
    result,
    context = null
  ) {
    try {
      const runtime =
        this.manager.getRuntime();

      return this._success(
        await runtime.verifyAction(
          action,
          result,
          context
        )
      );
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  // ==========================================================
  // EVENTS
  // ==========================================================

  events(options = {}) {
    try {
      return this._success({
        events:
          this.manager
            .getEvents(
              options
            ),
      });
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  clearEvents() {
    try {
      return this._success(
        this.manager.clearEvents()
      );
    } catch (error) {
      return this._error(
        error
      );
    }
  }

  // ==========================================================
  // API INFO
  // ==========================================================

  info() {
    return {
      success: true,

      controllerVersion:
        this.version,

      runtimeManager:
        this.manager.getStatus(),

      runtimeHealth:
        this.manager.checkHealth(),

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

function getAgentRuntimeController(
  options = {}
) {
  if (
    !controllerInstance
  ) {
    controllerInstance =
      new AgentRuntimeController(
        options
      );
  }

  return controllerInstance;
}

function resetAgentRuntimeController(
  options = {}
) {
  controllerInstance =
    new AgentRuntimeController(
      options
    );

  return controllerInstance;
}

function createAgentRuntimeController(
  options = {}
) {
  return new AgentRuntimeController(
    options
  );
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  AgentRuntimeController,

  getAgentRuntimeController,
  resetAgentRuntimeController,
  createAgentRuntimeController,

  AGENT_RUNTIME_CONTROLLER_VERSION,
};