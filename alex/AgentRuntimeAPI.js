// ============================================================
// ALEX — Agent Runtime API
// Version: 1.0.0
//
// Purpose:
//   Stable programmatic API over AgentRuntime.
//
//   This layer keeps route/controller code simple and prevents
//   direct coupling to individual agent subsystems.
//
//   It does NOT register Express routes.
//   Existing routes can be connected later.
// ============================================================

"use strict";

const {
  getAgentRuntime,
} = require("./AgentRuntime");

const AGENT_RUNTIME_API_VERSION = "1.0.0";

class AgentRuntimeAPI {
  constructor(options = {}) {
    this.version =
      AGENT_RUNTIME_API_VERSION;

    this.runtime =
      options.runtime ||
      getAgentRuntime();

    this.initializedAt =
      Date.now();
  }

  // ==========================================================
  // RUNTIME
  // ==========================================================

  status() {
    return this.runtime.getStatus();
  }

  health() {
    return this.runtime.health();
  }

  snapshot() {
    return this.runtime.snapshot();
  }

  // ==========================================================
  // CAPABILITIES
  // ==========================================================

  capabilities(options = {}) {
    return {
      success: true,

      capabilities:
        this.runtime.getCapabilities(
          options
        ),

      summary:
        this.runtime.getCapabilitySummary(),
    };
  }

  hasCapability(
    capability,
    options = {}
  ) {
    return {
      success:
        this.runtime.hasCapability(
          capability,
          options
        ),

      capability,
    };
  }

  // ==========================================================
  // SESSION
  // ==========================================================

  createSession(options = {}) {
    return this.runtime.createSession(
      options
    );
  }

  getSession(sessionId) {
    return this.runtime.getSession(
      sessionId
    );
  }

  getSessionStatus(sessionId) {
    return this.runtime.getSessionStatus(
      sessionId
    );
  }

  addAction(
    sessionId,
    action
  ) {
    return this.runtime.addAction(
      sessionId,
      action
    );
  }

  addActions(
    sessionId,
    actions
  ) {
    return this.runtime.addActions(
      sessionId,
      actions
    );
  }

  async runSession(
    sessionId,
    options = {}
  ) {
    return this.runtime.runSession(
      sessionId,
      options
    );
  }

  async runSessionWithRecovery(
    sessionId,
    options = {}
  ) {
    return this.runtime.runSessionWithRecovery(
      sessionId,
      options
    );
  }

  async resumeSession(
    sessionId,
    options = {}
  ) {
    return this.runtime.resumeSession(
      sessionId,
      options
    );
  }

  async cancelSession(
    sessionId,
    reason = ""
  ) {
    return this.runtime.cancelSession(
      sessionId,
      reason
    );
  }

  createSessionSnapshot(
    sessionId,
    metadata = {}
  ) {
    return this.runtime.createSnapshot(
      sessionId,
      metadata
    );
  }

  // ==========================================================
  // TASK
  // ==========================================================

  getTask(sessionId) {
    return this.runtime.getTask(
      sessionId
    );
  }

  getTaskStatus(sessionId) {
    return this.runtime.getTaskStatus(
      sessionId
    );
  }

  // ==========================================================
  // WORKFLOW
  // ==========================================================

  createWorkflow(options = {}) {
    return this.runtime.createWorkflow(
      options
    );
  }

  getWorkflow(workflowId) {
    return this.runtime.getWorkflow(
      workflowId
    );
  }

  getWorkflowStatus(workflowId) {
    return this.runtime.getWorkflowStatus(
      workflowId
    );
  }

  // ==========================================================
  // TOOL
  // ==========================================================

  inspectTool(
    tool,
    args = {},
    context = null
  ) {
    return this.runtime.inspectTool(
      tool,
      args,
      context
    );
  }

  async executeTool(
    context,
    tool,
    args = {},
    options = {}
  ) {
    return this.runtime.executeTool(
      context,
      tool,
      args,
      options
    );
  }

  // ==========================================================
  // VERIFICATION
  // ==========================================================

  async verifyResult(
    result,
    expectation,
    options = {}
  ) {
    return this.runtime.verifyResult(
      result,
      expectation,
      options
    );
  }

  async verifyAction(
    action,
    result,
    context = null
  ) {
    return this.runtime.verifyAction(
      action,
      result,
      context
    );
  }

  // ==========================================================
  // EVENTS
  // ==========================================================

  getEvents(options = {}) {
    return {
      success: true,

      events:
        this.runtime.getEvents(
          options
        ),
    };
  }

  clearEvents() {
    return this.runtime.clearEvents();
  }

  // ==========================================================
  // API INFORMATION
  // ==========================================================

  info() {
    return {
      success: true,

      apiVersion:
        this.version,

      runtime:
        this.runtime.getStatus(),

      health:
        this.runtime.health(),

      initializedAt:
        this.initializedAt,
    };
  }
}

// ============================================================
// SINGLETON
// ============================================================

let apiInstance = null;

function getAgentRuntimeAPI(
  options = {}
) {
  if (!apiInstance) {
    apiInstance =
      new AgentRuntimeAPI(
        options
      );
  }

  return apiInstance;
}

function resetAgentRuntimeAPI(
  options = {}
) {
  apiInstance =
    new AgentRuntimeAPI(
      options
    );

  return apiInstance;
}

function createAgentRuntimeAPI(
  options = {}
) {
  return new AgentRuntimeAPI(
    options
  );
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  AgentRuntimeAPI,

  getAgentRuntimeAPI,
  resetAgentRuntimeAPI,
  createAgentRuntimeAPI,

  AGENT_RUNTIME_API_VERSION,
};