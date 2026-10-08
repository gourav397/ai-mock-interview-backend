// ============================================================
// ALEX Agent Runtime Routes
// File: backend/alex/AgentRuntimeRoutes.js
//
// Purpose:
// Express router for the Agent Runtime.
// This file only registers routes.
// It does NOT modify server.js.
// ============================================================

"use strict";

const express = require("express");

const {
  createAgentRuntimeRouteAdapter,
} = require("./AgentRuntimeRouteAdapter");

const {
  createAgentRuntimeHealthRouteAdapter,
} = require("./AgentRuntimeHealthRouteAdapter");

const {
  createAgentRuntimeDiagnosticsRouteAdapter,
} = require("./AgentRuntimeDiagnosticsRouteAdapter");


// ============================================================
// ROUTER FACTORY
// ============================================================

function createAgentRuntimeRouter(options = {}) {
  const router = express.Router();

  const runtimeAdapter =
    options.runtimeAdapter ||
    createAgentRuntimeRouteAdapter(options);

  const healthAdapter =
    options.healthAdapter ||
    createAgentRuntimeHealthRouteAdapter(options);

  const diagnosticsAdapter =
    options.diagnosticsAdapter ||
    createAgentRuntimeDiagnosticsRouteAdapter(options);

  const runtime = runtimeAdapter.handlers();
  const health = healthAdapter.handlers();
  const diagnostics = diagnosticsAdapter.handlers();


  // ==========================================================
  // BASIC RUNTIME
  // ==========================================================

  router.get("/status", runtime.status);
  router.get("/info", runtime.info);
  router.get("/snapshot", runtime.snapshot);


  // ==========================================================
  // RUNTIME LIFECYCLE
  // ==========================================================

  router.post("/start", runtime.start);
  router.post("/stop", runtime.stop);
  router.post("/restart", runtime.restart);


  // ==========================================================
  // CAPABILITIES
  // IMPORTANT:
  // summary must come BEFORE /:capability
  // ==========================================================

  router.get("/capabilities", runtime.capabilities);
  router.get("/capabilities/summary", runtime.capabilitySummary);
  router.get("/capabilities/:capability", runtime.hasCapability);


  // ==========================================================
  // SESSIONS
  // ==========================================================

  router.post("/sessions", runtime.createSession);

  router.get(
    "/sessions/:sessionId/status",
    runtime.getSessionStatus
  );

  router.get(
    "/sessions/:sessionId",
    runtime.getSession
  );

  router.post(
    "/sessions/:sessionId/actions",
    runtime.addAction
  );

  router.post(
    "/sessions/:sessionId/actions/batch",
    runtime.addActions
  );

  router.post(
    "/sessions/:sessionId/run",
    runtime.runSession
  );

  router.post(
    "/sessions/:sessionId/run-recovery",
    runtime.runSessionWithRecovery
  );

  router.post(
    "/sessions/:sessionId/resume",
    runtime.resumeSession
  );

  router.post(
    "/sessions/:sessionId/cancel",
    runtime.cancelSession
  );

  router.post(
    "/sessions/:sessionId/snapshot",
    runtime.createSnapshot
  );


  // ==========================================================
  // TASKS
  // ==========================================================

  router.get(
    "/tasks/:sessionId/status",
    runtime.getTaskStatus
  );

  router.get(
    "/tasks/:sessionId",
    runtime.getTask
  );


  // ==========================================================
  // WORKFLOWS
  // IMPORTANT:
  // status must come BEFORE /:workflowId
  // ==========================================================

  router.post(
    "/workflows",
    runtime.createWorkflow
  );

  router.get(
    "/workflows/:workflowId/status",
    runtime.getWorkflowStatus
  );

  router.get(
    "/workflows/:workflowId",
    runtime.getWorkflow
  );


  // ==========================================================
  // TOOLS
  // ==========================================================

  router.post(
    "/tools/inspect",
    runtime.inspectTool
  );

  router.post(
    "/tools/execute",
    runtime.executeTool
  );


  // ==========================================================
  // VERIFICATION
  // ==========================================================

  router.post(
    "/verify/result",
    runtime.verifyResult
  );

  router.post(
    "/verify/action",
    runtime.verifyAction
  );


  // ==========================================================
  // EVENTS
  // ==========================================================

  router.get(
    "/events",
    runtime.events
  );

  router.delete(
    "/events",
    runtime.clearEvents
  );


  // ==========================================================
  // HEALTH
  // ==========================================================

  router.get(
    "/health/full",
    health.check
  );

  router.get(
    "/health/quick",
    health.quickCheck
  );

  router.get(
    "/health/last",
    health.lastResult
  );

  router.get(
    "/health/stats",
    health.stats
  );

  router.post(
    "/health/stats/reset",
    health.resetStats
  );

  router.get(
    "/health/diagnostics",
    health.diagnostics
  );


  // ==========================================================
  // DIAGNOSTICS
  // ==========================================================

  router.get(
    "/diagnostics",
    diagnostics.snapshot
  );

  router.get(
    "/diagnostics/summary",
    diagnostics.summary
  );

  router.get(
    "/diagnostics/health",
    diagnostics.health
  );

  router.get(
    "/diagnostics/health-stats",
    diagnostics.healthStats
  );

  router.get(
    "/diagnostics/info",
    diagnostics.info
  );

  router.get(
    "/diagnostics/capabilities",
    diagnostics.capabilities
  );

  router.get(
    "/diagnostics/sessions",
    diagnostics.sessions
  );

  router.get(
    "/diagnostics/workflows",
    diagnostics.workflows
  );

  router.get(
    "/diagnostics/tools",
    diagnostics.tools
  );

  router.get(
    "/diagnostics/verification",
    diagnostics.verification
  );


  // ==========================================================
  // ROUTER INFO
  // ==========================================================

  router.get("/", (req, res) => {
    res.json({
      success: true,
      name: "ALEX Agent Runtime",
      version: "1.0.0",
      service: "agent-runtime",
      routes: {
        runtime: true,
        lifecycle: true,
        capabilities: true,
        sessions: true,
        tasks: true,
        workflows: true,
        tools: true,
        verification: true,
        events: true,
        health: true,
        diagnostics: true,
      },
      timestamp: new Date().toISOString(),
    });
  });


  return router;
}


// ============================================================
// SINGLETON
// ============================================================

let singletonRouter = null;

function getAgentRuntimeRouter(options = {}) {
  if (!singletonRouter) {
    singletonRouter = createAgentRuntimeRouter(options);
  }

  return singletonRouter;
}


// ============================================================
// RESET
// ============================================================

function resetAgentRuntimeRouter() {
  singletonRouter = null;
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  createAgentRuntimeRouter,
  getAgentRuntimeRouter,
  resetAgentRuntimeRouter,
};