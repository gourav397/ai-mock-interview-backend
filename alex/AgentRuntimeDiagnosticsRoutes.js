"use strict";

// ============================================================
// ALEX Agent Runtime Diagnostics Routes
// File: backend/alex/AgentRuntimeDiagnosticsRoutes.js
//
// Purpose:
// Dedicated Express router for Agent Runtime diagnostics.
//
// This file does NOT modify server.js.
// ============================================================

const express = require("express");

const {
  createAgentRuntimeDiagnosticsRouteAdapter,
} = require("./AgentRuntimeDiagnosticsRouteAdapter");


// ============================================================
// ROUTER FACTORY
// ============================================================

function createAgentRuntimeDiagnosticsRouter(options = {}) {
  const router = express.Router();

  const adapter =
    options.adapter ||
    createAgentRuntimeDiagnosticsRouteAdapter(options);

  const handlers = adapter.handlers();


  // ==========================================================
  // COMPLETE DIAGNOSTIC SNAPSHOT
  // ==========================================================

  router.get(
    "/",
    handlers.snapshot
  );


  // ==========================================================
  // DIAGNOSTIC SUMMARY
  // ==========================================================

  router.get(
    "/summary",
    handlers.summary
  );


  // ==========================================================
  // HEALTH
  // ==========================================================

  router.get(
    "/health",
    handlers.health
  );


  // ==========================================================
  // HEALTH STATISTICS
  // ==========================================================

  router.get(
    "/health-stats",
    handlers.healthStats
  );


  // ==========================================================
  // RUNTIME INFORMATION
  // ==========================================================

  router.get(
    "/info",
    handlers.info
  );


  // ==========================================================
  // CAPABILITIES
  // ==========================================================

  router.get(
    "/capabilities",
    handlers.capabilities
  );


  // ==========================================================
  // SESSIONS
  // ==========================================================

  router.get(
    "/sessions",
    handlers.sessions
  );


  // ==========================================================
  // WORKFLOWS
  // ==========================================================

  router.get(
    "/workflows",
    handlers.workflows
  );


  // ==========================================================
  // TOOLS
  // ==========================================================

  router.get(
    "/tools",
    handlers.tools
  );


  // ==========================================================
  // VERIFICATION
  // ==========================================================

  router.get(
    "/verification",
    handlers.verification
  );


  // ==========================================================
  // ROUTER INFORMATION
  // ==========================================================

  router.get(
    "/router-info",
    (req, res) => {
      res.json({
        success: true,
        service: "ALEX Agent Runtime Diagnostics",
        version: "1.0.0",
        endpoints: [
          "GET /",
          "GET /summary",
          "GET /health",
          "GET /health-stats",
          "GET /info",
          "GET /capabilities",
          "GET /sessions",
          "GET /workflows",
          "GET /tools",
          "GET /verification",
          "GET /router-info",
        ],
        timestamp: new Date().toISOString(),
      });
    }
  );


  return router;
}


// ============================================================
// SINGLETON
// ============================================================

let singletonRouter = null;


function getAgentRuntimeDiagnosticsRouter(options = {}) {
  if (!singletonRouter) {
    singletonRouter =
      createAgentRuntimeDiagnosticsRouter(options);
  }

  return singletonRouter;
}


// ============================================================
// RESET
// ============================================================

function resetAgentRuntimeDiagnosticsRouter() {
  singletonRouter = null;
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  createAgentRuntimeDiagnosticsRouter,
  getAgentRuntimeDiagnosticsRouter,
  resetAgentRuntimeDiagnosticsRouter,
};