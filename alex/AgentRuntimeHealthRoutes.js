"use strict";

// ============================================================
// ALEX Agent Runtime Health Routes
// File: backend/alex/AgentRuntimeHealthRoutes.js
//
// Purpose:
// Dedicated Express router for Agent Runtime health endpoints.
//
// This file does NOT modify server.js.
// ============================================================

const express = require("express");

const {
  createAgentRuntimeHealthRouteAdapter,
} = require("./AgentRuntimeHealthRouteAdapter");


// ============================================================
// ROUTER FACTORY
// ============================================================

function createAgentRuntimeHealthRouter(options = {}) {
  const router = express.Router();

  const adapter =
    options.adapter ||
    createAgentRuntimeHealthRouteAdapter(options);

  const handlers = adapter.handlers();


  // ==========================================================
  // FULL HEALTH CHECK
  // ==========================================================

  router.get(
    "/",
    handlers.check
  );


  // ==========================================================
  // QUICK HEALTH CHECK
  // ==========================================================

  router.get(
    "/quick",
    handlers.quickCheck
  );


  // ==========================================================
  // LAST HEALTH RESULT
  // ==========================================================

  router.get(
    "/last",
    handlers.lastResult
  );


  // ==========================================================
  // HEALTH STATISTICS
  // ==========================================================

  router.get(
    "/stats",
    handlers.stats
  );


  // ==========================================================
  // RESET HEALTH STATISTICS
  // ==========================================================

  router.post(
    "/stats/reset",
    handlers.resetStats
  );


  // ==========================================================
  // HEALTH DIAGNOSTICS
  // ==========================================================

  router.get(
    "/diagnostics",
    handlers.diagnostics
  );


  // ==========================================================
  // ROUTER INFORMATION
  // ==========================================================

  router.get(
    "/info",
    (req, res) => {
      res.json({
        success: true,
        service: "ALEX Agent Runtime Health",
        version: "1.0.0",
        endpoints: [
          "GET /",
          "GET /quick",
          "GET /last",
          "GET /stats",
          "POST /stats/reset",
          "GET /diagnostics",
          "GET /info",
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


function getAgentRuntimeHealthRouter(options = {}) {
  if (!singletonRouter) {
    singletonRouter =
      createAgentRuntimeHealthRouter(options);
  }

  return singletonRouter;
}


// ============================================================
// RESET
// ============================================================

function resetAgentRuntimeHealthRouter() {
  singletonRouter = null;
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  createAgentRuntimeHealthRouter,
  getAgentRuntimeHealthRouter,
  resetAgentRuntimeHealthRouter,
};